import { v } from "convex/values";
import { query } from "./_generated/server";
import { latestByMetric } from "./lib/latestMetrics";

export const latestForDevice = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    const rows = await ctx.db
      .query("telemetry")
      .withIndex("by_device_and_ts", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(200);

    // Reduce to the latest reading per metric (shared with backend/liveView.ts
    // via backend/lib/latestMetrics.ts — see that module for why this stays a
    // bounded scan here instead of the exact-take(1)-per-metric read liveView
    // uses: this function doesn't know the metric set ahead of time).
    return latestByMetric(rows);
  },
});

// M4: paginated historical range query will be added here
// (telemetry.rangeForDevice) using by_device_and_ts / by_device_metric_and_ts.
