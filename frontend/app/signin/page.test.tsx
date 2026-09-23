import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests (design-system R18, plan.md phase 0): written and
// green against the pre-Tailwind-migration code.

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: mocks.signIn }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

import SignInPage from "./page";

beforeEach(() => {
  mocks.signIn.mockReset();
  mocks.replace.mockReset();
});

describe("SignInPage (R18)", () => {
  it("bad credentials show 'Invalid email or password.'", async () => {
    mocks.signIn.mockRejectedValue(new Error("invalid"));
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.type(screen.getByLabelText(/email/i), "a@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("success replaces to /", async () => {
    mocks.signIn.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SignInPage />);

    await user.type(screen.getByLabelText(/email/i), "a@example.com");
    await user.type(screen.getByLabelText(/password/i), "correct");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(mocks.replace).toHaveBeenCalledWith("/");
  });
});
