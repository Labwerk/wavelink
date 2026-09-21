import { describe, expect, test } from "vitest";
import { DEFAULT_KEY_METRICS, keyMetricsForType } from "./keyMetrics";

describe("keyMetricsForType", () => {
  test("returns the simulator's metrics for known device types", () => {
    for (const type of ["cnc-mill", "agv", "robot-arm"]) {
      expect(keyMetricsForType(type)).toEqual(DEFAULT_KEY_METRICS);
    }
  });

  test("falls back to DEFAULT_KEY_METRICS for an unknown type", () => {
    expect(keyMetricsForType("some-future-device-type")).toEqual(DEFAULT_KEY_METRICS);
  });

  test("never returns more than 4 entries", () => {
    for (const type of ["cnc-mill", "agv", "robot-arm", "unknown"]) {
      expect(keyMetricsForType(type).length).toBeLessThanOrEqual(4);
    }
  });
});
