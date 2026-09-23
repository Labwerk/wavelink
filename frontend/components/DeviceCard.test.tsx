import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { DeviceCard, type DeviceCardDevice } from "./DeviceCard";

const baseDevice: DeviceCardDevice = {
  deviceId: "device-1",
  externalId: "sim-cnc-01",
  name: "CNC Mill 1",
  type: "cnc-mill",
  zone: "line-a",
  status: "online",
  lastSeenAt: 1_000_000,
  expectedIntervalMs: 10_000,
  keyMetrics: [
    { metric: "temperature_c", value: 47, ts: 1_000_000 },
    { metric: "cycle_count", value: null, ts: null },
  ],
};

describe("DeviceCard", () => {
  test("a live device renders no Stale text, and status/last-seen match the input verbatim (R1)", () => {
    const now = baseDevice.lastSeenAt! + 1_000; // well within 10s * 3 = 30s
    const { container } = render(<DeviceCard device={baseDevice} now={now} />);

    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument();
    expect(screen.getByText(/status:/i).textContent).toMatch(/online/i);
    expect(container.querySelector('[data-kind="online"]')).toBeInTheDocument();
  });

  test("a device past its staleness threshold renders a text Stale badge (R6, R13)", () => {
    const now = baseDevice.lastSeenAt! + 10_000 * 3 + 1; // just past threshold
    const { container } = render(<DeviceCard device={baseDevice} now={now} />);

    expect(screen.getByText(/stale/i)).toBeInTheDocument();
    expect(container.querySelector('[data-kind="stale"]')).toBeInTheDocument();
  });

  test("a metric with no reading renders as an em dash, not a blank or zero (R2)", () => {
    render(<DeviceCard device={baseDevice} now={baseDevice.lastSeenAt!} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test('a device that has never reported shows "never" last-seen and is flagged not-live (R13)', () => {
    const neverSeen: DeviceCardDevice = { ...baseDevice, lastSeenAt: undefined };
    const { container } = render(<DeviceCard device={neverSeen} now={2_000_000} />);
    expect(screen.getAllByText(/never/i).length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-kind="unknown"]')).toBeInTheDocument();
  });
});
