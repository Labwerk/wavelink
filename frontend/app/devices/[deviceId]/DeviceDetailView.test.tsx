import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useQuery } from "convex/react";
import { describe, expect, test, vi } from "vitest";
import { DeviceDetailView } from "./DeviceDetailView";
import type { Id } from "../../../../backend/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);

function mockQueries({ snapshot, events }: { snapshot: unknown; events: unknown }) {
  mockedUseQuery.mockImplementation((ref: any, ..._args: any[]) => {
    const name = getFunctionName(ref);
    if (name === "liveView:deviceSnapshot") return snapshot;
    if (name === "liveView:recentEvents") return events;
    throw new Error(`Unexpected query reference: ${name}`);
  });
}

const deviceId = "device-1" as Id<"devices">;

const liveDevice = {
  deviceId,
  externalId: "sim-cnc-01",
  name: "CNC Mill 1",
  type: "cnc-mill",
  zone: "line-a",
  status: "online" as const,
  lastSeenAt: Date.now(),
  lifecycle: "in_service" as const,
  metadata: undefined,
  expectedIntervalMs: 10_000,
};

describe("DeviceDetailView", () => {
  test("renders a loading state while the snapshot query is pending", () => {
    mockQueries({ snapshot: undefined, events: undefined });
    render(<DeviceDetailView deviceId={deviceId} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test("renders 'Device not found' for a null snapshot", () => {
    mockQueries({ snapshot: null, events: [] });
    render(<DeviceDetailView deviceId={deviceId} />);
    expect(screen.getByText(/device not found/i)).toBeInTheDocument();
  });

  test("renders metrics and event log for a live device (R3, R4)", () => {
    mockQueries({
      snapshot: {
        device: liveDevice,
        metrics: [{ metric: "temperature_c", value: 47, ts: Date.now() }],
      },
      events: [{ id: "e1", ts: Date.now(), metric: "temperature_c", value: 47 }],
    });

    render(<DeviceDetailView deviceId={deviceId} />);

    expect(screen.getByText("CNC Mill 1")).toBeInTheDocument();
    // Appears once in the metrics table and once in the event log.
    expect(screen.getAllByText("temperature_c")).toHaveLength(2);
    expect(screen.queryByText("Decommissioned")).not.toBeInTheDocument();
  });

  test("labels a decommissioned device instead of hiding it (R3 edge case / T12)", () => {
    mockQueries({
      snapshot: {
        device: {
          deviceId,
          externalId: "sim-cnc-01",
          name: "Retired Mill",
          type: "cnc-mill",
          zone: undefined,
          status: "offline",
          lastSeenAt: undefined,
          lifecycle: "decommissioned",
          metadata: undefined,
          expectedIntervalMs: 10_000,
        },
        metrics: [],
      },
      events: [],
    });

    render(<DeviceDetailView deviceId={deviceId} />);

    expect(screen.getByText("Retired Mill")).toBeInTheDocument();
    expect(screen.getByText("Decommissioned")).toBeInTheDocument();
  });
});
