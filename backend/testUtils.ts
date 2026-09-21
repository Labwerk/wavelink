import { convexTest } from "convex-test";
import schema from "./schema";

// `import.meta.glob` must be called from a file at the root of the Convex
// functions directory (convex.json: "functions": "backend/") for
// convex-test's module-path resolution to line up with the `api`/`internal`
// references used in the functions themselves. See
// https://docs.convex.dev/testing/convex-test.
const modules = import.meta.glob("./**/*.ts");

export function setupTest() {
  return convexTest(schema, modules);
}
