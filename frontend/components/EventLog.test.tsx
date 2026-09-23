import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { EventLog, type EventLogReading } from "./EventLog";

describe("EventLog", () => {
  test("renders every entry passed in (reading rows only — no alert fields)", () => {
    const entries: EventLogReading[] = [
      { id: "e2", ts: 2_000, metric: "temperature_c", value: 50 },
      { id: "e1", ts: 1_000, metric: "temperature_c", value: 45 },
    ];
    render(<EventLog entries={entries} gapThresholdMs={30_000} />);

    expect(screen.getAllByText("temperature_c")).toHaveLength(2);
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });

  test("inserts a gap marker between entries spaced further apart than the threshold (R13)", () => {
    const entries: EventLogReading[] = [
      { id: "e2", ts: 100_000, metric: "temperature_c", value: 50 },
      { id: "e1", ts: 1_000, metric: "temperature_c", value: 45 },
    ];
    const { container } = render(<EventLog entries={entries} gapThresholdMs={30_000} />);
    expect(screen.getByText(/gap of/i)).toBeInTheDocument();
    expect(container.querySelector('[data-kind="warning"]')).toBeInTheDocument();
  });

  test("no gap marker when spacing is within the threshold", () => {
    const entries: EventLogReading[] = [
      { id: "e2", ts: 10_000, metric: "temperature_c", value: 50 },
      { id: "e1", ts: 1_000, metric: "temperature_c", value: 45 },
    ];
    render(<EventLog entries={entries} gapThresholdMs={30_000} />);
    expect(screen.queryByText(/gap of/i)).not.toBeInTheDocument();
  });

  test("shows a message for zero entries", () => {
    render(<EventLog entries={[]} gapThresholdMs={30_000} />);
    expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
  });
});
