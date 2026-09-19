// Test-only helpers shared across `*.test.ts` files. Deliberately kept
// outside `backend/` (which is scoped by `convex.json` as the deployable
// Convex functions directory) so nothing test-only — vitest globals,
// `import.meta.glob` — ever risks being bundled/pushed as part of a real
// deployment.
import type { TestConvexForDataModel } from "convex-test";
import type { DataModel, Id } from "../backend/_generated/dataModel";

export type Role = "viewer" | "operator" | "maintenance" | "admin";
export type Test = TestConvexForDataModel<DataModel>;

/**
 * Inserts a `users` row directly (bypassing the real Convex Auth sign-in
 * flow, which needs JWT signing keys not available in this mock
 * environment) and returns both its id and a `t` accessor impersonating it
 * via `withIdentity`. `authId` is set to the row's own id, matching what
 * `syncUserOnLogin` does for a real login (see `backend/users.ts`).
 */
export async function createUserFixture(
  t: Test,
  role: Role,
  overrides: { isActive?: boolean; email?: string; name?: string } = {},
): Promise<{ userId: Id<"users">; as: Test }> {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      authId: "",
      name: overrides.name ?? `${role}-user`,
      email: overrides.email ?? `${role}@example.com`,
      role,
      isActive: overrides.isActive ?? true,
    });
    await ctx.db.patch(id, { authId: id });
    return id;
  });
  return { userId, as: t.withIdentity({ subject: `${userId}|test-session` }) };
}
