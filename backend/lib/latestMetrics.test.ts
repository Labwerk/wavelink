import { describe, expect, test } from "vitest";
import { latestByMetric } from "./latestMetrics";

describe("latestByMetric", () => {
  test("keeps only the first (newest, since input is desc) row per metric", () => {
    const rows = [
      { metric: "temperature_c", ts: 300, value: 55 },
      { metric: "cycle_count", ts: 290, value: 12 },
      { metric: "temperature_c", ts: 100, value: 40 },
      { metric: "error_code", ts: 50, value: 0 },
    ];

    expect(latestByMetric(rows)).toEqual([
      { metric: "temperature_c", ts: 300, value: 55 },
      { metric: "cycle_count", ts: 290, value: 12 },
      { metric: "error_code", ts: 50, value: 0 },
    ]);
  });

  test("returns an empty array for no rows", () => {
    expect(latestByMetric([])).toEqual([]);
  });
});
