import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { loadIngestConfig } from "./lib/ingestConfig";
import { normalizeExternalIdKey } from "./lib/validation";
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

/** Running per-device, per-batch aggregate of readings rejected because the
 * device is decommissioned (device-registry R26): patched onto the device
 * once, after the loop — never once per reading — mirroring the freshness
 * patch's once-per-batch shape below. */
interface DecommissionedRejectionAggregate {
  count: number;
  lastAt: number;
  externalId: string;
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

    // Per-externalIdKey device cache (R20: normalized — trimmed, lowercased
    // — so "SIM-CNC-01" matches a device registered as "sim-cnc-01"),
    // including negative results (unknown devices), so a batch with many
    // readings for the same device only queries `devices` once per distinct
    // key (R11 note: never creates a device row on a miss).
    const deviceCache = new Map<string, Doc<"devices"> | null>();

    const rejectedSummary: RejectedSummaryEntry[] = [];
    const acceptedForFreshness: Array<{ deviceId: Id<"devices">; ts: number }> = [];
    const decommissionedRejections = new Map<Id<"devices">, DecommissionedRejectionAggregate>();
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

      // 2. Device existence / lifecycle (R11, R12) — the one part of
      // validation that needs ctx.db, so it happens after shape validation.
      const key = normalizeExternalIdKey(reading.externalId);
      let device = deviceCache.get(key);
      if (device === undefined) {
        device =
          (await ctx.db
            .query("devices")
            .withIndex("by_externalIdKey", (q) => q.eq("externalIdKey", key))
            .unique()) ?? null;
        deviceCache.set(key, device);
      }
      if (!device) {
        await reject(index, raw, "unknown_device");
        continue;
      }
      if (device.lifecycle === "decommissioned") {
        // R13 still applies: this reading gets its own rejection row and its
        // own entry in the response's rejected[] (via `reject` above), same
        // as any other rejection reason. In addition (device-registry R26),
        // aggregate into a running per-device count/last-timestamp — never
        // resurrecting the device's lifecycle/status/lastSeenAt (it never
        // reaches `acceptedForFreshness` below), but making the refusal
        // observable via `rejectedReadingCount`/`lastRejectedReadingAt`,
        // patched once per device after the loop, not once per reading.
        await reject(index, raw, "inactive_device");
        const running = decommissionedRejections.get(device._id) ?? {
          count: 0,
          lastAt: reading.ts,
          externalId: device.externalId,
        };
        running.count += 1;
        running.lastAt = Math.max(running.lastAt, reading.ts);
        decommissionedRejections.set(device._id, running);
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

    // Devices seen this batch, by _id — used below for both the freshness
    // patch (accepted readings only) and the decommissioned-rejection patch
    // (decommissioned readings only); a device can only ever appear in one
    // of the two, since a decommissioned device's readings never reach
    // `acceptedForFreshness`.
    const devicesById = new Map<Id<"devices">, Doc<"devices">>();
    for (const device of deviceCache.values()) {
      if (device) devicesById.set(device._id, device);
    }

    // Freshness: at most one patch per device, only from accepted readings,
    // and only when it actually advances lastSeenAt (R19, R20).
    const patches = computeFreshnessPatches(
      acceptedForFreshness,
      (deviceId) => devicesById.get(deviceId)?.lastSeenAt,
    );
    for (const [deviceId, lastSeenAt] of patches) {
      await ctx.db.patch(deviceId, { status: "online", lastSeenAt });
    }

    // Decommissioned-rejection aggregate: at most one patch and one
    // console.warn per device, regardless of how many of its readings were
    // rejected in this batch (device-registry R26).
    for (const [deviceId, { count, lastAt, externalId }] of decommissionedRejections) {
      const device = devicesById.get(deviceId);
      await ctx.db.patch(deviceId, {
        rejectedReadingCount: (device?.rejectedReadingCount ?? 0) + count,
        lastRejectedReadingAt: lastAt,
      });
      console.warn(
        `ingest.recordBatch: rejected ${count} reading(s) for decommissioned device ` +
          `${externalId} (${deviceId})`,
      );
    }

    return {
      submitted: readings.length,
      stored,
      rejected: rejectedSummary,
    };
  },
});
