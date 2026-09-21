// Pure client-side staleness classifier (R6). Never runs on the server —
// see specs/live-telemetry-view/plan.md "Staleness computation": a Convex
// query must never compare against Date.now(), since that churns the query
// cache without the query itself ever re-running as wall-clock time alone
// advances. `expectedIntervalMs` is resolved server-side per device
// (backend/lib/freshness.ts) and passed through as plain data; this file
// only compares numbers against the shared clock (lib/useNow.ts).

export type Freshness = "never" | "live" | "stale";

// Kept in sync by hand with backend/lib/freshness.ts's STALE_FACTOR — a
// fixed multiplier, not per-device config, so duplicating it here (rather
// than importing across the frontend/backend boundary) is intentional.
export const STALE_FACTOR = 3;

export interface FreshnessInput {
  lastSeenAt: number | undefined;
  expectedIntervalMs: number;
  now: number;
}

export function classifyFreshness({
  lastSeenAt,
  expectedIntervalMs,
  now,
}: FreshnessInput): Freshness {
  if (lastSeenAt === undefined) {
    return "never";
  }
  const staleAfterMs = expectedIntervalMs * STALE_FACTOR;
  return now - lastSeenAt <= staleAfterMs ? "live" : "stale";
}
