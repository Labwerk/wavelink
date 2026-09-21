import { defineConfig } from "vitest/config";

// Backend (Convex functions) tests, colocated (backend/**) and top-level
// (tests/**, auth-roles' convention) alike — the frontend workspace has its
// own vitest.config.ts with a browser-like (jsdom) environment instead.
//
// Kept as the single root config on purpose: vitest resolves only one root
// config file, and a second one here (e.g. a `.ts` sibling) would silently
// shadow this include list rather than merge with it — exactly what
// happened across the auth-roles merge until this file's include list was
// widened to cover both directories.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["backend/**/*.test.ts", "tests/**/*.test.ts"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
