import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DevicesView } from "./DevicesView";

// Characterization tests (design-system R18, plan.md phase 0): written and
// green against the pre-Tailwind-migration code, querying by role/label/text
// only, so they survive the styling migration unmodified.

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  usePaginatedQuery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/devices",
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseMutation = vi.mocked(useMutation);
const mockedUsePaginatedQuery = vi.mocked(usePaginatedQuery);

const devices = [
  { _id: "d1", name: "Mill 1", type: "cnc-mill", zone: "line-a", status: "online" as const, lifecycle: "in_service" },
  { _id: "d2", name: "Mill 2", type: "cnc-mill", zone: "line-b", status: "offline" as const, lifecycle: "in_service" },
];

const registerDevice = vi.fn().mockResolvedValue(undefined);

function mockQueries({ isAdmin }: { isAdmin: boolean }) {
  mockedUseQuery.mockImplementation(((ref: any, ..._args: any[]) => {
    const name = getFunctionName(ref);
    if (name === "users:me") {
      return isAdmin
        ? { _id: "u1", email: "a@example.com", role: "admin", capabilities: ["device.manage", "data.read"] }
        : { _id: "u2", email: "v@example.com", role: "viewer", capabilities: ["data.read"] };
    }
    if (name === "devices:facets") return { zones: [], types: [], statuses: [], truncated: false };
    return undefined;
  }) as any);
  mockedUsePaginatedQuery.mockReturnValue({
    results: devices,
    status: "Exhausted",
    loadMore: vi.fn(),
  } as any);
  mockedUseMutation.mockImplementation(((ref: any) => {
    const name = getFunctionName(ref);
    if (name === "devices:register") return registerDevice;
    return vi.fn();
  }) as any);
}

beforeEach(() => {
  mocks.params = new URLSearchParams();
  mocks.replace.mockReset();
  registerDevice.mockClear();
});

describe("DevicesView (R18)", () => {
  test("changing the Zone filter calls router.replace with the same query string shape", async () => {
    mockQueries({ isAdmin: false });
    mockedUseQuery.mockImplementation(((ref: any) => {
      const name = getFunctionName(ref);
      if (name === "users:me") return { _id: "u2", email: "v@example.com", role: "viewer", capabilities: ["data.read"] };
      if (name === "devices:facets") return { zones: [{ value: "line-a", count: 1 }], types: [], statuses: [], truncated: false };
      return undefined;
    }) as any);
    const user = userEvent.setup();
    render(<DevicesView />);

    await user.selectOptions(screen.getByLabelText(/^zone/i), "line-a");
    expect(mocks.replace).toHaveBeenCalledWith("/devices?zone=line-a");
  });

  test("an admin sees and can toggle 'Include decommissioned'", async () => {
    mockQueries({ isAdmin: true });
    const user = userEvent.setup();
    render(<DevicesView />);

    const checkbox = screen.getByLabelText(/include decommissioned/i);
    await user.click(checkbox);
    expect(mocks.replace).toHaveBeenCalledWith("/devices?includeDecommissioned=true");
  });

  test("a viewer does not see 'Include decommissioned'", () => {
    mockQueries({ isAdmin: false });
    render(<DevicesView />);
    expect(screen.queryByLabelText(/include decommissioned/i)).not.toBeInTheDocument();
  });

  test("clicking a device row selects it and shows aria-pressed", async () => {
    mockQueries({ isAdmin: false });
    const user = userEvent.setup();
    render(<DevicesView />);

    const row = screen.getByRole("button", { name: /mill 1/i });
    expect(row).toHaveAttribute("aria-pressed", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  test("'Register device' is shown only for an admin", () => {
    mockQueries({ isAdmin: true });
    const { unmount } = render(<DevicesView />);
    expect(screen.getByRole("button", { name: /register device/i })).toBeInTheDocument();
    unmount();

    mockQueries({ isAdmin: false });
    render(<DevicesView />);
    expect(screen.queryByRole("button", { name: /register device/i })).not.toBeInTheDocument();
  });
});
