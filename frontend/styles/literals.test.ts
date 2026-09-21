import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// design-system R7: page-level code must reference tokens, not repeat values.
// Scans styles in app/, components/ and lib/ (CSS, CSS Modules, inline styles).
// Checks: color literals, and exact token-equal font sizes, spacing (padding /
// margin / gap) and font weights.

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

const NAMED_COLORS =
  "red|crimson|white|black|gray|grey|green|blue|orange|yellow|purple|pink|teal|navy|maroon|silver|gold|lime|cyan|magenta|brown|indigo|violet";
const COLOR_PROPERTY = "(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|boxShadow|box-shadow)";

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCTIONAL = /\b(?:rgb|rgba|hsl|hsla)\(/g;
const NAMED = new RegExp(
  String.raw`\b${COLOR_PROPERTY}["']?\s*:\s*["']?[^;,}"']*\b(?:${NAMED_COLORS})\b`,
  "gi",
);

const TEXT_SIZES = Array.from(
  TOKENS_CSS.matchAll(/--text-[a-z]+\s*:\s*([^;]+);/g),
  (m) => m[1].trim(),
);

const SPACE_VALUES = Array.from(
  TOKENS_CSS.matchAll(/--space-\d+\s*:\s*([^;]+);/g),
  (m) => m[1].trim(),
);
const WEIGHTS = Array.from(
  TOKENS_CSS.matchAll(/--weight-[a-z]+\s*:\s*([^;]+);/g),
  (m) => m[1].trim(),
);
// A padding / margin / gap declaration (CSS or an inline style object key) and
// its value. Only exact token-equal rem terms are flagged; off-scale values
// such as 0.15rem are legacy and allowed (see styles/README.md).
const SPACING_DECLARATION = new RegExp(
  String.raw`\b(?:padding|margin|gap|row-?gap|column-?gap)[A-Za-z-]*["']?\s*:\s*["']?([^;}"'{]+)`,
  "gi",
);

function findings(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const source = stripComments(readFileSync(file, "utf8"));
      const name = relative(ROOT, file);
      for (const [label, pattern] of [
        ["hex color", HEX],
        ["rgb/hsl color", FUNCTIONAL],
        ["named color", NAMED],
      ] as const) {
        for (const match of source.matchAll(pattern)) out.push(`${name}: ${label} "${match[0]}"`);
      }
      for (const match of source.matchAll(/font-?size["']?\s*:\s*["']?([0-9.]+rem)/gi)) {
        if (TEXT_SIZES.includes(match[1])) out.push(`${name}: font size "${match[1]}" duplicates a token`);
      }
      for (const match of source.matchAll(SPACING_DECLARATION)) {
        for (const term of match[1].split(/\s+/)) {
          if (SPACE_VALUES.includes(term)) out.push(`${name}: spacing "${term}" duplicates a token`);
        }
      }
      for (const match of source.matchAll(/font-?weight["']?\s*:\s*["']?(\d+)/gi)) {
        if (WEIGHTS.includes(match[1])) out.push(`${name}: font weight "${match[1]}" duplicates a token`);
      }
    }
  }
  return out;
}

describe("no token-duplicating literals in app code (R7)", () => {
  it("has no color literals or token-equal font sizes", () => {
    expect(findings()).toEqual([]);
  });

  it("only references tokens that exist", () => {
    const defined = new Set(Array.from(TOKENS_CSS.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1]));
    const unknown: string[] = [];
    for (const dir of [...SCAN_DIRS, "styles"]) {
      for (const file of walk(join(ROOT, dir))) {
        const source = stripComments(readFileSync(file, "utf8"));
        for (const match of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
          if (!defined.has(match[1])) unknown.push(`${relative(ROOT, file)}: ${match[1]}`);
        }
      }
    }
    // globals.css is a stylesheet in styles/, walk() covers it via the "styles" entry.
    expect(unknown).toEqual([]);
  });

  it("detects a violation (scanner self-check)", () => {
    expect("color: #fff;".match(HEX)).not.toBeNull();
    expect('style={{ color: "crimson" }}'.match(NAMED)).not.toBeNull();
    expect("background: rgba(0, 0, 0, .5)".match(FUNCTIONAL)).not.toBeNull();
    expect("color: var(--color-text);".match(NAMED)).toBeNull();
    expect(Array.from("padding: 0.15rem 0.5rem;".matchAll(SPACING_DECLARATION))[0][1].split(/\s+/)).toContain("0.5rem");
    expect(Array.from('style={{ gap: "1rem" }}'.matchAll(SPACING_DECLARATION))[0][1]).toBe("1rem");
    expect(SPACE_VALUES).toContain("1rem");
    expect(WEIGHTS).toContain("600");
  });
});
