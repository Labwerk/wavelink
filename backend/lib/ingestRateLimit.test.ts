import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTokenBucket,
  clampRetryAfterMs,
  MAX_RETRY_AFTER_MS,
  type TokenBucketConfig,
} from "./ingestRateLimit.ts";

const config: TokenBucketConfig = { rate: 60, periodMs: 60_000, capacity: 10 }; // 1 token/sec, burst 10

test("a fresh bucket starts full: the burst allowance is available immediately", () => {
  const result = applyTokenBucket(null, config, 0, 1);
  assert.equal(result.ok, true);
  assert.equal(result.retryAfter, 0);
  assert.equal(result.newState.tokens, config.capacity - 1);
});

test("consuming up to capacity in a burst succeeds; the next one is throttled", () => {
  let bucket = null as ReturnType<typeof applyTokenBucket>["newState"] | null;
  for (let i = 0; i < config.capacity; i++) {
    const result = applyTokenBucket(bucket, config, 0, 1);
    assert.equal(result.ok, true, `request ${i} should succeed within burst capacity`);
    bucket = result.newState;
  }
  const overCapacity = applyTokenBucket(bucket, config, 0, 1);
  assert.equal(overCapacity.ok, false);
  assert.ok(overCapacity.retryAfter > 0);
});

test("a denied request does not consume tokens", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  const before = applyTokenBucket(empty, config, 0, 1);
  assert.equal(before.ok, false);
  assert.equal(before.newState.tokens, 0);
});

test("tokens refill over time at the configured rate", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  // 1 token/sec configured; after 5000ms, 5 tokens should be available.
  const result = applyTokenBucket(empty, config, 5000, 5);
  assert.equal(result.ok, true);
  assert.equal(result.newState.tokens, 0);
});

test("refill is capped at capacity — a long idle period does not overflow the bucket", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  const result = applyTokenBucket(empty, config, 1_000_000, 1);
  assert.equal(result.ok, true);
  assert.equal(result.newState.tokens, config.capacity - 1);
});

test("retryAfter estimates when enough tokens will be available", () => {
  const empty = { tokens: 0, lastRefillAt: 0 };
  // Needs 3 tokens at 1 token/sec => retryAfter ~3000ms.
  const result = applyTokenBucket(empty, config, 0, 3);
  assert.equal(result.ok, false);
  assert.equal(result.retryAfter, 3000);
});

test("normal batching cadence within the burst allowance is never throttled (R21 acceptance)", () => {
  // Simulates the simulator: one request of cost 1 every 2 seconds, well
  // under 1 token/sec refill plus a burst of 10.
  let bucket = null as ReturnType<typeof applyTokenBucket>["newState"] | null;
  let now = 0;
  for (let i = 0; i < 50; i++) {
    const result = applyTokenBucket(bucket, config, now, 1);
    assert.equal(result.ok, true, `tick ${i} should not be throttled`);
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
  assert.equal(allowed, config.capacity);
  assert.equal(denied, 10);
});

test("a rate of 0 produces an Infinite retryAfter from applyTokenBucket", () => {
  const disabled: TokenBucketConfig = { rate: 0, periodMs: 60_000, capacity: 10 };
  const empty = { tokens: 0, lastRefillAt: 0 };
  const result = applyTokenBucket(empty, disabled, 0, 1);
  assert.equal(result.ok, false);
  assert.equal(result.retryAfter, Infinity);
});

test("clampRetryAfterMs passes finite values through unchanged", () => {
  assert.equal(clampRetryAfterMs(0), 0);
  assert.equal(clampRetryAfterMs(1500), 1500);
});

test("clampRetryAfterMs clamps Infinity (and other non-finite values) to MAX_RETRY_AFTER_MS", () => {
  assert.equal(clampRetryAfterMs(Infinity), MAX_RETRY_AFTER_MS);
  assert.equal(clampRetryAfterMs(NaN), MAX_RETRY_AFTER_MS);
  assert.equal(clampRetryAfterMs(-Infinity), MAX_RETRY_AFTER_MS);
});

test("clampRetryAfterMs output is always JSON- and header-safe", () => {
  const clamped = clampRetryAfterMs(Infinity);
  assert.equal(JSON.stringify({ retryAfterMs: clamped }), `{"retryAfterMs":${MAX_RETRY_AFTER_MS}}`);
  assert.doesNotThrow(() => String(Math.ceil(clamped / 1000)));
  assert.notEqual(String(Math.ceil(clamped / 1000)), "Infinity");
});

test("two independent buckets (two sourceIds) don't affect each other (R23)", () => {
  const bucketA = { tokens: 0, lastRefillAt: 0 };
  const bucketB = { tokens: config.capacity, lastRefillAt: 0 };

  const resultA = applyTokenBucket(bucketA, config, 0, 1);
  const resultB = applyTokenBucket(bucketB, config, 0, 1);

  assert.equal(resultA.ok, false, "source A is saturated");
  assert.equal(resultB.ok, true, "source B is unaffected by source A's saturation");
});
