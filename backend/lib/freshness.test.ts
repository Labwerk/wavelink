import { describe, expect, test } from "vitest";
import { expectedIntervalMsFor, STALE_FACTOR } from "./freshness";

describe("expectedIntervalMsFor", () => {
  test("returns the type default when there is no metadata override", () => {
    expect(expectedIntervalMsFor({ type: "cnc-mill" })).toBe(10_000);
    expect(expectedIntervalMsFor({ type: "cnc-mill", metadata: {} })).toBe(10_000);
  });

  test("uses a valid metadata.expectedIntervalMs override", () => {
    expect(
      expectedIntervalMsFor({
        type: "cnc-mill",
        metadata: { expectedIntervalMs: "300000" },
      }),
    ).toBe(300_000);
  });

  test("falls back to the type default for an unparseable override", () => {
    expect(
      expectedIntervalMsFor({
        type: "cnc-mill",
        metadata: { expectedIntervalMs: "not-a-number" },
      }),
    ).toBe(10_000);
  });

  test("falls back to the type default for a non-positive override", () => {
    expect(
      expectedIntervalMsFor({ type: "cnc-mill", metadata: { expectedIntervalMs: "0" } }),
    ).toBe(10_000);
    expect(
      expectedIntervalMsFor({ type: "cnc-mill", metadata: { expectedIntervalMs: "-5" } }),
    ).toBe(10_000);
  });

  test("STALE_FACTOR is 3 (10s expected -> 30s stale, per plan.md)", () => {
    expect(STALE_FACTOR).toBe(3);
    expect(expectedIntervalMsFor({ type: "cnc-mill" }) * STALE_FACTOR).toBe(30_000);
  });
});
