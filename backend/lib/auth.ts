// Shared server-side auth/role enforcement helper.
//
// Implements spec `specs/auth-roles/spec.md` §6 (Server-Side Enforcement
// Design): every protected query/mutation resolves the caller's `users` row
// through Convex Auth and re-checks its role here — the client-supplied
// role is never trusted (R2). All denial paths below throw the exact same
// generic error, so a role mismatch, a deactivated account, and an
// unauthenticated caller are indistinguishable to the caller (R4: fail
// closed without leaking whether a resource exists).

import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type Role = Doc<"users">["role"];

/** Generic, fail-closed message. Never vary this by denial reason (R4). */
export const NOT_AUTHORIZED = "Not authorized";

/**
 * Resolves the calling user's `users` row via Convex Auth's identity, or
 * `null` if unauthenticated or the row doesn't exist (e.g. not yet synced).
 * Does not throw and does not check `isActive` or role — use
 * `requireAuthenticatedUser`/`requireRole` for enforcement.
 */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return ctx.db
    .query("users")
    .withIndex("by_authId", (q) => q.eq("authId", userId))
    .unique();
}

/**
 * Enforces R1 + the "isActive" clause of §4: caller must be authenticated
 * and have an active `users` row, but any role is allowed. Use for reads
 * that spec §4's Role Matrix grants to all four roles (e.g.
 * `devices.listActive`, `telemetry.latestForDevice`).
 */
export async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (user === null || !user.isActive) {
    throw new Error(NOT_AUTHORIZED);
  }
  return user;
}

/**
 * Enforces R2/R3/R4: caller must be authenticated, active, and hold one of
 * `allowedRoles`. Use for every mutation/query restricted to specific roles
 * per spec §4's Role Matrix (e.g. `devices.register` -> ["admin"]).
 */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: Role[],
): Promise<Doc<"users">> {
  const user = await requireAuthenticatedUser(ctx);
  if (!allowedRoles.includes(user.role)) {
    throw new Error(NOT_AUTHORIZED);
  }
  return user;
}
