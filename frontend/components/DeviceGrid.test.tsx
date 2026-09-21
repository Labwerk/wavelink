import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DeviceGrid } from "./DeviceGrid";
import type { DeviceCardDevice } from "./DeviceCard";

function device(overrides: Partial<DeviceCardDevice>): DeviceCardDevice {
  return {
    deviceId: overrides.deviceId ?? "d1",
    externalId: "ext-1",
    name: overrides.name ?? "Device",
    type: overrides.type ?? "cnc-mill",
    zone: overrides.zone,
    status: overrides.status ?? "online",
    lastSeenAt: 1_000,
    expectedIntervalMs: 10_000,
    keyMetrics: [],
    ...overrides,
  };
}

describe("DeviceGrid", () => {
  test("renders an empty-state message for zero devices", () => {
    render(<DeviceGrid devices={[]} now={1_000} groupBy="none" />);
    expect(screen.getByText(/no devices match/i)).toBeInTheDocument();
  });

  test("groups devices by zone with a heading per group (R7)", () => {
    const devices = [
      device({ deviceId: "d1", name: "A", zone: "line-a" }),
      device({ deviceId: "d2", name: "B", zone: "line-b" }),
      device({ deviceId: "d3", name: "C", zone: "line-a" }),
    ];
    render(<DeviceGrid devices={devices} now={1_000} groupBy="zone" />);

    expect(screen.getByRole("heading", { name: "line-a" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "line-b" })).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  test("renders one flat grid with no group headings when groupBy is none", () => {
    const devices = [device({ deviceId: "d1", name: "A" }), device({ deviceId: "d2", name: "B" })];
    render(<DeviceGrid devices={devices} now={1_000} groupBy="none" />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});
