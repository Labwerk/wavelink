import type { MutationCtx, QueryCtx } from "../_generated/server";

// Thin stand-in for auth-roles' `requireAuth` (specs/auth-roles/plan.md,
// backend/lib/auth.ts). auth-roles has not shipped yet — there is no `users`
// table wiring or role resolution on the server. This only confirms Convex
// sees an authenticated identity for the caller, deny-by-default otherwise,
// so R8 ("no telemetry or device state is shown to an unauthenticated
// request") is already enforced at the query layer. Every `liveView.*` query
// calls this first; once auth-roles lands, this gets replaced by the real
// `requireAuth` (which additionally resolves the caller's `users` role) and
// call sites don't change shape.
//
// specs/live-telemetry-view/tasks.md "Deviations from plan" notes why this
// exists ahead of auth-roles, and specs/live-telemetry-view/plan.md's "Risks
// & unknowns" says the reviewer should mark R8 as blocked (not met) until
// auth-roles actually ships the full guard.
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Not authenticated");
  }
  return identity;
}
