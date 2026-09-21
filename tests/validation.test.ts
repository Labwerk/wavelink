// R15/R18/R20/R22: unit tests for the shared validation helpers, independent
// of any Convex mutation.

import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test } from "vitest";
import {
  normalizeExternalIdKey,
  throwIfErrors,
  trimToUndefinedIfBlank,
  validateMetadataInto,
  validateRequiredTrimmed,
  type FieldError,
} from "../backend/lib/validation";

afterEach(() => {
  delete process.env.DEVICE_METADATA_MAX_ENTRIES;
  delete process.env.DEVICE_METADATA_MAX_KEY_LENGTH;
  delete process.env.DEVICE_METADATA_MAX_VALUE_LENGTH;
});

describe("normalizeExternalIdKey (R20)", () => {
  test("trims then lowercases", () => {
    expect(normalizeExternalIdKey("  ROBOT-01 ")).toBe("robot-01");
    expect(normalizeExternalIdKey("robot-01")).toBe("robot-01");
  });
});

describe("validateRequiredTrimmed (R18)", () => {
  test("returns the trimmed value when non-empty", () => {
    const errors: FieldError[] = [];
    expect(validateRequiredTrimmed("name", "  Robot One  ", errors)).toBe("Robot One");
    expect(errors).toEqual([]);
  });

  test("empty, whitespace-only, or missing values append a field error", () => {
    for (const value of ["", "   "]) {
      const errors: FieldError[] = [];
      validateRequiredTrimmed("name", value, errors);
      expect(errors).toEqual([{ field: "name", message: "name is required" }]);
    }
  });
});

describe("trimToUndefinedIfBlank", () => {
  test("blank becomes undefined, otherwise trims", () => {
    expect(trimToUndefinedIfBlank("   ")).toBeUndefined();
    expect(trimToUndefinedIfBlank("")).toBeUndefined();
    expect(trimToUndefinedIfBlank(" Line 2 ")).toBe("Line 2");
  });
});

describe("validateMetadataInto (R22)", () => {
  test("within bounds: no errors", () => {
    const errors: FieldError[] = [];
    validateMetadataInto({ voltage: "220" }, errors);
    expect(errors).toEqual([]);
  });

  test("undefined metadata: no errors", () => {
    const errors: FieldError[] = [];
    validateMetadataInto(undefined, errors);
    expect(errors).toEqual([]);
  });

  test("too many entries is a validation error, not truncation", () => {
    process.env.DEVICE_METADATA_MAX_ENTRIES = "2";
    const metadata = { a: "1", b: "2", c: "3" };
    const errors: FieldError[] = [];
    validateMetadataInto(metadata, errors);
    expect(errors.length).toBe(1);
    expect(errors[0].field).toBe("metadata");
    // Caller is responsible for not persisting `metadata` unchanged when errors exist.
    expect(metadata).toEqual({ a: "1", b: "2", c: "3" });
  });

  test("an over-length key or value is a validation error", () => {
    process.env.DEVICE_METADATA_MAX_KEY_LENGTH = "3";
    process.env.DEVICE_METADATA_MAX_VALUE_LENGTH = "3";
    const errors: FieldError[] = [];
    validateMetadataInto({ longkey: "longvalue" }, errors);
    expect(errors.length).toBe(2);
  });
});

describe("throwIfErrors", () => {
  test("throws a ConvexError carrying fieldErrors when non-empty", () => {
    const errors: FieldError[] = [{ field: "name", message: "name is required" }];
    try {
      throwIfErrors(errors);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConvexError);
      expect((e as ConvexError<{ fieldErrors: FieldError[] }>).data.fieldErrors).toEqual(errors);
    }
  });

  test("does nothing when empty", () => {
    expect(() => throwIfErrors([])).not.toThrow();
  });
});
