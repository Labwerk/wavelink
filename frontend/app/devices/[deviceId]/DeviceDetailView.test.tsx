import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { describe, expect, test, vi } from "vitest";
import { DeviceDetailView } from "./DeviceDetailView";
import type { Id } from "../../../../backend/_generated/dataModel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseMutation = vi.mocked(useMutation);

// `useMutation`'s real return type is callable *and* carries
// `withOptimisticUpdate` — a plain `vi.fn()` satisfies the call shape these
// tests exercise but not that extra property, so it's cast rather than
// stubbing a method nothing here uses.
function mockMutation(impl?: (...args: unknown[]) => unknown) {
  const fn = vi.fn(impl);
  mockedUseMutation.mockReturnValue(fn as unknown as ReturnType<typeof useMutation>);
  return fn;
}

function mockQueries({
  snapshot,
  events,
  me = null,
}: {
  snapshot: unknown;
  events: unknown;
  me?: unknown;
}) {
  mockedUseQuery.mockImplementation((ref: any, ..._args: any[]) => {
    const name = getFunctionName(ref);
    if (name === "liveView:deviceSnapshot") return snapshot;
    if (name === "liveView:recentEvents") return events;
    if (name === "users:me") return me;
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
  isActive: true,
  metadata: undefined,
  expectedIntervalMs: 10_000,
};

describe("DeviceDetailView", () => {
  test("renders a loading state while the snapshot query is pending", () => {
    mockQueries({ snapshot: undefined, events: undefined });
    mockMutation();
    render(<DeviceDetailView deviceId={deviceId} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  test("renders 'Device not found' for a null snapshot", () => {
    mockQueries({ snapshot: null, events: [] });
    mockMutation();
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
    mockMutation();

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
          isActive: false,
          metadata: undefined,
          expectedIntervalMs: 10_000,
        },
        metrics: [],
      },
      events: [],
    });
    mockMutation();

    render(<DeviceDetailView deviceId={deviceId} />);

    expect(screen.getByText("Retired Mill")).toBeInTheDocument();
    expect(screen.getByText("Decommissioned")).toBeInTheDocument();
  });

  test("hides the admin Deactivate action for a caller without device.manage", () => {
    mockQueries({
      snapshot: { device: liveDevice, metrics: [] },
      events: [],
      me: { email: "viewer@example.com", role: "viewer", capabilities: ["data.read"] },
    });
    mockMutation();

    render(<DeviceDetailView deviceId={deviceId} />);
    expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
  });

  test("admin can deactivate an active device (ported from pre-live-telemetry-view dashboard)", async () => {
    const user = userEvent.setup();
    mockQueries({
      snapshot: { device: liveDevice, metrics: [] },
      events: [],
      me: { email: "admin@example.com", role: "admin", capabilities: ["data.read", "device.manage"] },
    });
    const deactivate = mockMutation(() => Promise.resolve(undefined));

    render(<DeviceDetailView deviceId={deviceId} />);
    const button = screen.getByRole("button", { name: /deactivate/i });
    await user.click(button);

    expect(deactivate).toHaveBeenCalledWith({ deviceId });
  });

  test("does not show Deactivate for an already-decommissioned device even as admin", () => {
    mockQueries({
      snapshot: { device: { ...liveDevice, isActive: false }, metrics: [] },
      events: [],
      me: { email: "admin@example.com", role: "admin", capabilities: ["data.read", "device.manage"] },
    });
    mockMutation();

    render(<DeviceDetailView deviceId={deviceId} />);
    expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
  });
});
