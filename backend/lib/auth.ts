// Shared server-side authorization (spec R1, R3, R4, R6).
//
// The caller is resolved from the authenticated identity
// (`getAuthUserId` -> `users._id`) and the role is read from the stored row
// on every call - never from a token claim or a client-supplied value (R3).
// Every denial path throws the same opaque error, so unauthenticated,
// wrong-role, deactivated and unknown-capability callers are
// indistinguishable (R6).

import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { roleHasCapability } from "./permissions";

export type { Role, Capability } from "./permissions";

/** Generic, fail-closed message. Never vary this by denial reason (R6). */
export const NOT_AUTHORIZED = "Not authorized";

/**
 * Resolves the calling user's row, or `null` when unauthenticated or the row
 * is missing. Does not check `isActive` or role.
 */
export async function getCurrentUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return ctx.db.get(userId);
}

/**
 * Loads `userId`'s row and requires it to be active and to hold
 * `capability`. Deny-by-default: an unknown capability denies everyone.
 */
export async function requireCapabilityForUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users"> | null,
  capability: string,
): Promise<Doc<"users">> {
  if (userId === null) {
    throw new Error(NOT_AUTHORIZED);
  }
  const user = await ctx.db.get(userId);
  if (user === null || !user.isActive || !roleHasCapability(user.role, capability)) {
    throw new Error(NOT_AUTHORIZED);
  }
  return user;
}

/** Requires the authenticated caller to hold `capability`; returns their row. */
export async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  capability: string,
): Promise<Doc<"users">> {
  return requireCapabilityForUser(ctx, await getAuthUserId(ctx), capability);
}
