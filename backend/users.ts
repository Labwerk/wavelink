import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
} from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { NOT_AUTHORIZED, getCurrentUser } from "./lib/auth";
import { recordAudit } from "./lib/audit";
import { authedAction, authedMutation, authedQuery } from "./lib/functions";
import { capabilitiesFor, roleValidator } from "./lib/permissions";
import {
  displayNameFromEmail,
  isInitialAdminEmail,
  normalizeEmail,
  validatePassword,
} from "./lib/provisioning";

/**
 * The caller's own identity, role and capability list, for UI gating
 * (spec R8/R9). Never throws: `null` when signed out or deactivated, so a
 * deactivated account looks exactly like a signed-out one. Advisory only -
 * every protected call re-resolves the role server-side. Registered with the
 * raw `query` builder on purpose (see `lib/publicEntryPoints.ts`).
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null || !user.isActive) {
      return null;
    }
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      capabilities: capabilitiesFor(user.role),
    };
  },
});

/** Admin-only: lists all users for role management (R7). */
export const list = authedQuery({
  capability: "user.manage",
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("users").collect();
  },
});

/** Active admins, capped at 2 (enough to tell "the last one" from "not"). */
async function activeAdmins(ctx: QueryCtx) {
  return ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .filter((q) => q.eq(q.field("isActive"), true))
    .take(2);
}

/**
 * Admin-only: changes a target user's role (R3, R7). Authorization runs
 * before the target is looked up (R6). Refuses to demote the last remaining
 * active admin so a deployment can never end up with none. The change and its
 * audit row commit together (R11).
 */
export const setRole = authedMutation({
  capability: "user.manage",
  args: { userId: v.id("users"), role: roleValidator },
  handler: async (ctx, { userId, role }) => {
    const target = await ctx.db.get(userId);
    if (target === null) {
      throw new Error("User not found");
    }
    if (target.role === role) {
      return;
    }
    if (target.role === "admin" && target.isActive) {
      if ((await activeAdmins(ctx)).length <= 1) {
        throw new Error("Cannot remove the last admin");
      }
    }
    await ctx.db.patch(userId, { role });
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "user.setRole",
      targetTable: "users",
      targetId: userId,
      details: { from: target.role, to: role },
    });
  },
});

/**
 * Admin-only: activates or deactivates an account. A deactivated user fails
 * every check identically to a signed-out caller (R6) on their very next
 * call, because `isActive` is read from the row each time. You cannot
 * deactivate yourself, nor the last remaining active admin. Audited (R11).
 */
export const setActive = authedMutation({
  capability: "user.manage",
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, { userId, isActive }) => {
    const target = await ctx.db.get(userId);
    if (target === null) {
      throw new Error("User not found");
    }
    if (target.isActive === isActive) {
      return;
    }
    if (!isActive) {
      if (target._id === ctx.user._id) {
        throw new Error("You cannot deactivate your own account");
      }
      if (target.role === "admin" && (await activeAdmins(ctx)).length <= 1) {
        throw new Error("Cannot remove the last admin");
      }
    }
    await ctx.db.patch(userId, { isActive });
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "user.setActive",
      targetTable: "users",
      targetId: userId,
      details: { from: String(target.isActive), to: String(isActive) },
    });
  },
});

/** Internal: whether an account with this email already exists. */
export const emailTaken = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    return existing !== null;
  },
});

/**
 * Admin-only: provisions an account with a temporary password handed over
 * out-of-band (invite-only; public sign-up is disabled). The acting admin's id
 * is resolved server-side by `authedAction` and passed as `createdBy`; the
 * creation callback validates it and writes the `user.create` audit row in the
 * SAME transaction as the account insert (see `lib/provisioning.ts`). The
 * account is always a `viewer`; promote it afterwards through `setRole`.
 */
export const createUser = authedAction({
  capability: "user.manage",
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, { email, name, temporaryPassword }): Promise<Id<"users">> => {
    const normalized = normalizeEmail(email);
    if (normalized === "" || !normalized.includes("@")) {
      throw new Error("A valid email is required");
    }
    validatePassword(temporaryPassword);
    if (await ctx.runQuery(internal.users.emailTaken, { email: normalized })) {
      throw new Error("An account with that email already exists");
    }
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: normalized, secret: temporaryPassword },
      // The creation callback ignores `role`/`isActive` and always writes a
      // viewer; `createdBy` is validated there (exists, active, admin).
      profile: {
        email: normalized,
        name: name?.trim() || displayNameFromEmail(normalized),
        role: "viewer",
        isActive: true,
        createdBy: ctx.user._id,
      },
    });
    return user._id;
  },
});

// --- Deployment-admin-key operations ---------------------------------------
//
// These are INTERNAL: no client, signed in or not, can call them. They are run
// out-of-band with `npx convex run`, which authenticates with the deployment
// admin key. That key - not any email address - is the credential guarding
// them.

/** Internal: throws NOT_AUTHORIZED unless bootstrap is currently allowed. */
export const assertBootstrapAllowed = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (!isInitialAdminEmail(email) || (await ctx.db.query("users").first()) !== null) {
      throw new Error(NOT_AUTHORIZED);
    }
  },
});

/**
 * Establishes the first admin on a fresh deployment (spec R13):
 *
 *   npx convex run users:bootstrapAdmin '{"email":"...","password":"..."}'
 *
 * Guarded by the deployment admin key (internal function). The empty-table and
 * INITIAL_ADMIN_EMAIL checks are defence in depth - they stop an operator
 * bootstrapping the wrong account on a deployment already in use - and are
 * re-checked inside the creation transaction, where the `admin` role and the
 * `user.bootstrapAdmin` audit row are written atomically with the account
 * (`createUserRecord`). The procedure either completes or leaves nothing.
 */
export const bootstrapAdmin = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<null> => {
    const normalized = normalizeEmail(email);
    await ctx.runQuery(internal.users.assertBootstrapAllowed, { email: normalized });
    validatePassword(password);
    await createAccount(ctx, {
      provider: "password",
      account: { id: normalized, secret: password },
      // Role/isActive are ignored by the creation callback, which re-derives
      // the bootstrap condition from the database and the environment.
      profile: {
        email: normalized,
        name: displayNameFromEmail(normalized),
        role: "viewer",
        isActive: true,
      },
    });
    return null;
  },
});

/**
 * Recovery only (not part of bootstrap): promotes the sole user to admin when a
 * deployment somehow holds exactly one non-admin user (e.g. a half-completed
 * bootstrap from before bootstrap became atomic, or a restore). Run with the
 * deployment admin key:
 *
 *   npx convex run users:promoteBootstrapAdmin '{"userId":"<users _id>"}'
 *
 * Re-verifies in-transaction that it is the only user and matches
 * INITIAL_ADMIN_EMAIL. The simpler dev answer is `docker compose down -v`.
 */
export const promoteBootstrapAdmin = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const users = await ctx.db.query("users").take(2);
    const user = users.length === 1 ? users[0] : null;
    if (user === null || user._id !== userId || !isInitialAdminEmail(user.email)) {
      throw new Error(NOT_AUTHORIZED);
    }
    if (user.role === "admin") {
      return;
    }
    await ctx.db.patch(userId, { role: "admin", isActive: true });
    await recordAudit(ctx, {
      action: "user.recoverAdmin",
      targetTable: "users",
      targetId: userId,
      details: { email: user.email, via: "deployment-admin-key" },
    });
  },
});

/** Internal: the users row for an email, or null. */
export const findByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
  },
});

/**
 * Break-glass password reset (no email channel exists, so a forgotten admin
 * password would otherwise brick the deployment). Run with the deployment
 * admin key; there is no UI and no user-facing reset:
 *
 *   npx convex run users:setPassword '{"email":"...","newPassword":"..."}'
 *
 * Replaces the credential and signs out all of the user's sessions. Audited
 * with no actor (there is no user; `details.via` records the deploy key).
 * The audit row is written after the credential change, in a second
 * transaction, because the credential change is owned by the auth library.
 */
export const setPassword = internalAction({
  args: { email: v.string(), newPassword: v.string() },
  handler: async (ctx, { email, newPassword }): Promise<null> => {
    const normalized = normalizeEmail(email);
    validatePassword(newPassword);
    const user = await ctx.runQuery(internal.users.findByEmail, { email: normalized });
    if (user === null) {
      throw new Error("User not found");
    }
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: normalized, secret: newPassword },
    });
    await invalidateSessions(ctx, { userId: user._id });
    await ctx.runMutation(internal.audit.record, {
      action: "user.setPassword",
      targetTable: "users",
      targetId: user._id,
      details: { email: normalized, via: "deployment-admin-key" },
    });
    return null;
  },
});
