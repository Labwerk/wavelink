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
// admin-gated public mutations/queries (spec R17, R31). Shared between
// `tests/deviceApiSurface.test.ts` (which structurally scans devices.ts and
// fails if a new export isn't classified here or anywhere else) and
// `tests/devices.test.ts` (which proves each of these actually denies every
// non-admin role and allows admin) — a mutation added to devices.ts without
// being added here fails the surface scan; one added only here without a
// matching `requireAdmin(ctx)` call fails the surface scan's gating check.
export const ADMIN_GATED_MUTATIONS = ["register", "update", "decommission", "reactivate"] as const;
export const ADMIN_GATED_QUERIES = ["changeHistory"] as const;

/**
 * Inserts a `users` row directly (there is no sign-in flow on this branch —
 * see specs/device-registry/plan.md "Auth seam") and returns both its id and
 * a `t` accessor impersonating it via `withIdentity`. `backend/lib/access.ts`
 * resolves `identity.subject` against `users.authId` via `by_authId`.
 */
export async function createUserFixture(
  t: Test,
  role: Role,
  overrides: { isActive?: boolean; email?: string; name?: string } = {},
): Promise<{ userId: Id<"users">; as: Test }> {
  const authId = `${role}-${Math.random().toString(36).slice(2)}`;
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      authId,
      name: overrides.name ?? `${role}-user`,
      email: overrides.email ?? `${role}@example.com`,
      role,
      isActive: overrides.isActive ?? true,
    }),
  );
  return { userId, as: t.withIdentity({ subject: authId }) };
}
