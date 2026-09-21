import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUS_GLYPH, StatusBadge, type StatusKind } from "./StatusBadge";

const KINDS: StatusKind[] = ["online", "offline", "stale", "unknown", "decommissioned", "error", "warning"];

describe("StatusBadge (R2)", () => {
  for (const kind of KINDS) {
    it(`renders a glyph and a text label for ${kind}`, () => {
      const { container } = render(<StatusBadge kind={kind} />);
      const badge = container.firstElementChild as HTMLElement;
      const glyph = badge.querySelector('[aria-hidden="true"]');
      expect(glyph?.textContent).toBe(STATUS_GLYPH[kind]);
      const label = (badge.textContent ?? "").replace(glyph?.textContent ?? "", "").trim();
      expect(label.length).toBeGreaterThan(0);
    });
  }

  it("uses a distinct glyph per kind so states differ in grayscale", () => {
    const glyphs = KINDS.map((kind) => STATUS_GLYPH[kind]);
    expect(new Set(glyphs).size).toBe(KINDS.length);
  });

  it("shows the human label", () => {
    render(<StatusBadge kind="decommissioned" />);
    expect(screen.getByText("Decommissioned")).toBeInTheDocument();
  });

  it("lets the caller override the label but keeps the glyph", () => {
    const { container } = render(<StatusBadge kind="stale" label="Stale · 3m ago" />);
    expect(screen.getByText("Stale · 3m ago")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(STATUS_GLYPH.stale);
  });
});
