import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AdminUsersPage from "./page";
import type { Id } from "../../../../backend/_generated/dataModel";

// Characterization tests (design-system R18, plan.md phase 0): written and
// green against the pre-Tailwind-migration code, querying by role/label/text.

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useAction: vi.fn(),
}));

const mockedUseQuery = vi.mocked(useQuery);
const mockedUseMutation = vi.mocked(useMutation);
const mockedUseAction = vi.mocked(useAction);

const adminId = "u-admin" as Id<"users">;
const viewerId = "u-viewer" as Id<"users">;

const users = [
  { _id: adminId, email: "admin@example.com", name: "Admin", role: "admin" as const, isActive: true },
  { _id: viewerId, email: "viewer@example.com", name: "Viewer", role: "viewer" as const, isActive: true },
];

const setRole = vi.fn().mockResolvedValue(undefined);
const setActive = vi.fn().mockResolvedValue(undefined);
const createUser = vi.fn().mockResolvedValue(undefined);

function mockAsAdmin() {
  mockedUseQuery.mockImplementation(((ref: any, ..._args: any[]) => {
    const name = getFunctionName(ref);
    if (name === "users:me") return { _id: adminId, email: "admin@example.com", role: "admin", capabilities: ["user.manage"] };
    if (name === "users:list") return users;
    if (name === "audit:list") return [];
    return undefined;
  }) as any);
  mockedUseMutation.mockImplementation(((ref: any) => {
    const name = getFunctionName(ref);
    if (name === "users:setRole") return setRole;
    if (name === "users:setActive") return setActive;
    return vi.fn();
  }) as any);
  mockedUseAction.mockReturnValue(createUser as any);
}

beforeEach(() => {
  setRole.mockClear();
  setActive.mockClear();
  createUser.mockClear();
});

describe("AdminUsersPage (R18)", () => {
  test("a non-admin sees 'Not available.'", () => {
    mockedUseQuery.mockImplementation(((ref: any) => {
      const name = getFunctionName(ref);
      if (name === "users:me") return { _id: viewerId, email: "viewer@example.com", role: "viewer", capabilities: [] };
      return undefined;
    }) as any);
    mockedUseMutation.mockReturnValue(vi.fn() as any);
    mockedUseAction.mockReturnValue(vi.fn() as any);
    render(<AdminUsersPage />);
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
  });

  test("changing a role select calls setRole", async () => {
    mockAsAdmin();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await user.selectOptions(screen.getByLabelText(/role for viewer@example.com/i), "operator");
    expect(setRole).toHaveBeenCalledWith({ userId: viewerId, role: "operator" });
  });

  test("Deactivate calls setActive", async () => {
    mockAsAdmin();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await user.click(screen.getByRole("button", { name: /deactivate/i }));
    expect(setActive).toHaveBeenCalledWith({ userId: viewerId, isActive: false });
  });

  test("create-user form submits createUser with a trimmed name", async () => {
    mockAsAdmin();
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await user.type(screen.getByPlaceholderText(/^email$/i), "new@example.com");
    await user.type(screen.getByPlaceholderText(/display name/i), "  New User  ");
    await user.type(screen.getByPlaceholderText(/temporary password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create user/i }));

    expect(createUser).toHaveBeenCalledWith({
      email: "new@example.com",
      name: "New User",
      temporaryPassword: "password123",
    });
  });

  test("a createUser error renders", async () => {
    mockAsAdmin();
    createUser.mockRejectedValueOnce(new Error("Email already in use."));
    const user = userEvent.setup();
    render(<AdminUsersPage />);

    await user.type(screen.getByPlaceholderText(/^email$/i), "dup@example.com");
    await user.type(screen.getByPlaceholderText(/temporary password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create user/i }));

    expect(await screen.findByText("Email already in use.")).toBeInTheDocument();
  });
});
