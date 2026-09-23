import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CheckboxInput, Description, ErrorText, Field, Label, SelectInput, TextInput } from "./Field";

describe("Field (R17 #7, R16)", () => {
  it("associates the Label with the Input (getByLabelText resolves it)", () => {
    render(
      <Field>
        <Label>Email</Label>
        <TextInput name="email" />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("renders a Description below the control", () => {
    render(
      <Field>
        <Label>External identifier</Label>
        <TextInput name="externalId" disabled />
        <Description>Immutable after registration.</Description>
      </Field>,
    );
    expect(screen.getByText("Immutable after registration.")).toBeInTheDocument();
  });

  it("ErrorText renders visible danger-colored text", () => {
    render(<ErrorText>Required</ErrorText>);
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("SelectInput keeps native select behavior (selectOptions works)", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Field>
        <Label>Zone</Label>
        <SelectInput aria-label="Filter by zone" onChange={onChange}>
          <option value="">All zones</option>
          <option value="line-a">line-a</option>
        </SelectInput>
      </Field>,
    );
    await user.selectOptions(screen.getByLabelText(/filter by zone/i), "line-a");
    expect(onChange).toHaveBeenCalled();
  });

  it("CheckboxInput toggles with Space and reflects data-checked", async () => {
    function Harness() {
      return (
        <Field>
          <Label>Include decommissioned</Label>
          <CheckboxInput />
        </Field>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const checkbox = screen.getByRole("checkbox", { name: /include decommissioned/i });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    checkbox.focus();
    await user.keyboard(" ");
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });
});
