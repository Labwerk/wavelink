import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// design-system R7/R15: after the Tailwind migration, all styling values
// come from the @theme in tokens.css via utility classes; nothing is
// fragmented across per-component stylesheets or inline styles. This file
// scans class-token usage in app/, components/ and lib/ so the tests and
// the theme cannot drift (allowed names/scales are parsed from tokens.css).

const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "components", "lib"];
const TOKENS_CSS = readFileSync(join(__dirname, "tokens.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    const isSource = /\.(css|ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name);
    return isSource ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// --- Shared: extract candidate class tokens from a source file ------------
// Every quoted/template string literal, split on whitespace. Tailwind
// classes are the only whitespace-separated tokens in this codebase that
// contain a hyphen or colon and no spaces/natural-language punctuation, so
// filtering to that shape is enough to isolate class tokens from prose,
// aria-labels, event names, etc. without a full TS/JSX parser.
const STRING_LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
const CLASS_LIKE = /^[A-Za-z0-9_:.\-/[\]()%]+$/;
const HAS_HYPHEN_OR_COLON = /[-:]/;

function classTokens(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(STRING_LITERAL)) {
    const text = match[1] ?? match[2] ?? match[3] ?? "";
    if (/\$\{/.test(text)) continue; // skip template literals with interpolation
    for (const word of text.split(/\s+/)) {
      if (!word) continue;
      if (CLASS_LIKE.test(word) && HAS_HYPHEN_OR_COLON.test(word)) out.push(word);
    }
  }
  return out;
}

function stripVariants(token: string): string {
  // Strip variant prefixes (hover:, data-hover:, motion-safe:, sm:, …) for
  // value checks while the full token (with variants) is used for variant
  // checks below.
  const parts = token.split(":");
  return parts[parts.length - 1];
}

// --- Allowed names, parsed from tokens.css so tests and theme can't drift -

function theme() {
  const withoutComments = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens: Record<string, string> = {};
  for (const m of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}
const THEME = theme();
const THEME_COLOR_NAMES = Object.keys(THEME)
  .filter((k) => k.startsWith("--color-"))
  .map((k) => k.slice("--color-".length));
const NAMED_SPACING = ["sidebar", "topbar", "content", "icon"];
const ALLOWED_STEPS = new Set(["0", "0.5", "1", "1.5", "2", "3", "4", "6", "8", "12"]);
const SIZE_KEYWORDS = new Set(["full", "screen", "auto", "px", "fit", "min", "max", "svh", "dvh", "lvh"]);
const CONTAINER_KEYWORDS = new Set([
  "3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl",
]);

function findings(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const name = relative(ROOT, file);
      const source = stripComments(readFileSync(file, "utf8"));

      // No *.module.css anywhere (R15).
      if (file.endsWith(".module.css")) out.push(`${name}: a CSS Module still exists`);

      // No style={{ / style= in TSX.
      if (file.endsWith(".tsx") && /\bstyle\s*=\s*[{"']/.test(source)) {
        out.push(`${name}: inline style attribute`);
      }

      // Color literals only allowed in tokens.css (already excluded from SCAN_DIRS' styles/ folder).
      for (const pattern of [/#[0-9a-fA-F]{3,8}\b/g, /\b(?:rgb|rgba|hsl|hsla|oklch)\(/g]) {
        for (const m of source.matchAll(pattern)) out.push(`${name}: color literal "${m[0]}" outside tokens.css`);
      }

      for (const token of classTokens(source)) {
        const withoutVariants = stripVariants(token);

        // No arbitrary values/properties, no var() shorthand, no opacity/line-height slash.
        if (token.includes("[")) out.push(`${name}: arbitrary value/property "${token}"`);
        if (/-\(--/.test(token)) out.push(`${name}: var() shorthand "${token}"`);
        if (token.includes("/")) out.push(`${name}: "/" modifier "${token}"`);

        // No dark: variant.
        if (/(^|:)dark:/.test(token)) out.push(`${name}: dark: variant "${token}"`);

        // Color utilities must use a theme color name or transparent/current/inherit.
        // These properties are overloaded in Tailwind (e.g. `text-` is also font-size
        // and text-align, `border-` also side/width, `divide-`/`decoration-` also
        // axis/style), so only flag values that look like an actual color reference:
        // purely alphabetic (with hyphens), not a known non-color keyword, and not a
        // theme color name (which is allowed).
        const NON_COLOR_KEYWORDS = new Set([
          "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl",
          "left", "center", "right", "justify", "start", "end",
          "t", "b", "l", "r", "x", "y",
          "none", "solid", "dashed", "dotted", "double", "wavy",
          "auto", "full", "DEFAULT",
        ]);
        const colorMatch = /^(bg|text|border|outline|divide|fill|stroke|placeholder|caret|decoration|accent|ring)-([a-z][a-z-]*)$/.exec(
          withoutVariants,
        );
        if (colorMatch) {
          const value = colorMatch[2];
          const allowed =
            value === "transparent" ||
            value === "current" ||
            value === "inherit" ||
            THEME_COLOR_NAMES.includes(value) ||
            NON_COLOR_KEYWORDS.has(value);
          if (!allowed) out.push(`${name}: non-theme color utility "${token}"`);
        }

        // Numeric spacing/sizing scale.
        const spacingMatch = /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|left|right|bottom|w|h|size|min-w|min-h|max-w|max-h|translate-x|translate-y)-(.+)$/.exec(
          withoutVariants,
        );
        if (spacingMatch) {
          const value = spacingMatch[1] === "space-x" || spacingMatch[1] === "space-y" ? spacingMatch[2].replace(/^reverse$/, "reverse") : spacingMatch[2];
          const isNamed = NAMED_SPACING.includes(value);
          const isKeyword = SIZE_KEYWORDS.has(value) || CONTAINER_KEYWORDS.has(value) || value === "reverse";
          const isNumeric = ALLOWED_STEPS.has(value);
          if (!isNamed && !isKeyword && !isNumeric) {
            out.push(`${name}: spacing/sizing step "${token}" is not in the allowed scale`);
          }
        }

        // Depth: shadow-*, z-*.
        const shadowMatch = /^shadow-(.+)$/.exec(withoutVariants);
        if (shadowMatch && !["1", "2", "none"].includes(shadowMatch[1])) {
          out.push(`${name}: shadow step "${token}" is not 1/2/none`);
        }
        const zMatch = /^z-(.+)$/.exec(withoutVariants);
        if (zMatch && !["10", "20", "30"].includes(zMatch[1])) {
          out.push(`${name}: z-index "${token}" is not 10/20/30`);
        }
        if (/^(ring|inset-shadow|drop-shadow)-/.test(withoutVariants)) {
          out.push(`${name}: banned depth utility "${token}"`);
        }

        // Motion: no duration-*/ease-*/delay-*/animate-*/transition-all; movement needs motion-safe:.
        if (/^(duration|ease|delay|animate)-/.test(withoutVariants) || withoutVariants === "transition-all") {
          out.push(`${name}: banned motion utility "${token}"`);
        }
        if (/^(-?translate-[xy]|-?scale|-?rotate|-?skew)-/.test(withoutVariants) && !/(^|:)motion-safe:/.test(token)) {
          out.push(`${name}: movement utility "${token}" without motion-safe:`);
        }
      }
    }
  }
  return out;
}

// --- Status-symbol Unicode glyph ban (kept, unchanged ranges) -------------

const STATUS_SYMBOL = /[■-◿☀-➿⊕-⊛⬀-⯿\u{1F300}-\u{1FAFF}]/u;

function statusSymbolFindings(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      if (file.endsWith(".css")) continue;
      const source = stripComments(readFileSync(file, "utf8"));
      const name = relative(ROOT, file);
      for (const char of source) {
        if (STATUS_SYMBOL.test(char)) out.push(`${name}: status-symbol glyph "${char}"`);
      }
    }
  }
  return out;
}

// --- Single badge implementation / status color location / lucide import -

// Note: "accent" is deliberately excluded — it is a general-purpose theme
// color (primary buttons, active nav, links, focus ring), not an R13 status
// color. Only these five status hues (plus their -bg tints) are restricted
// to StatusBadge.
const STATUS_COLOR_TOKEN = /\b(?:bg|text|border)-(success|warning|danger|neutral|decommissioned)(-bg)?\b/g;

const STATUS_COLOR_ALLOWLIST = new Set([
  join("components", "ui", "Card.tsx"), // stale card tone
  join("components", "ui", "Field.tsx"), // ErrorText (danger)
  join("app", "devices", "DeviceDetail.tsx"), // rejected-readings notice / action error text
  join("app", "admin", "users", "page.tsx"), // inline error message
  join("app", "signin", "page.tsx"), // inline error message
]);

function badgeFindings(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const name = relative(ROOT, file);
      if (name === join("components", "StatusBadge.tsx")) continue;
      const source = stripComments(readFileSync(file, "utf8"));
      if (/\bfunction\s+\w*Badge\b/.test(source) || /\bconst\s+\w*Badge\s*=/.test(source)) {
        out.push(`${name}: a second Badge-like implementation`);
      }
      if (!STATUS_COLOR_ALLOWLIST.has(name)) {
        for (const match of source.matchAll(STATUS_COLOR_TOKEN)) {
          out.push(`${name}: status color utility "${match[0]}" used outside StatusBadge`);
        }
      }
      if (/from\s+["']lucide-react["']/.test(source)) {
        out.push(`${name}: imports lucide-react outside StatusBadge`);
      }
    }
  }
  return out;
}

// --- R14: page-root outer padding ban --------------------------------------

const PADDING_UTILITY = /^(p|px|py|pt|pr|pb|pl)-/;

function pagePaddingFindings(): string[] {
  const out: string[] = [];
  const appRoot = join(ROOT, "app");
  for (const file of walk(appRoot)) {
    const name = relative(ROOT, file);
    if (name.startsWith(join("app", "signin"))) continue;
    const source = stripComments(readFileSync(file, "utf8"));

    for (const match of source.matchAll(/<main\b([^>]*)>/g)) {
      const attrs = match[1];
      const classMatch = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cx\(([^)]*)\)\})/.exec(attrs);
      const classText = classMatch ? classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "" : "";
      for (const token of classText.split(/[\s,"'`]+/)) {
        if (PADDING_UTILITY.test(stripVariants(token))) {
          out.push(`${name}: <main> has padding utility "${token}"`);
        }
      }
    }
  }
  return out;
}

// --- R11 regression guard: raw CSS `transition` declarations in the base --
// layer must reference the shared duration/easing tokens. Tailwind utility
// classes (`transition`, `transition-colors`, ...) pick up
// `--default-transition-duration`/`--default-transition-timing-function`
// automatically, but a handwritten `transition: color;` in globals.css does
// not — that only compiles to a real transition once a duration value is
// present, and vitest never exercises the compiled CSS output to catch it.
// (Found by manual inspection of `.next/static/chunks/*.css` in review; not
// caught by any test until this one.)
function rawTransitionFindings(): string[] {
  const out: string[] = [];
  const globals = readFileSync(join(ROOT, "styles/globals.css"), "utf8");
  const source = stripComments(globals);
  for (const match of source.matchAll(/\btransition(?:-property)?\s*:\s*([^;]+);/g)) {
    const value = match[1].trim();
    if (value === "none") continue;
    if (!value.includes("var(--default-transition-duration)")) {
      out.push(`styles/globals.css: transition "${value}" does not reference var(--default-transition-duration)`);
    }
  }
  return out;
}

describe("globals.css raw transitions use the shared duration/easing tokens (R11)", () => {
  it("has no findings", () => {
    expect(rawTransitionFindings()).toEqual([]);
  });

  it("detects a violation (scanner self-check)", () => {
    const TRANSITION_DECL = /\btransition(?:-property)?\s*:\s*([^;]+);/g;
    expect(Array.from("transition: color;".matchAll(TRANSITION_DECL))[0][1]).not.toMatch(
      /var\(--default-transition-duration\)/,
    );
    expect(
      Array.from(
        "transition: color var(--default-transition-duration) var(--default-transition-timing-function);".matchAll(
          TRANSITION_DECL,
        ),
      )[0][1],
    ).toMatch(/var\(--default-transition-duration\)/);
  });
});

describe("Tailwind class-token scan: no modules, no inline styles, no arbitrary values (R7, R15)", () => {
  it("has no findings", () => {
    expect(findings()).toEqual([]);
  });

  it("detects a violation (scanner self-check)", () => {
    expect(classTokens('className="p-[13px] bg-[#fff]"')).toContain("p-[13px]");
    expect(classTokens('className="bg-gray-800"')).toContain("bg-gray-800");
    expect(classTokens('className="text-sm/6"')).toContain("text-sm/6");
    expect(classTokens('className="shadow-lg"')).toContain("shadow-lg");
    expect(classTokens('className="p-4 gap-3"')).toEqual(["p-4", "gap-3"]);
  });
});

describe("status icons only, no Unicode glyphs (R12)", () => {
  it("has no status-symbol Unicode character in app/components/lib source", () => {
    expect(statusSymbolFindings()).toEqual([]);
  });

  it("detects a violation but allows arrows and other non-status punctuation (scanner self-check)", () => {
    expect(STATUS_SYMBOL.test("⚠")).toBe(true);
    expect(STATUS_SYMBOL.test("●")).toBe(true);
    expect(STATUS_SYMBOL.test("←")).toBe(false);
    expect(STATUS_SYMBOL.test("∅")).toBe(false);
  });
});

describe("exactly one status badge implementation (R13)", () => {
  it("has no second Badge component, stray status color utility, or lucide import", () => {
    expect(badgeFindings()).toEqual([]);
  });

  it("detects a violation (scanner self-check)", () => {
    expect(/\bfunction\s+\w*Badge\b/.test("function Badge() {}")).toBe(true);
    expect(Array.from("bg-success text-success".matchAll(STATUS_COLOR_TOKEN)).length).toBe(2);
  });
});

describe("shell-owned content inset, no page-root padding (R14)", () => {
  it("has no padding utility on <main> outside app/signin", () => {
    expect(pagePaddingFindings()).toEqual([]);
  });

  it("--spacing-content is one of the allowed spacing steps (2rem = step 8)", () => {
    expect(THEME["--spacing-content"]).toBe("2rem");
  });

  it("AppShell content and TopBar use p-content/px-content", () => {
    const shell = readFileSync(join(ROOT, "components/shell/AppShell.tsx"), "utf8");
    const bar = readFileSync(join(ROOT, "components/shell/TopBar.tsx"), "utf8");
    expect(shell).toMatch(/p-content/);
    expect(bar).toMatch(/px-content/);
  });

  it("detects a violation (scanner self-check)", () => {
    expect(pagePaddingFindingsSelfCheck()).toBe(true);
  });
});

function pagePaddingFindingsSelfCheck(): boolean {
  const classMatch = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cx\(([^)]*)\)\})/.exec(' className="p-6 flex"');
  const classText = classMatch ? classMatch[1] ?? classMatch[2] ?? classMatch[3] ?? "" : "";
  return classText.split(/\s+/).some((t) => PADDING_UTILITY.test(stripVariants(t)));
}
