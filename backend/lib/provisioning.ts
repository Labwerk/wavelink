// Account provisioning rules (spec "Account provisioning" + default role).
//
// - Public sign-up is disabled: the Password provider's `profile` hook is
//   invoked on EVERY flow and here rejects everything except "signIn". Admin
//   provisioning is unaffected because `createAccount()` takes a profile
//   object directly and never calls this hook.
// - Every newly created account is a `viewer` (the sole exception being the
//   self-derived first-admin bootstrap): the creation callback in `auth.ts`
//   calls `createUserRecord`, which ignores any role in the incoming profile,
//   so no client-supplied role can reach the database (R3).

import type { Value } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { recordAudit } from "./audit";

export const MIN_PASSWORD_LENGTH = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0];
  return local || "New user";
}

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

/**
 * Profile hook for the Password provider. Only the "signIn" flow is allowed;
 * "signUp" (and every other flow) is refused so accounts can only be created
 * by an admin (or the one-time first-admin bootstrap).
 */
export function passwordProfile(params: Record<string, Value | undefined>): {
  email: string;
  name: string;
  role: Doc<"users">["role"];
  isActive: boolean;
} {
  if (params.flow !== "signIn") {
    throw new Error("Sign-up is disabled. Ask an administrator for an account.");
  }
  const email = normalizeEmail(String(params.email ?? ""));
  if (email === "") {
    throw new Error("Invalid credentials");
  }
  // `role` here is never persisted for an existing account, and the creation
  // callback ignores it for new ones; it only satisfies the profile type.
  return { email, name: displayNameFromEmail(email), role: "viewer", isActive: true };
}

/** Whether `email` is the deployment's configured first-admin email. */
export function isInitialAdminEmail(email: string): boolean {
  const configured = process.env.INITIAL_ADMIN_EMAIL;
  return (
    configured !== undefined &&
    configured.trim() !== "" &&
    normalizeEmail(configured) === normalizeEmail(email)
  );
}

/**
 * The only place a `users` row is created. It runs inside the
 * `createOrUpdateUser` callback, i.e. in the SAME transaction as the account
 * insert, so the role decision and the audit row commit or roll back with
 * the account - no half-created state is possible.
 *
 * Exactly two legitimate paths exist; anything else throws (public sign-up is
 * blocked, so any other creation is illegitimate by definition):
 *
 *  1. First-admin bootstrap: the `users` table is empty AND the email equals
 *     INITIAL_ADMIN_EMAIL -> role `admin`, audit `user.bootstrapAdmin`. Both
 *     facts are re-derived here from the database and the environment; no
 *     marker from the caller is trusted.
 *  2. Admin provisioning: `profile.createdBy` is set by `users.createUser`
 *     from the server-resolved caller. It is validated here (row exists, is
 *     active, is an admin) -> role `viewer`, audit `user.create` attributed to
 *     that admin.
 *
 * Any `role`/`isActive` in the incoming profile is ignored.
 */
export async function createUserRecord(
  ctx: MutationCtx,
  profile: { email?: unknown; name?: unknown; createdBy?: unknown },
): Promise<Id<"users">> {
  const email = normalizeEmail(typeof profile.email === "string" ? profile.email : "");
  if (email === "") {
    throw new Error("An email is required");
  }
  const existing = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
  if (existing !== null) {
    throw new Error("Account already exists");
  }
  const name =
    typeof profile.name === "string" && profile.name.trim() !== ""
      ? profile.name.trim()
      : displayNameFromEmail(email);

  const tableIsEmpty = (await ctx.db.query("users").first()) === null;
  if (tableIsEmpty) {
    if (!isInitialAdminEmail(email)) {
      throw new Error("Account creation is not permitted");
    }
    const userId = await ctx.db.insert("users", {
      email,
      name,
      role: "admin",
      isActive: true,
    });
    await recordAudit(ctx, {
      actorId: userId,
      action: "user.bootstrapAdmin",
      targetTable: "users",
      targetId: userId,
      details: { email },
    });
    return userId;
  }

  const creatorId =
    typeof profile.createdBy === "string"
      ? ctx.db.normalizeId("users", profile.createdBy)
      : null;
  const creator = creatorId === null ? null : await ctx.db.get(creatorId);
  if (creator === null || !creator.isActive || creator.role !== "admin") {
    throw new Error("Account creation is not permitted");
  }
  const userId = await ctx.db.insert("users", {
    email,
    name,
    role: "viewer",
    isActive: true,
    createdBy: creator._id,
  });
  await recordAudit(ctx, {
    actorId: creator._id,
    action: "user.create",
    targetTable: "users",
    targetId: userId,
    details: { email },
  });
  return userId;
}
