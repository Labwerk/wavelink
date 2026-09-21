import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { capabilitiesFor, type Role } from "../../../backend/lib/permissions";

const mocks = vi.hoisted(() => ({
  me: undefined as unknown,
  pathname: "/",
  signOut: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("convex/react", () => ({ useQuery: () => mocks.me }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: mocks.signOut }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("../../../backend/_generated/api", () => ({ api: { users: { me: "users.me" } } }));

import { AppShell } from "./AppShell";

function signedInAs(role: Role, email = `${role}@example.com`) {
  mocks.me = { _id: "u1", email, role, capabilities: capabilitiesFor(role) };
}

function renderShell() {
  return render(
    <AppShell>
      <main>page content</main>
    </AppShell>,
  );
}

beforeEach(() => {
  mocks.me = undefined;
  mocks.pathname = "/";
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  mocks.replace.mockReset();
});

describe("AppShell navigation by role (R4)", () => {
  it("omits Users for a viewer", () => {
    signedInAs("viewer");
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Devices" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("shows Users for an admin", () => {
    signedInAs("admin");
    renderShell();
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
  });

  it("links to the existing destinations (R9)", () => {
    signedInAs("admin");
    renderShell();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Devices" })).toHaveAttribute("href", "/devices");
    expect(screen.getByRole("link", { name: "Wavelink" })).toHaveAttribute("href", "/");
  });
});

describe("AppShell frame (R3)", () => {
  it("renders the nav, top bar identity and the page content", () => {
    signedInAs("operator", "op@example.com");
    renderShell();
    expect(screen.getByRole("banner")).toHaveTextContent("op@example.com");
    expect(screen.getByRole("banner")).toHaveTextContent("operator");
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("renders children only on /signin", () => {
    mocks.pathname = "/signin";
    signedInAs("admin");
    renderShell();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("renders children only when signed out", () => {
    mocks.me = null;
    renderShell();
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("renders the frame without links or identity while loading", () => {
    mocks.me = undefined;
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});

describe("AppShell active section (R5)", () => {
  it("marks the current section and moves when the route changes", () => {
    signedInAs("admin");
    const { rerender } = renderShell();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Devices" })).not.toHaveAttribute("aria-current");

    mocks.pathname = "/devices/abc";
    rerender(
      <AppShell>
        <main>page content</main>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Devices" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("banner")).toHaveTextContent("Devices");
  });
});

describe("AppShell sign out (R9)", () => {
  it("signs out then replaces the route with /signin", async () => {
    signedInAs("viewer");
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/signin");
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.replace.mock.invocationCallOrder[0],
    );
  });
});
