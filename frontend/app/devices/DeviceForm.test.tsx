import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { describe, expect, test, vi } from "vitest";
import { DeviceForm, fieldErrorsFrom } from "./DeviceForm";

// Characterization tests (design-system R18, plan.md phase 0): written and
// green against the pre-Tailwind-migration code, querying only by role,
// label and visible text so they survive the styling migration unmodified.

describe("fieldErrorsFrom", () => {
  test("extracts per-field messages from a ConvexError({ fieldErrors })", () => {
    const error = new ConvexError({
      fieldErrors: [
        { field: "name", message: "Required" },
        { field: "name", message: "Too short" },
      ],
    });
    expect(fieldErrorsFrom(error)).toEqual({ name: "Required; Too short" });
  });

  test("falls back to a generic message for a non-field error", () => {
    expect(fieldErrorsFrom(new Error("boom"))).toEqual({ _form: "boom" });
  });
});

describe("DeviceForm", () => {
  test("a ConvexError with fieldErrors shows each message next to its field (R18)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ConvexError({ fieldErrors: [{ field: "name", message: "Name is required" }] }),
    );
    render(
      <DeviceForm
        mode="register"
        zoneSuggestions={[]}
        typeSuggestions={[]}
        submitting={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /register device/i }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
  });

  test("edit mode disables the external ID field (R18)", () => {
    render(
      <DeviceForm
        mode="edit"
        initial={{ externalId: "sim-1", name: "Mill", type: "cnc-mill", zone: "line-a" }}
        zoneSuggestions={[]}
        typeSuggestions={[]}
        submitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("sim-1")).toBeDisabled();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  test("Add entry then Remove adds and removes a metadata row (R18)", async () => {
    const user = userEvent.setup();
    render(
      <DeviceForm
        mode="register"
        zoneSuggestions={[]}
        typeSuggestions={[]}
        submitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  test("Cancel calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <DeviceForm
        mode="register"
        zoneSuggestions={[]}
        typeSuggestions={[]}
        submitting={false}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
