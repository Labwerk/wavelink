// Test-only helpers shared across `*.test.ts` files. Deliberately kept
// outside `backend/` (which is scoped by `convex.json` as the deployable
// Convex functions directory) so nothing test-only — vitest globals,
// `import.meta.glob` — ever risks being bundled/pushed as part of a real
// deployment.

import type { TestConvexForDataModel } from "convex-test";
import type { DataModel, Id } from "../backend/_generated/dataModel";

export type Role = "viewer" | "operator" | "maintenance" | "admin";
export type Test = TestConvexForDataModel<DataModel>;

export const ALL_ROLES: Role[] = ["viewer", "operator", "maintenance", "admin"];
export const NON_ADMIN_ROLES: Role[] = ["viewer", "operator", "maintenance"];

// The single source of truth for which `backend/devices.ts` exports are
// admin-gated (`device.manage`) public mutations/queries (spec R17, R31).
// `tests/devices.test.ts` cross-checks its own gating matrix against these
// lists (so they can't silently drift from what's actually gated) and proves
// each one denies every non-admin role and allows admin.
export const ADMIN_GATED_MUTATIONS = ["register", "update", "decommission", "reactivate"] as const;
export const ADMIN_GATED_QUERIES = ["changeHistory"] as const;

/**
 * Inserts a `users` row directly (bypassing the real Convex Auth sign-in
 * flow, which needs JWT signing keys not available in this mock
 * environment) and returns both its id and a `t` accessor impersonating it
 * via `withIdentity`. The identity is the row's own `_id`
 * (`subject: "<userId>|<sessionId>"`), exactly what `getAuthUserId` parses.
 */
export async function createUserFixture(
  t: Test,
  role: Role,
  overrides: { isActive?: boolean; email?: string; name?: string } = {},
): Promise<{ userId: Id<"users">; as: Test }> {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: overrides.name ?? `${role}-user`,
      email: overrides.email ?? `${role}@example.com`,
      role,
      isActive: overrides.isActive ?? true,
    }),
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|test-session` }) };
}
