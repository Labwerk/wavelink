import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export interface MetricReading {
  metric: string;
  value: number | string | null;
  ts: number | null;
}

/**
 * Resolve the latest reading for each of `metrics`, for one device, with an
 * exact per-`(deviceId, metric)` indexed read — `by_device_metric_and_ts`
 * desc `.take(1)` — issued in parallel. Bounded and exact: ~1 doc read per
 * metric instead of a sampled scan, so a metric that stopped reporting still
 * shows its true last value instead of silently disappearing or showing a
 * stale sampled one (specs/live-telemetry-view/plan.md, "Latest-value read
 * pattern"). A metric with no reading at all resolves to `{ value: null, ts:
 * null }` rather than being omitted, so the client can render it as "—"
 * (distinguishable from an actual `0`) instead of a shorter list silently
 * dropping it.
 */
export async function resolveLatestMetrics(
  ctx: QueryCtx,
  deviceId: Id<"devices">,
  metrics: readonly string[],
): Promise<MetricReading[]> {
  return Promise.all(
    metrics.map(async (metric): Promise<MetricReading> => {
      const rows = await ctx.db
        .query("telemetry")
        .withIndex("by_device_metric_and_ts", (q) =>
          q.eq("deviceId", deviceId).eq("metric", metric),
        )
        .order("desc")
        .take(1);
      const latest = rows[0];
      return {
        metric,
        value: latest ? latest.value : null,
        ts: latest ? latest.ts : null,
      };
    }),
  );
}

/**
 * Reduce telemetry rows already ordered newest-first to the latest row per
 * metric. Pure — no `ctx`/database dependency — so it's directly unit
 * testable. Shared by `telemetry.latestForDevice` (bounded scan over an
 * unknown metric set) so the reduction logic isn't duplicated between it and
 * this feature's exact-`take(1)`-per-known-metric reads.
 */
export function latestByMetric<T extends { metric: string }>(rowsDesc: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const row of rowsDesc) {
    if (!seen.has(row.metric)) {
      seen.set(row.metric, row);
    }
  }
  return Array.from(seen.values());
}
