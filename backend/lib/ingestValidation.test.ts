import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReadingShape, computeFreshnessPatches } from "./ingestValidation.ts";
import { INGEST_CONFIG_DEFAULTS } from "./ingestConfig.ts";

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
  assert.deepEqual(validateReadingShape(wellFormed(), config, NOW), { ok: true });
});

test("validateReadingShape accepts a well-formed string-value reading", () => {
  assert.deepEqual(
    validateReadingShape(wellFormed({ value: "running" }), config, NOW),
    { ok: true },
  );
});

test("validateReadingShape rejects a non-object reading as wrong_type", () => {
  assert.deepEqual(validateReadingShape("not-an-object", config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
  assert.deepEqual(validateReadingShape(null, config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
  assert.deepEqual(validateReadingShape([1, 2, 3], config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
});

for (const field of ["externalId", "ts", "metric", "value"]) {
  test(`validateReadingShape rejects a reading missing '${field}' as missing_field`, () => {
    const reading = wellFormed();
    delete (reading as Record<string, unknown>)[field];
    assert.deepEqual(validateReadingShape(reading, config, NOW), {
      ok: false,
      reason: "missing_field",
    });
  });
}

test("validateReadingShape rejects a reading with an unexpected field", () => {
  assert.deepEqual(
    validateReadingShape(wellFormed({ extraField: "nope" }), config, NOW),
    { ok: false, reason: "unexpected_field" },
  );
});

test("validateReadingShape rejects wrong-typed fields", () => {
  assert.deepEqual(validateReadingShape(wellFormed({ externalId: 123 }), config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ ts: "not-a-number" }), config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ metric: false }), config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ value: true }), config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
});

test("validateReadingShape rejects empty-string identifiers as missing_field", () => {
  assert.deepEqual(validateReadingShape(wellFormed({ externalId: "" }), config, NOW), {
    ok: false,
    reason: "missing_field",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ metric: "" }), config, NOW), {
    ok: false,
    reason: "missing_field",
  });
});

test("validateReadingShape rejects a non-finite ts as wrong_type", () => {
  assert.deepEqual(validateReadingShape(wellFormed({ ts: NaN }), config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ ts: Infinity }), config, NOW), {
    ok: false,
    reason: "wrong_type",
  });
});

test("validateReadingShape: timestamp just inside the future-skew bound is accepted", () => {
  const ts = NOW + config.maxFutureSkewMs;
  assert.deepEqual(validateReadingShape(wellFormed({ ts }), config, NOW), { ok: true });
});

test("validateReadingShape: timestamp just beyond the future-skew bound is rejected", () => {
  const ts = NOW + config.maxFutureSkewMs + 1;
  assert.deepEqual(validateReadingShape(wellFormed({ ts }), config, NOW), {
    ok: false,
    reason: "timestamp_too_far_future",
  });
});

test("validateReadingShape: timestamp just inside the backfill-age bound is accepted", () => {
  const ts = NOW - config.maxBackfillAgeMs;
  assert.deepEqual(validateReadingShape(wellFormed({ ts }), config, NOW), { ok: true });
});

test("validateReadingShape: timestamp just beyond the backfill-age bound is rejected", () => {
  const ts = NOW - config.maxBackfillAgeMs - 1;
  assert.deepEqual(validateReadingShape(wellFormed({ ts }), config, NOW), {
    ok: false,
    reason: "timestamp_too_old",
  });
});

test("validateReadingShape rejects an over-length externalId", () => {
  const externalId = "x".repeat(config.maxExternalIdLength + 1);
  assert.deepEqual(validateReadingShape(wellFormed({ externalId }), config, NOW), {
    ok: false,
    reason: "external_id_too_long",
  });
});

test("validateReadingShape accepts an externalId exactly at the length bound", () => {
  const externalId = "x".repeat(config.maxExternalIdLength);
  assert.deepEqual(validateReadingShape(wellFormed({ externalId }), config, NOW), { ok: true });
});

test("validateReadingShape rejects an over-length metric", () => {
  const metric = "x".repeat(config.maxMetricLength + 1);
  assert.deepEqual(validateReadingShape(wellFormed({ metric }), config, NOW), {
    ok: false,
    reason: "metric_too_long",
  });
});

test("validateReadingShape rejects an over-length string value", () => {
  const value = "x".repeat(config.maxStringValueLength + 1);
  assert.deepEqual(validateReadingShape(wellFormed({ value }), config, NOW), {
    ok: false,
    reason: "string_value_too_long",
  });
});

test("validateReadingShape rejects a non-finite numeric value", () => {
  assert.deepEqual(validateReadingShape(wellFormed({ value: NaN }), config, NOW), {
    ok: false,
    reason: "value_not_finite",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ value: Infinity }), config, NOW), {
    ok: false,
    reason: "value_not_finite",
  });
  assert.deepEqual(validateReadingShape(wellFormed({ value: -Infinity }), config, NOW), {
    ok: false,
    reason: "value_not_finite",
  });
});

// --- freshness monotonicity (R19, R20) ---

test("computeFreshnessPatches: a device with no accepted readings gets no patch", () => {
  const patches = computeFreshnessPatches([], () => 1000);
  assert.equal(patches.size, 0);
});

test("computeFreshnessPatches: an older accepted reading than current lastSeenAt gets no patch (R20)", () => {
  const patches = computeFreshnessPatches(
    [{ deviceId: "device-1", ts: 500 }],
    () => 1000,
  );
  assert.equal(patches.size, 0);
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
  assert.equal(patches.size, 1);
  assert.equal(patches.get("device-1"), 2000);
});

test("computeFreshnessPatches: a device with no prior lastSeenAt is patched to the max accepted ts", () => {
  const patches = computeFreshnessPatches(
    [{ deviceId: "device-1", ts: 42 }],
    () => undefined,
  );
  assert.equal(patches.get("device-1"), 42);
});

test("computeFreshnessPatches: multiple devices are patched independently, one entry each", () => {
  const patches = computeFreshnessPatches(
    [
      { deviceId: "device-1", ts: 2000 },
      { deviceId: "device-2", ts: 100 }, // older than device-2's current lastSeenAt
    ],
    (deviceId) => (deviceId === "device-1" ? 1000 : 5000),
  );
  assert.equal(patches.size, 1);
  assert.equal(patches.get("device-1"), 2000);
  assert.equal(patches.has("device-2"), false);
});

test("computeFreshnessPatches: equal to current lastSeenAt does not count as an advance", () => {
  const patches = computeFreshnessPatches(
    [{ deviceId: "device-1", ts: 1000 }],
    () => 1000,
  );
  assert.equal(patches.size, 0);
});
