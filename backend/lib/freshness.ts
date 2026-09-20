// Expected reporting interval per device type, used to resolve R6's
// staleness threshold. Threshold *values* live here, server-side, but the
// actual "is this device stale right now" comparison runs client-side
// against a ticking clock (specs/live-telemetry-view/plan.md, "Staleness
// computation") — a Convex query must never call Date.now() and compare
// against it, since that churns the query cache without ever being re-run
// as wall-clock time itself advances.

export const STALE_FACTOR = 3;

const DEFAULT_EXPECTED_INTERVAL_MS = 10_000;

// Per-device-type override, empty for now — every simulated type reports on
// the same ~2s cadence, so the default covers them all. A real deployment
// with a slower-reporting device type would add an entry here.
const EXPECTED_INTERVAL_MS_BY_TYPE: Readonly<Record<string, number>> = {};

export interface DeviceForFreshness {
  type: string;
  metadata?: Record<string, string> | undefined;
}

/**
 * Resolve the expected reporting interval (ms) for a device: its
 * `metadata.expectedIntervalMs` override if present and valid, else the
 * type default, else the global default. `STALE_FACTOR * this` is the
 * staleness threshold (specs/live-telemetry-view/plan.md's proposed default:
 * 10s expected → stale after 30s).
 */
export function expectedIntervalMsFor(device: DeviceForFreshness): number {
  const override = device.metadata?.expectedIntervalMs;
  if (override !== undefined) {
    const parsed = Number(override);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return EXPECTED_INTERVAL_MS_BY_TYPE[device.type] ?? DEFAULT_EXPECTED_INTERVAL_MS;
}
