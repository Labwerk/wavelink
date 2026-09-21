import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "tokens.css"), "utf8");
const README = readFileSync(join(__dirname, "README.md"), "utf8");

function parseTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: +rgba[4] };
  throw new Error(`Unparseable color: ${value}`);
}

function blend(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const tokens = parseTokens(CSS);
const color = (name: string) => parseColor(tokens[name]);

const MIN_TEXT_CONTRAST = 4.5;

const TEXT_TOKENS = [
  "--color-text",
  "--color-text-muted",
  "--color-accent",
  "--color-success",
  "--color-warning",
  "--color-danger",
  "--color-neutral",
  "--color-decommissioned",
];
const BACKGROUND_TOKENS = ["--color-bg", "--color-surface", "--color-surface-raised"];

describe("tokens.css contrast (R2, R6)", () => {
  for (const fg of TEXT_TOKENS) {
    for (const bg of BACKGROUND_TOKENS) {
      it(`${fg} on ${bg} is at least ${MIN_TEXT_CONTRAST}:1`, () => {
        expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    }
  }

  for (const fill of ["--color-accent", "--color-success", "--color-warning", "--color-danger", "--color-neutral", "--color-decommissioned"]) {
    it(`--color-on-accent on ${fill} is at least ${MIN_TEXT_CONTRAST}:1`, () => {
      expect(contrast(color("--color-on-accent"), color(fill))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });
  }

  const TINTS: Array<[string, string]> = [
    ["--color-success", "--color-success-bg"],
    ["--color-warning", "--color-warning-bg"],
    ["--color-danger", "--color-danger-bg"],
    ["--color-neutral", "--color-neutral-bg"],
    ["--color-decommissioned", "--color-neutral-bg"],
  ];
  for (const [fg, tint] of TINTS) {
    for (const base of ["--color-surface", "--color-bg"]) {
      it(`${fg} on ${tint} over ${base} is at least ${MIN_TEXT_CONTRAST}:1`, () => {
        const background = blend(color(tint), color(base));
        expect(contrast(color(fg), background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    }
  }
});

describe("tokens.css and README.md parity (R1)", () => {
  const documented = new Set(
    Array.from(README.matchAll(/^\|\s*`(--[a-z0-9-]+)`\s*\|/gm), (m) => m[1]),
  );

  it("documents every token defined in tokens.css", () => {
    const missing = Object.keys(tokens).filter((name) => !documented.has(name));
    expect(missing).toEqual([]);
  });

  it("does not document tokens that do not exist", () => {
    const extra = [...documented].filter((name) => !(name in tokens));
    expect(extra).toEqual([]);
  });

  it("defines the required token groups", () => {
    for (const prefix of ["--color-", "--space-", "--text-", "--font-", "--radius-", "--sidebar-", "--topbar-"]) {
      expect(Object.keys(tokens).some((name) => name.startsWith(prefix))).toBe(true);
    }
  });
});
