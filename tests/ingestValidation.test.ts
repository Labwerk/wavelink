import { expect, test } from "vitest";
import { validateReadingShape, computeFreshnessPatches } from "../backend/lib/ingestValidation";
import { INGEST_CONFIG_DEFAULTS } from "../backend/lib/ingestConfig";

const NOW = 1_700_000_000_000;
const config = INGEST_CONFIG_DEFAULTS;

function wellFormed(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "sim-cnc-01",
    ts: NOW,
    metric: "temperature_c",
    value: 42,
    ...overrides,
  };
}

test("validateReadingShape accepts a well-formed numeric reading", () => {
  expect(validateReadingShape(wellFormed(), config, NOW)).toEqual({ ok: true });
});

test("validateReadingShape accepts a well-formed string-value reading", () => {
  expect(validateReadingShape(wellFormed({ value: "running" }), config, NOW)).toEqual({ ok: true });
});

test("validateReadingShape rejects a non-object reading as wrong_type", () => {
  expect(validateReadingShape("not-an-object", config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
  expect(validateReadingShape(null, config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
  expect(validateReadingShape([1, 2, 3], config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
});

for (const field of ["externalId", "ts", "metric", "value"]) {
  test(`validateReadingShape rejects a reading missing '${field}' as missing_field`, () => {
    const reading = wellFormed();
    delete (reading as Record<string, unknown>)[field];
    expect(validateReadingShape(reading, config, NOW)).toEqual({
      ok: false,
      reason: "missing_field",
    });
  });
}

test("validateReadingShape rejects a reading with an unexpected field", () => {
  expect(validateReadingShape(wellFormed({ extraField: "nope" }), config, NOW)).toEqual({
    ok: false,
    reason: "unexpected_field",
  });
});

test("validateReadingShape rejects wrong-typed fields", () => {
  expect(validateReadingShape(wellFormed({ externalId: 123 }), config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
  expect(validateReadingShape(wellFormed({ ts: "not-a-number" }), config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
  expect(validateReadingShape(wellFormed({ metric: false }), config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
  expect(validateReadingShape(wellFormed({ value: true }), config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
});

test("validateReadingShape rejects empty-string identifiers as missing_field", () => {
  expect(validateReadingShape(wellFormed({ externalId: "" }), config, NOW)).toEqual({
    ok: false,
    reason: "missing_field",
  });
  expect(validateReadingShape(wellFormed({ metric: "" }), config, NOW)).toEqual({
    ok: false,
    reason: "missing_field",
  });
});

test("validateReadingShape rejects a non-finite ts as wrong_type", () => {
  expect(validateReadingShape(wellFormed({ ts: NaN }), config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
  expect(validateReadingShape(wellFormed({ ts: Infinity }), config, NOW)).toEqual({
    ok: false,
    reason: "wrong_type",
  });
});

test("validateReadingShape: timestamp just inside the future-skew bound is accepted", () => {
  const ts = NOW + config.maxFutureSkewMs;
  expect(validateReadingShape(wellFormed({ ts }), config, NOW)).toEqual({ ok: true });
});

test("validateReadingShape: timestamp just beyond the future-skew bound is rejected", () => {
  const ts = NOW + config.maxFutureSkewMs + 1;
  expect(validateReadingShape(wellFormed({ ts }), config, NOW)).toEqual({
    ok: false,
    reason: "timestamp_too_far_future",
  });
});

test("validateReadingShape: timestamp just inside the backfill-age bound is accepted", () => {
  const ts = NOW - config.maxBackfillAgeMs;
  expect(validateReadingShape(wellFormed({ ts }), config, NOW)).toEqual({ ok: true });
});

test("validateReadingShape: timestamp just beyond the backfill-age bound is rejected", () => {
  const ts = NOW - config.maxBackfillAgeMs - 1;
  expect(validateReadingShape(wellFormed({ ts }), config, NOW)).toEqual({
    ok: false,
    reason: "timestamp_too_old",
  });
});

test("validateReadingShape rejects an over-length externalId", () => {
  const externalId = "x".repeat(config.maxExternalIdLength + 1);
  expect(validateReadingShape(wellFormed({ externalId }), config, NOW)).toEqual({
    ok: false,
    reason: "external_id_too_long",
  });
});

test("validateReadingShape accepts an externalId exactly at the length bound", () => {
  const externalId = "x".repeat(config.maxExternalIdLength);
  expect(validateReadingShape(wellFormed({ externalId }), config, NOW)).toEqual({ ok: true });
});

test("validateReadingShape rejects an over-length metric", () => {
  const metric = "x".repeat(config.maxMetricLength + 1);
  expect(validateReadingShape(wellFormed({ metric }), config, NOW)).toEqual({
    ok: false,
    reason: "metric_too_long",
  });
});

test("validateReadingShape rejects an over-length string value", () => {
  const value = "x".repeat(config.maxStringValueLength + 1);
  expect(validateReadingShape(wellFormed({ value }), config, NOW)).toEqual({
    ok: false,
    reason: "string_value_too_long",
  });
});

test("validateReadingShape rejects a non-finite numeric value", () => {
  expect(validateReadingShape(wellFormed({ value: NaN }), config, NOW)).toEqual({
    ok: false,
    reason: "value_not_finite",
  });
  expect(validateReadingShape(wellFormed({ value: Infinity }), config, NOW)).toEqual({
    ok: false,
    reason: "value_not_finite",
  });
  expect(validateReadingShape(wellFormed({ value: -Infinity }), config, NOW)).toEqual({
    ok: false,
    reason: "value_not_finite",
  });
});

// --- freshness monotonicity (R19, R20) ---

test("computeFreshnessPatches: a device with no accepted readings gets no patch", () => {
  const patches = computeFreshnessPatches([], () => 1000);
  expect(patches.size).toBe(0);
});

test("computeFreshnessPatches: an older accepted reading than current lastSeenAt gets no patch (R20)", () => {
  const patches = computeFreshnessPatches([{ deviceId: "device-1", ts: 500 }], () => 1000);
  expect(patches.size).toBe(0);
});

test("computeFreshnessPatches: a newer accepted reading advances lastSeenAt exactly once (R19)", () => {
  const patches = computeFreshnessPatches(
    [
      { deviceId: "device-1", ts: 1500 },
      { deviceId: "device-1", ts: 2000 },
      { deviceId: "device-1", ts: 1200 },
    ],
    () => 1000,
  );
  expect(patches.size).toBe(1);
  expect(patches.get("device-1")).toBe(2000);
});

test("computeFreshnessPatches: a device with no prior lastSeenAt is patched to the max accepted ts", () => {
  const patches = computeFreshnessPatches([{ deviceId: "device-1", ts: 42 }], () => undefined);
  expect(patches.get("device-1")).toBe(42);
});

test("computeFreshnessPatches: multiple devices are patched independently, one entry each", () => {
  const patches = computeFreshnessPatches(
    [
      { deviceId: "device-1", ts: 2000 },
      { deviceId: "device-2", ts: 100 }, // older than device-2's current lastSeenAt
    ],
    (deviceId) => (deviceId === "device-1" ? 1000 : 5000),
  );
  expect(patches.size).toBe(1);
  expect(patches.get("device-1")).toBe(2000);
  expect(patches.has("device-2")).toBe(false);
});

test("computeFreshnessPatches: equal to current lastSeenAt does not count as an advance", () => {
  const patches = computeFreshnessPatches([{ deviceId: "device-1", ts: 1000 }], () => 1000);
  expect(patches.size).toBe(0);
});
