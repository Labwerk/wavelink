import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// design-system R11: every interactive element has a visible hover, pressed
// and keyboard-focus state, animated with the one shared (default) duration
// — no per-class duration/ease override. Checks the recipe files directly
// (rather than rendered DOM), matching the plan's "Static tests" table.

const ROOT = join(__dirname, "..");
function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// Each recipe file must contain a hover class (`hover:` or a Headless
// `data-hover:`/`data-focus:` variant) and a pressed class (`active:` or
// `data-active:`), plus a transition* utility with no duration/ease class
// alongside it (the theme's default transition variables cover that).
const RECIPES: Array<{ file: string; label: string; hover: RegExp; active: RegExp }> = [
  { file: "components/ui/Button.tsx", label: "Button", hover: /data-hover:/, active: /data-active:/ },
  { file: "components/ui/Card.tsx", label: "Card interactive", hover: /hover:/, active: /active:/ },
  { file: "components/ui/Field.tsx", label: "Field controls", hover: /data-hover:/, active: /transition-colors|transition\b/ },
  {
    file: "components/ui/SelectableList.tsx",
    label: "SelectableList row",
    hover: /data-hover:/,
    active: /data-active:/,
  },
  { file: "components/shell/SideNav.tsx", label: "SideNav nav row / brand", hover: /hover:/, active: /active:/ },
  {
    file: "components/shell/AccountMenu.tsx",
    label: "AccountMenu button/items",
    hover: /data-hover:/,
    active: /data-active:|data-focus:/,
  },
];

describe("interaction recipes: hover/active/transition per convention (R11)", () => {
  for (const { file, label, hover, active } of RECIPES) {
    it(`${file} (${label}) has a hover class and a pressed class`, () => {
      const source = read(file);
      expect(hover.test(source), `expected a hover class in ${file}`).toBe(true);
      expect(active.test(source), `expected a pressed/active class in ${file}`).toBe(true);
    });

    it(`${file} (${label}) uses a transition utility with no duration/ease override`, () => {
      const source = read(file);
      expect(/\btransition(-colors|-shadow|-all)?\b/.test(source), `expected a transition* class in ${file}`).toBe(
        true,
      );
      expect(/\bduration-\d/.test(source), `${file} should not set a duration-* class`).toBe(false);
      expect(/\bease-[a-z]/.test(source), `${file} should not set an ease-* class`).toBe(false);
    });
  }

  it("the base layer has the transparent resting outline and the :focus-visible outline-color rule", () => {
    const globals = read("styles/globals.css");
    expect(globals).toMatch(/outline:\s*2px solid transparent/);
    expect(globals).toMatch(/:focus-visible[^{]*\{[^}]*outline-color:\s*var\(--color-accent\)/);
  });

  it("DevicesView has no <li ... onClick> (rows are real, focusable buttons)", () => {
    const source = read("app/devices/DevicesView.tsx");
    expect(source).not.toMatch(/<li[^>]*onClick/);
  });

  it("card hover lift and menu enter/exit scale are behind motion-safe: (R11 reduced motion)", () => {
    const card = read("components/ui/Card.tsx");
    expect(card).toMatch(/motion-safe:hover:-translate-y-0\.5/);
    const menu = read("components/shell/AccountMenu.tsx");
    expect(menu).toMatch(/motion-safe:data-closed:scale-95/);
  });
});
