import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { STATUS_ICON, STATUS_LABEL, StatusBadge, type StatusKind } from "./StatusBadge";

const KINDS: StatusKind[] = [
  "online",
  "offline",
  "stale",
  "unknown",
  "decommissioned",
  "error",
  "warning",
  "active",
  "inactive",
];

describe("StatusBadge (R2, R12, R13)", () => {
  for (const kind of KINDS) {
    it(`renders exactly one aria-hidden icon and a non-empty text label for ${kind}`, () => {
      const { container } = render(<StatusBadge kind={kind} />);
      const badge = container.firstElementChild as HTMLElement;
      const icons = badge.querySelectorAll('svg[aria-hidden="true"]');
      expect(icons).toHaveLength(1);
      const label = (badge.textContent ?? "").trim();
      expect(label.length).toBeGreaterThan(0);
      expect(screen.getByText(STATUS_LABEL[kind])).toBeInTheDocument();
    });
  }

  it("uses a distinct icon component per kind so states differ in grayscale", () => {
    const icons = KINDS.map((kind) => STATUS_ICON[kind]);
    expect(new Set(icons).size).toBe(KINDS.length);
  });

  it("renders no Unicode status glyph characters", () => {
    for (const kind of KINDS) {
      const { container, unmount } = render(<StatusBadge kind={kind} />);
      expect(container.textContent ?? "").not.toMatch(/[●○◐⊘⚠✕✓]/);
      unmount();
    }
  });

  it("shows the human label", () => {
    render(<StatusBadge kind="decommissioned" />);
    expect(screen.getByText("Decommissioned")).toBeInTheDocument();
  });

  it("lets the caller override the label but keeps the icon", () => {
    const { container } = render(<StatusBadge kind="stale" label="Stale · 3m ago" />);
    expect(screen.getByText("Stale · 3m ago")).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  });

  it("renders every icon at the same size and stroke width (one render site)", () => {
    const rendered = KINDS.map((kind) => {
      const { container, unmount } = render(<StatusBadge kind={kind} />);
      const svg = container.querySelector("svg") as SVGSVGElement;
      const attrs = {
        width: svg.getAttribute("width"),
        height: svg.getAttribute("height"),
        strokeWidth: svg.getAttribute("stroke-width"),
      };
      unmount();
      return attrs;
    });
    const widths = new Set(rendered.map((r) => r.width));
    const heights = new Set(rendered.map((r) => r.height));
    const strokes = new Set(rendered.map((r) => r.strokeWidth));
    expect(widths.size).toBe(1);
    expect(heights.size).toBe(1);
    expect(strokes.size).toBe(1);
  });
});
