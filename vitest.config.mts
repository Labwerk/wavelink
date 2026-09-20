import { defineConfig } from "vitest/config";

// Backend (Convex functions) tests only — the frontend workspace has its own
// vitest.config.ts with a browser-like (jsdom) environment instead.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["backend/**/*.test.ts"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
