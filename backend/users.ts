import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getCurrentUser, requireRole } from "./lib/auth";

const roleValidator = v.union(
  v.literal("viewer"),
  v.literal("operator"),
  v.literal("maintenance"),
  v.literal("admin"),
);

/**
 * Creates/syncs the `users` row for a Convex Auth identity on first login
 * (spec §5/R5), implementing the bootstrap rule (R11): the first user ever
 * created in the table is auto-assigned `admin`; every subsequent first
 * login defaults to `viewer` (least privilege). Called from the
 * `createOrUpdateUser` callback in `backend/auth.ts` — not part of the
 * public API.
 *
 * On repeat logins (`existingUserId` set), this is a no-op that just
 * returns the existing id; Convex Auth handles session/account bookkeeping
 * separately.
 */
export async function syncUserOnLogin(
  ctx: MutationCtx,
  args: {
    existingUserId: Id<"users"> | null;
    profile: { email?: string } & Record<string, unknown>;
  },
): Promise<Id<"users">> {
  if (args.existingUserId !== null) {
    return args.existingUserId;
  }

  // Bootstrap rule (spec §5): a single `.first()` read against the table's
  // default index is cheap and bounded (never an unbounded scan) — it only
  // ever runs once, ever, per deployment (while the table is still empty).
  const isFirstUser = (await ctx.db.query("users").first()) === null;

  const email = args.profile.email ?? "";
  const name = email.includes("@") ? email.split("@")[0] : email || "New user";

  const userId = await ctx.db.insert("users", {
    // Placeholder; patched immediately below once the row's own id exists.
    authId: "",
    name,
    email,
    role: isFirstUser ? "admin" : "viewer",
    isActive: true,
  });

  // Convex Auth identifies the caller by this row's own id (see
  // `getAuthUserId`/`lib/auth.ts`). We additionally store it as `authId`
  // (matching the schema's "opaque provider-assigned identifier" field
  // from the parent spec) so lookups go through the `by_authId` index per
  // spec §6, rather than requiring a special-cased primary-key lookup.
  await ctx.db.patch(userId, { authId: userId });

  return userId;
}

/**
 * Current authenticated user's profile + role (spec §10, R6). Returns
 * `null` when unauthenticated (or not yet synced) so the frontend can
 * render a sign-in screen — this is a read of one's own identity, not a
 * protected resource, so it never throws. Every *protected* call still
 * re-checks the role server-side via `requireRole`/`requireAuthenticatedUser`.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    return getCurrentUser(ctx);
  },
});

/** Admin-only: lists all users for role management (R7, spec §4). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return ctx.db.query("users").collect();
  },
});

/** Admin-only: changes a target user's role (R3/R8, spec §4). */
export const setRole = mutation({
  args: {
    userId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, { userId, role }) => {
    await requireRole(ctx, ["admin"]);
    const target = await ctx.db.get(userId);
    if (target === null) {
      throw new Error("User not found");
    }
    await ctx.db.patch(userId, { role });
  },
});
