// Local, self-contained auth seam for R16/R17/R31 (spec R16, R17, R31).
//
// This branch does not have the auth-roles implementation merged and has no
// sign-in flow to produce a real session — see specs/device-registry/plan.md
// "Auth seam" for why this is a deliberate, temporary design and how it is
// swapped out later. This is the SINGLE place in the device-registry feature
// that resolves "who is calling and are they an admin"; nothing else touches
// identity directly.
//
// `getActor` resolves `ctx.auth.getUserIdentity()` to a row in the existing
// `users` table via `by_authId`. When there is no identity at all (no
// sign-in flow exists to produce one), the `DEVICE_REGISTRY_REQUIRE_ADMIN`
// escape hatch decides: default `false` (this branch) returns a synthetic
// admin actor so the feature is usable end-to-end today; `true` denies.
//
// Every denial throws the same opaque error, so "forbidden" and "not found"
// are indistinguishable to the caller (matches the auth-roles convention).

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "../_generated/server";
import { deviceRegistryRequireAdmin } from "./config";

export const NOT_AUTHORIZED = "Not authorized";

export type Actor = {
  /** Absent when there is no real session — see `actorLabel` for a human-readable trace. */
  userId: Id<"users"> | undefined;
  label: string;
  role: Doc<"users">["role"];
};

const UNAUTHENTICATED_DEV_ACTOR: Actor = {
  userId: undefined,
  label: "unauthenticated-dev",
  role: "admin",
};

/** Resolves the calling actor. Never throws for a plain read; see `requireAdmin` for gating. */
export async function getActor(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity !== null) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_authId", (q) => q.eq("authId", identity.subject))
      .unique();
    if (user !== null) {
      return { userId: user._id, label: user.name || user.email, role: user.role };
    }
    // Authenticated but no matching row: least-privilege, not a synthetic admin.
    return { userId: undefined, label: identity.subject, role: "viewer" };
  }
  if (!deviceRegistryRequireAdmin()) {
    return UNAUTHENTICATED_DEV_ACTOR;
  }
  throw new ConvexError({ message: NOT_AUTHORIZED });
}

/** Requires the calling actor to hold the `admin` role; returns their row. */
export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const actor = await getActor(ctx);
  if (actor.role !== "admin") {
    throw new ConvexError({ message: NOT_AUTHORIZED });
  }
  return actor;
}

/** R16: lets the frontend gate admin-only controls on the caller's real role. */
export const currentActor = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getActor(ctx);
    return { role: actor.role };
  },
});

// Re-exported so callers don't need to import `convex/values` just for this.
export const roleValidator = v.union(
  v.literal("viewer"),
  v.literal("operator"),
  v.literal("maintenance"),
  v.literal("admin"),
);
