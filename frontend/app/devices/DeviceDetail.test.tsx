import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DeviceDetail } from "./DeviceDetail";
import type { Id } from "../../../backend/_generated/dataModel";

// Characterization tests (design-system R18, plan.md phase 0): written and
// green against the pre-Tailwind-migration code, querying by role/text only.

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseMutation = vi.mocked(useMutation);

const deviceId = "device-1" as Id<"devices">;

interface MockDevice {
  _id: Id<"devices">;
  deviceId: Id<"devices">;
  externalId: string;
  name: string;
  type: string;
  zone: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt: number;
  lifecycle: "in_service" | "decommissioned";
  metadata: Record<string, string>;
  expectedIntervalMs: number;
  rejectedReadingCount: number;
}

const baseDevice: MockDevice = {
  _id: deviceId,
  deviceId,
  externalId: "sim-1",
  name: "CNC Mill 1",
  type: "cnc-mill",
  zone: "line-a",
  status: "online",
  lastSeenAt: Date.now(),
  lifecycle: "in_service",
  metadata: {},
  expectedIntervalMs: 10_000,
  rejectedReadingCount: 0,
};

const decommission = vi.fn().mockResolvedValue(undefined);
const reactivate = vi.fn().mockResolvedValue(undefined);
const updateDevice = vi.fn().mockResolvedValue(undefined);

function mockQueries(overrides: Partial<MockDevice> = {}) {
  mockedUseQuery.mockImplementation(((ref: any, ..._args: any[]) => {
    const name = getFunctionName(ref);
    if (name === "devices:get") return { ...baseDevice, ...overrides };
    if (name === "telemetry:latestForDevice") return [];
    if (name === "devices:changeHistory") return [];
    if (name === "users:list") return [];
    return undefined;
  }) as any);
  mockedUseMutation.mockImplementation(((ref: any) => {
    const name = getFunctionName(ref);
    if (name === "devices:decommission") return decommission;
    if (name === "devices:reactivate") return reactivate;
    if (name === "devices:update") return updateDevice;
    return vi.fn();
  }) as any);
}

beforeEach(() => {
  decommission.mockClear();
  reactivate.mockClear();
  updateDevice.mockClear();
});

describe("DeviceDetail (R18)", () => {
  test("Decommission calls the mutation with no confirmation step", async () => {
    mockQueries();
    const user = userEvent.setup();
    render(<DeviceDetail deviceId={deviceId} isAdmin zoneSuggestions={[]} typeSuggestions={[]} />);

    await user.click(screen.getByRole("button", { name: /decommission/i }));
    expect(decommission).toHaveBeenCalledWith({ deviceId });
  });

  test("Reactivate calls the mutation for a decommissioned device", async () => {
    mockQueries({ lifecycle: "decommissioned" });
    const user = userEvent.setup();
    render(<DeviceDetail deviceId={deviceId} isAdmin zoneSuggestions={[]} typeSuggestions={[]} />);

    await user.click(screen.getByRole("button", { name: /reactivate/i }));
    expect(reactivate).toHaveBeenCalledWith({ deviceId });
  });

  test("the history toggle shows and hides the change-history table", async () => {
    mockQueries();
    const user = userEvent.setup();
    render(<DeviceDetail deviceId={deviceId} isAdmin zoneSuggestions={[]} typeSuggestions={[]} />);

    expect(screen.queryByText(/when/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show change history/i }));
    expect(screen.getByText(/when/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /hide change history/i }));
    expect(screen.queryByText(/when/i)).not.toBeInTheDocument();
  });

  test("a non-admin sees no Edit/Decommission/history controls", () => {
    mockQueries();
    render(<DeviceDetail deviceId={deviceId} isAdmin={false} zoneSuggestions={[]} typeSuggestions={[]} />);
    expect(screen.queryByRole("button", { name: /decommission/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show change history/i })).not.toBeInTheDocument();
  });
});
