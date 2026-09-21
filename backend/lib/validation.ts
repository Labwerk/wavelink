// Shared server-side validation for device writes (spec R15, R18, R20, R22,
// R23). Called by every mutation that touches a device — register, update —
// so a call that bypasses the UI cannot create an invalid record (R23).
// Errors are collected rather than thrown on the first offender, so a
// request with multiple problems (e.g. blank name + duplicate identifier)
// reports one entry per offending field in a single response (R15).

import { ConvexError } from "convex/values";
import {
  metadataMaxEntries,
  metadataMaxKeyLength,
  metadataMaxValueLength,
} from "./config";

export type FieldError = { field: string; message: string };

/** Structured `{ fieldErrors }` payload the frontend maps to per-field errors (R15). */
export function validationError(errors: FieldError[]): ConvexError<{ fieldErrors: FieldError[] }> {
  return new ConvexError({ fieldErrors: errors });
}

export function throwIfErrors(errors: FieldError[]): void {
  if (errors.length > 0) {
    throw validationError(errors);
  }
}

/** R20: the one documented normalization rule — trim, then lowercase. */
export function normalizeExternalIdKey(externalId: string): string {
  return externalId.trim().toLowerCase();
}

/** Trims `value`; if empty, appends a field error and returns the (empty) trimmed value. */
export function validateRequiredTrimmed(
  field: string,
  value: string,
  errors: FieldError[],
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    errors.push({ field, message: `${field} is required` });
  }
  return trimmed;
}

/** Trims `value`; blank becomes `undefined` (used for the optional `zone`). */
export function trimToUndefinedIfBlank(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** R22: bounded entry count and key/value length, appended as field errors — never truncated. */
export function validateMetadataInto(
  metadata: Record<string, string> | undefined,
  errors: FieldError[],
): void {
  if (metadata === undefined) return;
  const entries = Object.entries(metadata);
  const maxEntries = metadataMaxEntries();
  const maxKeyLength = metadataMaxKeyLength();
  const maxValueLength = metadataMaxValueLength();

  if (entries.length > maxEntries) {
    errors.push({
      field: "metadata",
      message: `metadata cannot have more than ${maxEntries} entries (has ${entries.length})`,
    });
  }
  for (const [key, value] of entries) {
    if (key.length > maxKeyLength) {
      errors.push({
        field: "metadata",
        message: `metadata key "${key}" exceeds ${maxKeyLength} characters`,
      });
    }
    if (value.length > maxValueLength) {
      errors.push({
        field: "metadata",
        message: `metadata value for "${key}" exceeds ${maxValueLength} characters`,
      });
    }
  }
}
