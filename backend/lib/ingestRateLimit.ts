// Hand-rolled token-bucket rate limiter (telemetry-ingestion R21, R22, R23).
//
// Adopted as the fallback named in plan.md's Risks section ("Components on
// the self-hosted backend image") after the `@convex-dev/rate-limiter`
// component spike (tasks.md T2) could not be verified in this build
// environment — see tasks.md's Deviations. Deliberately keeps the same
// call-site shape the plan describes for the component
// (`{ok, retryAfter}`, keyed, inline `config`), so swapping in the real
// component later only touches this module and its Convex-facing wrapper in
// `backend/ingestRateLimit.ts`, not `backend/ingestHttp.ts`.
//
// This module holds the pure, storage-free arithmetic so it can be unit
// tested with `node --test` under a fake clock. The Convex-facing wrapper
// (reading/writing the `ingestRateLimits` table) lives in
// `backend/ingestRateLimit.ts`, since it needs `ctx.db` from the generated
// server module.

export interface TokenBucketConfig {
  /** Tokens added per `periodMs`. */
  rate: number;
  /** Refill period, in milliseconds. */
  periodMs: number;
  /** Maximum tokens the bucket can hold — the burst allowance (R21). */
  capacity: number;
}

export interface TokenBucketState {
  tokens: number;
  lastRefillAt: number;
}

export interface TokenBucketResult {
  ok: boolean;
  /** Milliseconds until enough tokens would be available. `0` when `ok`. */
  retryAfter: number;
  /** The bucket state to persist, whether or not the request was allowed. */
  newState: TokenBucketState;
}

/**
 * Applies one token-bucket check-and-consume step. A missing `bucket` (first
 * request for a key) starts full, at `capacity` — the burst allowance is
 * available immediately rather than ramping up, matching the token-bucket
 * semantics the plan calls for. Denied requests do not consume tokens.
 */
export function applyTokenBucket(
  bucket: TokenBucketState | null,
  config: TokenBucketConfig,
  now: number,
  cost: number,
): TokenBucketResult {
  const refillRatePerMs = config.rate / config.periodMs;
  const elapsedMs = bucket ? Math.max(0, now - bucket.lastRefillAt) : 0;
  const tokensBeforeConsume = bucket
    ? Math.min(config.capacity, bucket.tokens + elapsedMs * refillRatePerMs)
    : config.capacity;

  if (tokensBeforeConsume >= cost) {
    return {
      ok: true,
      retryAfter: 0,
      newState: { tokens: tokensBeforeConsume - cost, lastRefillAt: now },
    };
  }

  const deficit = cost - tokensBeforeConsume;
  const retryAfter = refillRatePerMs > 0 ? Math.ceil(deficit / refillRatePerMs) : Infinity;
  return {
    ok: false,
    retryAfter,
    newState: { tokens: tokensBeforeConsume, lastRefillAt: now },
  };
}
