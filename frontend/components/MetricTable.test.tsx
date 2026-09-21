import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MetricTable } from "./MetricTable";

describe("MetricTable", () => {
  test("renders every metric passed in, including a null one as an em dash", () => {
    render(
      <MetricTable
        metrics={[
          { metric: "temperature_c", value: 47, ts: 1_000 },
          { metric: "cycle_count", value: null, ts: null },
        ]}
      />,
    );

    expect(screen.getByText("temperature_c")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("cycle_count")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  test("shows a message instead of an empty table for zero metrics", () => {
    render(<MetricTable metrics={[]} />);
    expect(screen.getByText(/no metrics reported/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
