// Pure per-reading validation and freshness-monotonicity rules
// (telemetry-ingestion R8, R9, R10, R19, R20). No `ctx.db` access here —
// device existence/active checks need the database and live in
// `backend/ingest.ts`, which calls `validateReading()` first and only then
// does the `unknown_device` / `inactive_device` lookup, preserving the fixed
// evaluation order documented below.
import type { IngestConfig } from "./ingestConfig.ts";

/** Stable, machine-readable rejection reason codes (telemetry-ingestion
 * R15). `unknown_device` and `inactive_device` are not produced here — they
 * require `ctx.db` — but are included in the union so callers can carry one
 * `RejectionReason` type end to end. */
export type RejectionReason =
  | "missing_field"
  | "unexpected_field"
  | "wrong_type"
  | "timestamp_too_far_future"
  | "timestamp_too_old"
  | "value_not_finite"
  | "external_id_too_long"
  | "metric_too_long"
  | "string_value_too_long"
  | "unknown_device"
  | "inactive_device";

export type ShapeValidationResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason };

const ALLOWED_FIELDS = new Set(["externalId", "ts", "metric", "value"]);
const REQUIRED_FIELDS = ["externalId", "ts", "metric", "value"] as const;

/**
 * Validates everything about a raw reading that does *not* require a
 * database lookup: shape (required/unexpected fields, field types) → bounds
 * (length limits, finite numeric value) → timestamp window. Evaluation stops
 * at the first failure, so exactly one reason is ever returned per reading
 * (telemetry-ingestion R13's "exactly one reason" invariant) — and this
 * fixed order is what R9's note relies on ("non-numeric ts is caught earlier
 * as wrong_type").
 */
export function validateReadingShape(
  raw: unknown,
  config: IngestConfig,
  now: number,
): ShapeValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "wrong_type" };
  }
  const obj = raw as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) return { ok: false, reason: "missing_field" };
  }
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_FIELDS.has(key)) return { ok: false, reason: "unexpected_field" };
  }

  // --- shape: field types (and "non-empty" for the two identifier strings) ---
  if (typeof obj.externalId !== "string") return { ok: false, reason: "wrong_type" };
  if (obj.externalId.length === 0) return { ok: false, reason: "missing_field" };

  if (typeof obj.ts !== "number") return { ok: false, reason: "wrong_type" };
  // A non-finite "timestamp" (NaN/±Infinity) can't be compared against the
  // future-skew/backfill window below, and typeof still reports "number" for
  // NaN — so it is rejected here, in the shape step, as not a valid numeric
  // timestamp at all.
  if (!Number.isFinite(obj.ts)) return { ok: false, reason: "wrong_type" };

  if (typeof obj.metric !== "string") return { ok: false, reason: "wrong_type" };
  if (obj.metric.length === 0) return { ok: false, reason: "missing_field" };

  if (typeof obj.value !== "number" && typeof obj.value !== "string") {
    return { ok: false, reason: "wrong_type" };
  }

  // --- bounds ---
  if (obj.externalId.length > config.maxExternalIdLength) {
    return { ok: false, reason: "external_id_too_long" };
  }
  if (obj.metric.length > config.maxMetricLength) {
    return { ok: false, reason: "metric_too_long" };
  }
  if (typeof obj.value === "string") {
    if (obj.value.length > config.maxStringValueLength) {
      return { ok: false, reason: "string_value_too_long" };
    }
  } else {
    if (!Number.isFinite(obj.value)) {
      return { ok: false, reason: "value_not_finite" };
    }
  }

  // --- timestamp window ---
  if (obj.ts > now + config.maxFutureSkewMs) {
    return { ok: false, reason: "timestamp_too_far_future" };
  }
  if (obj.ts < now - config.maxBackfillAgeMs) {
    return { ok: false, reason: "timestamp_too_old" };
  }

  return { ok: true };
}

/**
 * Given the accepted readings from a batch (rejected readings must never be
 * passed in — R19), computes the freshness patch to apply per device: the
 * maximum accepted timestamp for each device, but only when it exceeds the
 * device's current `lastSeenAt` (R20's monotonicity rule). A device that
 * would not advance, or that has no accepted readings at all, is omitted
 * from the result entirely — the caller must not patch it.
 */
export function computeFreshnessPatches<DeviceId extends string>(
  acceptedReadings: ReadonlyArray<{ deviceId: DeviceId; ts: number }>,
  currentLastSeenAt: (deviceId: DeviceId) => number | undefined,
): Map<DeviceId, number> {
  const maxAcceptedTsByDevice = new Map<DeviceId, number>();
  for (const reading of acceptedReadings) {
    const current = maxAcceptedTsByDevice.get(reading.deviceId);
    if (current === undefined || reading.ts > current) {
      maxAcceptedTsByDevice.set(reading.deviceId, reading.ts);
    }
  }

  const patches = new Map<DeviceId, number>();
  for (const [deviceId, maxTs] of maxAcceptedTsByDevice) {
    const current = currentLastSeenAt(deviceId) ?? 0;
    if (maxTs > current) {
      patches.set(deviceId, maxTs);
    }
  }
  return patches;
}
