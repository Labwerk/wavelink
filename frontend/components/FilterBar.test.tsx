import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ALL, FilterBar, type FilterValue } from "./FilterBar";

const baseValue: FilterValue = { zone: ALL, type: ALL, status: ALL };

describe("FilterBar", () => {
  test("selecting a zone calls onChange with only that field updated (R7)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBar
        zones={["line-a", "line-b"]}
        types={["cnc-mill"]}
        statuses={["online", "offline"]}
        value={baseValue}
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/filter by zone/i), "line-a");
    expect(onChange).toHaveBeenCalledWith({ zone: "line-a", type: ALL, status: ALL });
  });

  test("no clear button when nothing is filtered", () => {
    render(
      <FilterBar zones={[]} types={[]} statuses={[]} value={baseValue} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  test("clearing restores all fields to ALL (R7)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBar
        zones={["line-a"]}
        types={["cnc-mill"]}
        statuses={["online"]}
        value={{ zone: "line-a", type: ALL, status: ALL }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({ zone: ALL, type: ALL, status: ALL });
  });
});
