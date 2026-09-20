// R17/R27: structural enumeration of `backend/devices.ts`'s exported
// surface, so a newly added registry operation cannot ship unclassified and
// ungated (spec R17: "A test enumerates every registry operation so a newly
// added one cannot be forgotten"; plan.md's R17 row promises the same).
//
// This mirrors the `denyByDefault.test.ts` pattern from the (unmerged)
// auth-roles branch — scan the source text rather than introspect the
// runtime `api` object, because `backend/_generated/api.js`'s `api`/`internal`
// are `anyApi` Proxies with no real, enumerable keys to walk at runtime.
// Scoped to `devices.ts` alone since this feature doesn't carry that
// branch's full capability-wrapper system (see plan.md "Auth seam").

import { describe, expect, test } from "vitest";
import { ADMIN_GATED_MUTATIONS, ADMIN_GATED_QUERIES } from "./testUtils";

const devicesSource = (
  import.meta.glob("../backend/devices.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>
)["../backend/devices.ts"];

/** Public reads with no admin gate (list/facets conditionally gate only `includeDecommissioned`). */
const PUBLIC_UNGATED_READS = ["list", "get", "facets"];
/** internalMutation/internalQuery — not reachable by any client, so outside R17's client-facing enumeration. */
const INTERNAL_ONLY = ["sweepOffline", "backfillLifecycle"];

/**
 * Splits `source` into one chunk per top-level `export const NAME = ...`
 * declaration (each chunk runs from that line to just before the next one,
 * or EOF), keyed by `NAME`. Good enough for this file's consistent style
 * (one blank line between exports); see the "scanner self-check" test below
 * for a guard against a change silently defeating the split.
 */
function extractExportBlocks(source: string): Record<string, string> {
  const chunks = source.split(/\n(?=export const )/);
  const blocks: Record<string, string> = {};
  for (const chunk of chunks) {
    const m = chunk.match(/^export const (\w+)\s*=/);
    if (m) blocks[m[1]] = chunk;
  }
  return blocks;
}

const blocks = extractExportBlocks(devicesSource);
const KNOWN = new Set<string>([...ADMIN_GATED_MUTATIONS, ...ADMIN_GATED_QUERIES, ...PUBLIC_UNGATED_READS, ...INTERNAL_ONLY]);

describe("backend/devices.ts exported surface (R17, R27)", () => {
  test("the scan actually sees devices.ts's exports (guards against the split silently finding nothing)", () => {
    expect(Object.keys(blocks).length).toBeGreaterThanOrEqual(KNOWN.size);
    for (const name of KNOWN) {
      expect(blocks[name], `expected to find "export const ${name}" in devices.ts`).toBeDefined();
    }
  });

  test("every export is classified as a public read, admin-gated, or internal-only — a newly added operation cannot be forgotten", () => {
    const unclassified = Object.keys(blocks).filter((name) => !KNOWN.has(name));
    expect(unclassified).toEqual([]);
  });

  test("every admin-gated mutation/query actually calls requireAdmin", () => {
    for (const name of [...ADMIN_GATED_MUTATIONS, ...ADMIN_GATED_QUERIES]) {
      expect(blocks[name]).toMatch(/requireAdmin\(ctx\)/);
      expect(blocks[name]).toMatch(new RegExp(`^export const ${name}\\s*=\\s*(mutation|query)\\(`));
    }
  });

  test("internal-only exports use internalMutation, never a public builder", () => {
    for (const name of INTERNAL_ONLY) {
      expect(blocks[name]).toMatch(new RegExp(`^export const ${name}\\s*=\\s*internalMutation\\(`));
    }
  });

  test("get() is a fully open read with no admin gate", () => {
    expect(blocks["get"]).not.toMatch(/requireAdmin\(ctx\)/);
  });

  test("no exposed operation deletes a device (R27)", () => {
    expect(devicesSource).not.toMatch(/ctx\.db\.delete\(/);
    expect(Object.keys(blocks).some((n) => /remove|delete|purge|hardDelete/i.test(n))).toBe(false);
  });

  test("scanner self-check: an unclassified export is caught, not silently ignored", () => {
    const withExtra = extractExportBlocks(
      `${devicesSource}\n\nexport const wipeEverything = mutation({ args: {}, handler: async () => {} });\n`,
    );
    const unclassified = Object.keys(withExtra).filter((name) => !KNOWN.has(name));
    expect(unclassified).toEqual(["wipeEverything"]);
  });
});
