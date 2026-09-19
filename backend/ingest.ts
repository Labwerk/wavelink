import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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
    const deviceCache = new Map<string, Id<"devices">>();

    for (const r of readings) {
      let deviceId = deviceCache.get(r.externalId);
      if (!deviceId) {
        const device = await ctx.db
          .query("devices")
          .withIndex("by_externalId", (q) => q.eq("externalId", r.externalId))
          .unique();
        if (!device || !device.isActive) {
          // Unknown/inactive device: skip rather than silently create one.
          continue;
        }
        deviceId = device._id;
        deviceCache.set(r.externalId, deviceId);
      }

      await ctx.db.insert("telemetry", {
        deviceId,
        ts: r.ts,
        metric: r.metric,
        value: r.value,
      });

      await ctx.db.patch(deviceId, {
        status: "online",
        lastSeenAt: r.ts,
      });
    }
  },
});
