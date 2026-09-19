import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuthenticatedUser } from "./lib/auth";

// Role matrix (spec `specs/auth-roles/spec.md` §4): open to any
// authenticated, active user (all four roles) — R9.
export const latestForDevice = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAuthenticatedUser(ctx);
    const rows = await ctx.db
      .query("telemetry")
      .withIndex("by_device_and_ts", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(200);

    // Reduce to the latest reading per metric.
    const latestByMetric = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestByMetric.has(row.metric)) {
        latestByMetric.set(row.metric, row);
      }
    }
    return Array.from(latestByMetric.values());
  },
});

// M4: paginated historical range query will be added here
// (telemetry.rangeForDevice) using by_device_and_ts / by_device_metric_and_ts.
