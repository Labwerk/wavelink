// Deny-by-default meta-test (spec R4).
//
// "A newly added protected operation with no role rule defined denies all
// callers" is enforced structurally: every exported Convex function must be
// declared through `authedQuery` / `authedMutation` / `authedAction` (which
// REQUIRE a capability), or be a deliberate, named exception in
// `backend/lib/publicEntryPoints.ts`. This test scans the backend sources and
// fails for anything else, so a function that forgets its permission rule
// cannot ship.

import { describe, expect, test } from "vitest";
import { PUBLIC_ENTRY_POINTS } from "../backend/lib/publicEntryPoints";

const sources = import.meta.glob("../backend/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const RAW_BUILDERS = ["query", "mutation", "action"];

/** `../backend/lib/functions.ts` -> `lib/functions`; `../backend/users.ts` -> `users`. */
function moduleName(path: string): string {
  return path.replace(/^\.\.\/backend\//, "").replace(/\.ts$/, "");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Exported functions registered with a raw public builder, as `<module>:<name>`. */
export function findRawExports(module: string, source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  const named = new RegExp(
    `export\\s+(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:${RAW_BUILDERS.join("|")})\\b`,
    "g",
  );
  for (const m of code.matchAll(named)) found.push(`${module}:${m[1]}`);
  if (new RegExp(`export\\s+default\\s+(?:${RAW_BUILDERS.join("|")})\\b`).test(code)) {
    found.push(`${module}:default`);
  }
  return found;
}

/** Whether the module imports a raw public builder from the generated server file. */
export function importsRawBuilder(source: string): boolean {
  const code = stripComments(source);
  for (const m of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*_generated\/server["']/g)) {
    const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    if (names.some((n) => RAW_BUILDERS.includes(n))) return true;
  }
  return false;
}

const backendFiles = Object.entries(sources)
  .map(([path, source]) => ({ module: moduleName(path), source }))
  .filter(({ module }) => !module.startsWith("_generated/"));

describe("deny-by-default enforcement (R4)", () => {
  test("the scan sees the backend sources", () => {
    const names = backendFiles.map((f) => f.module);
    expect(names).toEqual(expect.arrayContaining(["users", "devices", "telemetry", "lib/functions"]));
  });

  test("every exported function using a raw builder is on the explicit allow-list", () => {
    const rawExports = backendFiles
      .filter(({ module }) => module !== "lib/functions")
      .flatMap(({ module, source }) => findRawExports(module, source));
    const unlisted = rawExports.filter((e) => !PUBLIC_ENTRY_POINTS.includes(e));
    expect(unlisted).toEqual([]);
  });

  test("no module other than lib/functions and allow-listed modules imports the raw builders", () => {
    const allowedModules = new Set(["lib/functions", ...PUBLIC_ENTRY_POINTS.map((e) => e.split(":")[0])]);
    const offenders = backendFiles
      .filter(({ module, source }) => importsRawBuilder(source) && !allowedModules.has(module))
      .map((f) => f.module);
    expect(offenders).toEqual([]);
  });

  test("every allow-list entry still exists (no stale exceptions)", () => {
    const rawExports = new Set(
      backendFiles
        .filter(({ module }) => module !== "lib/functions")
        .flatMap(({ module, source }) => findRawExports(module, source)),
    );
    for (const entry of PUBLIC_ENTRY_POINTS) expect(rawExports.has(entry)).toBe(true);
  });

  test("the protected modules are declared through the capability wrappers", () => {
    for (const module of ["devices", "telemetry", "audit"]) {
      const source = backendFiles.find((f) => f.module === module)!.source;
      expect(source).toMatch(/authed(Query|Mutation|Action)\(/);
      expect(importsRawBuilder(source)).toBe(false);
    }
  });

  test("every wrapper call names a capability that exists in the map", async () => {
    const { isKnownCapability } = await import("../backend/lib/permissions");
    const names: string[] = [];
    for (const { source } of backendFiles) {
      for (const m of stripComments(source).matchAll(/authed(?:Query|Mutation|Action)\(\{\s*capability:\s*"([^"]+)"/g)) {
        names.push(m[1]);
      }
    }
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(isKnownCapability(n)).toBe(true);
  });
});

// Prove the scanner itself would catch a regression: a function registered
// with a raw builder and no rule must be reported.
describe("scanner self-check", () => {
  test("flags a raw-builder export that is not allow-listed", () => {
    const bad = `import { mutation } from "./_generated/server";
export const wipeEverything = mutation({ args: {}, handler: async () => {} });`;
    const found = findRawExports("evil", bad);
    expect(found).toEqual(["evil:wipeEverything"]);
    expect(PUBLIC_ENTRY_POINTS).not.toContain(found[0]);
    expect(importsRawBuilder(bad)).toBe(true);
  });

  test("flags default exports and aliased imports", () => {
    expect(findRawExports("m", `export default query({ handler: async () => 1 });`)).toEqual(["m:default"]);
    expect(importsRawBuilder(`import { query as q, internalQuery } from "./_generated/server";`)).toBe(true);
  });

  test("ignores wrapper-declared, internal, and commented-out functions", () => {
    const ok = `import { internalMutation } from "./_generated/server";
import { authedMutation } from "./lib/functions";
export const a = authedMutation({ capability: "device.manage", args: {}, handler: async () => {} });
export const b = internalMutation({ args: {}, handler: async () => {} });
// export const c = mutation({ args: {}, handler: async () => {} });`;
    expect(findRawExports("ok", ok)).toEqual([]);
    expect(importsRawBuilder(ok)).toBe(false);
  });
});
