import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { normalizeExternalIdKey } from "./lib/validation";

const reading = v.object({
  externalId: v.string(),
  ts: v.number(),
  metric: v.string(),
  value: v.union(v.number(), v.string()),
});

// Entry point for the gateway/simulator service (spec R12). INTERNAL: not
// callable by any client. The only way in is `POST /ingest/telemetry`
// (http.ts), which requires the INGEST_SERVICE_TOKEN service credential -
// a user session cannot substitute for it.
export const recordBatch = internalMutation({
  args: { readings: v.array(reading) },
  handler: async (ctx, { readings }) => {
    // R20: lookup is by the normalized key, so a gateway sending `SIM-CNC-01`
    // matches a device registered as `sim-cnc-01`.
    const deviceCache = new Map<string, Doc<"devices"> | null>();
    const rejections = new Map<Id<"devices">, { count: number; lastAt: number; externalId: string }>();

    for (const r of readings) {
      const key = normalizeExternalIdKey(r.externalId);
      let device = deviceCache.get(key);
      if (device === undefined) {
        device = await ctx.db
          .query("devices")
          .withIndex("by_externalIdKey", (q) => q.eq("externalIdKey", key))
          .unique();
        deviceCache.set(key, device);
      }
      if (!device) {
        // Unregistered device: skip rather than silently create one.
        continue;
      }

      if (device.lifecycle === "decommissioned") {
        // R26: never resurrect a decommissioned device's state; the
        // occurrence is aggregated (once per batch per device) and observable
        // rather than dropped without trace.
        const running = rejections.get(device._id) ?? {
          count: 0,
          lastAt: r.ts,
          externalId: device.externalId,
        };
        running.count += 1;
        running.lastAt = Math.max(running.lastAt, r.ts);
        rejections.set(device._id, running);
        continue;
      }

      await ctx.db.insert("telemetry", {
        deviceId: device._id,
        ts: r.ts,
        metric: r.metric,
        value: r.value,
      });

      await ctx.db.patch(device._id, {
        status: "online",
        lastSeenAt: r.ts,
      });
      // Keep the cache in sync in case a later reading in the same batch
      // re-reads this device (e.g. for its lastSeenAt).
      deviceCache.set(key, { ...device, status: "online", lastSeenAt: r.ts });
    }

    for (const [deviceId, { count, lastAt, externalId }] of rejections) {
      const device = await ctx.db.get(deviceId);
      if (!device) continue;
      await ctx.db.patch(deviceId, {
        rejectedReadingCount: (device.rejectedReadingCount ?? 0) + count,
        lastRejectedReadingAt: lastAt,
      });
      console.warn(
        `ingest.recordBatch: rejected ${count} reading(s) for decommissioned device ` +
          `${externalId} (${deviceId})`,
      );
    }
  },
});
