// Which telemetry metrics count as "key" for a device type, shown on the
// overview screen (R2) vs. the full metric set shown in the detail view
// (R3). A code-level config constant, not stored data — resolves the spec's
// "Key metrics selection" open question without a schema/registry change
// (specs/live-telemetry-view/plan.md, "Tech decisions" / "Key-metric
// selection"). Matches what gateway/simulator/src/index.ts emits today.

const MAX_KEY_METRICS = 4;

export const DEFAULT_KEY_METRICS: readonly string[] = [
  "temperature_c",
  "cycle_count",
  "error_code",
];

const KEY_METRICS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  "cnc-mill": DEFAULT_KEY_METRICS,
  agv: DEFAULT_KEY_METRICS,
  "robot-arm": DEFAULT_KEY_METRICS,
};

export function keyMetricsForType(deviceType: string): readonly string[] {
  const metrics = KEY_METRICS_BY_TYPE[deviceType] ?? DEFAULT_KEY_METRICS;
  return metrics.slice(0, MAX_KEY_METRICS);
}
