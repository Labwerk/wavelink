import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { loadIngestConfig } from "./lib/ingestConfig";
import {
  validateReadingShape,
  computeFreshnessPatches,
  type RejectionReason,
} from "./lib/ingestValidation";

// Entry point for the gateway/simulator service — but not a public entry
// point itself. Converted from a public `mutation` to an `internalMutation`
// (telemetry-ingestion R4): Convex internal functions cannot be called
// directly from a client, which is what actually closes the old
// unauthenticated write path. The only caller is
// `backend/ingestHttp.ts`'s httpAction, which has already authenticated the
// request and rate-limited it before this transaction ever starts — the
// service credential it checks (`INGEST_TOKENS`) is what satisfies
// `specs/auth-roles/spec.md` R12; a user session cannot substitute for it
// (see `backend/lib/ingestAuth.ts`).

interface ClaimedFields {
  externalId?: string;
  metric?: string;
  claimedTs?: number;
}

/** Best-effort extraction of the fields a malformed reading *claimed* to
 * have, truncated to the configured length bounds, for the rejection record
 * (R13) — a garbage payload must never itself fail to produce a rejection
 * row. */
function claimedFields(raw: unknown, config: ReturnType<typeof loadIngestConfig>): ClaimedFields {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    externalId:
      typeof obj.externalId === "string"
        ? obj.externalId.slice(0, config.maxExternalIdLength)
        : undefined,
    metric: typeof obj.metric === "string" ? obj.metric.slice(0, config.maxMetricLength) : undefined,
    claimedTs: typeof obj.ts === "number" ? obj.ts : undefined,
  };
}

interface RejectedSummaryEntry {
  index: number;
  reason: RejectionReason;
  externalId?: string;
  metric?: string;
}

export const recordBatch = internalMutation({
  args: {
    sourceId: v.string(),
    batchId: v.string(),
    readings: v.array(v.any()),
  },
  handler: async (ctx, { sourceId, batchId, readings }) => {
    const now = Date.now();
    const config = loadIngestConfig();

    // Per-externalId device cache, including negative results (unknown
    // devices), so a batch with many readings for the same device only
    // queries `devices` once per distinct externalId (R11 note: never
    // creates a device row on a miss).
    const deviceCache = new Map<string, Doc<"devices"> | null>();

    const rejectedSummary: RejectedSummaryEntry[] = [];
    const acceptedForFreshness: Array<{ deviceId: Id<"devices">; ts: number }> = [];
    let stored = 0;

    async function reject(index: number, raw: unknown, reason: RejectionReason) {
      const claimed = claimedFields(raw, config);
      await ctx.db.insert("ingestRejections", {
        ts: now,
        sourceId,
        batchId,
        index,
        reason,
        externalId: claimed.externalId,
        metric: claimed.metric,
        claimedTs: claimed.claimedTs,
      });
      rejectedSummary.push({
        index,
        reason,
        externalId: claimed.externalId,
        metric: claimed.metric,
      });
    }

    for (let index = 0; index < readings.length; index++) {
      const raw = readings[index];

      // 1. Shape → bounds → timestamp (R8, R9, R10) — no ctx.db needed.
      const shapeResult = validateReadingShape(raw, config, now);
      if (!shapeResult.ok) {
        await reject(index, raw, shapeResult.reason);
        continue;
      }
      const reading = raw as { externalId: string; ts: number; metric: string; value: number | string };

      // 2. Device existence / active (R11, R12) — the one part of
      // validation that needs ctx.db, so it happens after shape validation.
      let device = deviceCache.get(reading.externalId);
      if (device === undefined) {
        device =
          (await ctx.db
            .query("devices")
            .withIndex("by_externalId", (q) => q.eq("externalId", reading.externalId))
            .unique()) ?? null;
        deviceCache.set(reading.externalId, device);
      }
      if (!device) {
        await reject(index, raw, "unknown_device");
        continue;
      }
      if (!device.isActive) {
        await reject(index, raw, "inactive_device");
        continue;
      }

      // 3. Accepted: store telemetry (R14, R17) and remember it for the
      // once-per-batch freshness patch below (R19, R20) — never patch here.
      await ctx.db.insert("telemetry", {
        deviceId: device._id,
        ts: reading.ts,
        metric: reading.metric,
        value: reading.value,
      });
      stored++;
      acceptedForFreshness.push({ deviceId: device._id, ts: reading.ts });
    }

    // R13's invariant: every reading is either stored or rejected-with-a-record.
    if (stored + rejectedSummary.length !== readings.length) {
      throw new Error(
        `Ingestion invariant violated: stored (${stored}) + rejected (${rejectedSummary.length}) !== submitted (${readings.length})`,
      );
    }

    // Freshness: at most one patch per device, only from accepted readings,
    // and only when it actually advances lastSeenAt (R19, R20).
    const lastSeenAtByDeviceId = new Map<Id<"devices">, number | undefined>();
    for (const device of deviceCache.values()) {
      if (device) lastSeenAtByDeviceId.set(device._id, device.lastSeenAt);
    }
    const patches = computeFreshnessPatches(
      acceptedForFreshness,
      (deviceId) => lastSeenAtByDeviceId.get(deviceId),
    );
    for (const [deviceId, lastSeenAt] of patches) {
      await ctx.db.patch(deviceId, { status: "online", lastSeenAt });
    }

    return {
      submitted: readings.length,
      stored,
      rejected: rejectedSummary,
    };
  },
});
