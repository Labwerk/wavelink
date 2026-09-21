import { expect, test } from "vitest";
import {
  applyTokenBucket,
  clampRetryAfterMs,
  MAX_RETRY_AFTER_MS,
  type TokenBucketConfig,
} from "../backend/lib/ingestRateLimit";

const config: TokenBucketConfig = { rate: 60, periodMs: 60_000, capacity: 10 }; // 1 token/sec, burst 10

test("a fresh bucket starts full: the burst allowance is available immediately", () => {
  const result = applyTokenBucket(null, config, 0, 1);
  expect(result.ok).toBe(true);
  expect(result.retryAfter).toBe(0);
  expect(result.newState.tokens).toBe(config.capacity - 1);
});

test("consuming up to capacity in a burst succeeds; the next one is throttled", () => {
  let bucket = null as ReturnType<typeof applyTokenBucket>["newState"] | null;
  for (let i = 0; i < config.capacity; i++) {
    const result = applyTokenBucket(bucket, config, 0, 1);
    expect(result.ok, `request ${i} should succeed within burst capacity`).toBe(true);
    bucket = result.newState;
  }
  const overCapacity = applyTokenBucket(bucket, config, 0, 1);
  expect(overCapacity.ok).toBe(false);
  expect(overCapacity.retryAfter).toBeGreaterThan(0);
});

test("a denied request does not consume tokens", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  const before = applyTokenBucket(empty, config, 0, 1);
  expect(before.ok).toBe(false);
  expect(before.newState.tokens).toBe(0);
});

test("tokens refill over time at the configured rate", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  // 1 token/sec configured; after 5000ms, 5 tokens should be available.
  const result = applyTokenBucket(empty, config, 5000, 5);
  expect(result.ok).toBe(true);
  expect(result.newState.tokens).toBe(0);
});

test("refill is capped at capacity — a long idle period does not overflow the bucket", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  const result = applyTokenBucket(empty, config, 1_000_000, 1);
  expect(result.ok).toBe(true);
  expect(result.newState.tokens).toBe(config.capacity - 1);
});

test("retryAfter estimates when enough tokens will be available", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  // Needs 3 tokens at 1 token/sec => retryAfter ~3000ms.
  const result = applyTokenBucket(empty, config, 0, 3);
  expect(result.ok).toBe(false);
  expect(result.retryAfter).toBe(3000);
});

test("normal batching cadence within the burst allowance is never throttled (R21 acceptance)", () => {
  // Simulates the simulator: one request of cost 1 every 2 seconds, well
  // under 1 token/sec refill plus a burst of 10.
  let bucket = null as ReturnType<typeof applyTokenBucket>["newState"] | null;
  let now = 0;
  for (let i = 0; i < 50; i++) {
    const result = applyTokenBucket(bucket, config, now, 1);
    expect(result.ok, `tick ${i} should not be throttled`).toBe(true);
    bucket = result.newState;
    now += 2000;
  }
});

test("a sender exceeding the configured rate is throttled (R21 acceptance)", () => {
  // 20 requests back-to-back with no elapsed time, cost 1 each, capacity 10:
  // the first 10 succeed (burst), the rest are throttled.
  let bucket = null as ReturnType<typeof applyTokenBucket>["newState"] | null;
  let allowed = 0;
  let denied = 0;
  for (let i = 0; i < 20; i++) {
    const result = applyTokenBucket(bucket, config, 0, 1);
    if (result.ok) allowed++;
    else denied++;
    bucket = result.newState;
  }
  expect(allowed).toBe(config.capacity);
  expect(denied).toBe(10);
});

test("a rate of 0 produces an Infinite retryAfter from applyTokenBucket", () => {
  const disabled: TokenBucketConfig = { rate: 0, periodMs: 60_000, capacity: 10 };
  const empty = { tokens: 0, lastRefillAt: 0 };
  const result = applyTokenBucket(empty, disabled, 0, 1);
  expect(result.ok).toBe(false);
  expect(result.retryAfter).toBe(Infinity);
});

test("a cost greater than capacity can never succeed, no matter how long the caller waits", () => {
  // A misconfiguration (e.g. INGEST_READING_BURST set below a batch's
  // reading count) rather than transient throttling: the bucket refills up
  // to `capacity` and never further, so `cost > capacity` is a permanent
  // denial. This is exactly the case `backend/ingestHttp.ts` guards against
  // before ever calling the rate limiter (see its "cost > capacity" check).
  const full = { tokens: config.capacity, lastRefillAt: 0 };
  const immediately = applyTokenBucket(full, config, 0, config.capacity + 1);
  expect(immediately.ok).toBe(false);

  // Even after a very long wait, refill is capped at `capacity` — it never
  // exceeds it, so the same oversized request is still denied.
  const afterALongWait = applyTokenBucket(full, config, 1_000_000_000, config.capacity + 1);
  expect(afterALongWait.ok).toBe(false);
  expect(afterALongWait.newState.tokens).toBeLessThanOrEqual(config.capacity);
});

test("clampRetryAfterMs passes finite values through unchanged", () => {
  expect(clampRetryAfterMs(0)).toBe(0);
  expect(clampRetryAfterMs(1500)).toBe(1500);
});

test("clampRetryAfterMs clamps Infinity (and other non-finite values) to MAX_RETRY_AFTER_MS", () => {
  expect(clampRetryAfterMs(Infinity)).toBe(MAX_RETRY_AFTER_MS);
  expect(clampRetryAfterMs(NaN)).toBe(MAX_RETRY_AFTER_MS);
  expect(clampRetryAfterMs(-Infinity)).toBe(MAX_RETRY_AFTER_MS);
});

test("clampRetryAfterMs output is always JSON- and header-safe", () => {
  const clamped = clampRetryAfterMs(Infinity);
  expect(JSON.stringify({ retryAfterMs: clamped })).toBe(`{"retryAfterMs":${MAX_RETRY_AFTER_MS}}`);
  expect(() => String(Math.ceil(clamped / 1000))).not.toThrow();
  expect(String(Math.ceil(clamped / 1000))).not.toBe("Infinity");
});

test("two independent buckets (two sourceIds) don't affect each other (R23)", () => {
  const bucketA = { tokens: 0, lastRefillAt: 0 };
  const bucketB = { tokens: config.capacity, lastRefillAt: 0 };

  const resultA = applyTokenBucket(bucketA, config, 0, 1);
  const resultB = applyTokenBucket(bucketB, config, 0, 1);

  expect(resultA.ok, "source A is saturated").toBe(false);
  expect(resultB.ok, "source B is unaffected by source A's saturation").toBe(true);
});
