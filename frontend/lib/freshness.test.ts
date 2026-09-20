import { describe, expect, test } from "vitest";
import { classifyFreshness, STALE_FACTOR } from "./freshness";

describe("classifyFreshness", () => {
  test('"never" when lastSeenAt is undefined', () => {
    expect(
      classifyFreshness({ lastSeenAt: undefined, expectedIntervalMs: 10_000, now: 1_000_000 }),
    ).toBe("never");
  });

  test('"live" at exactly the threshold', () => {
    const expectedIntervalMs = 10_000;
    const lastSeenAt = 0;
    const now = lastSeenAt + expectedIntervalMs * STALE_FACTOR;
    expect(classifyFreshness({ lastSeenAt, expectedIntervalMs, now })).toBe("live");
  });

  test('"stale" just past the threshold', () => {
    const expectedIntervalMs = 10_000;
    const lastSeenAt = 0;
    const now = lastSeenAt + expectedIntervalMs * STALE_FACTOR + 1;
    expect(classifyFreshness({ lastSeenAt, expectedIntervalMs, now })).toBe("stale");
  });

  test('"live" well within the threshold', () => {
    expect(
      classifyFreshness({ lastSeenAt: 100_000, expectedIntervalMs: 10_000, now: 101_000 }),
    ).toBe("live");
  });
});
