import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { authedQuery } from "./lib/functions";
import { recordAudit } from "./lib/audit";

/** Admin-only: most recent audit entries (who did what to whom, and when). */
export const list = authedQuery({
  capability: "user.manage",
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("auditLog")
      .withIndex("by_at")
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 200));
  },
});

// For actions, which cannot write to the database directly. `actorId` is
// supplied by server code that has already authenticated the caller; this is
// internal, so no client can invoke it.
export const record = internalMutation({
  args: {
    actorId: v.optional(v.id("users")),
    action: v.string(),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    details: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    await recordAudit(ctx, args);
  },
});
