import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { requireCapabilityForUser } from "./lib/auth";

// Used by `authedAction` (lib/functions.ts): actions have no database access,
// so they authorize through this internal query. Internal functions are not
// callable by clients. Throws the same opaque NOT_AUTHORIZED as every other
// denial.
export const authorize = internalQuery({
  args: { userId: v.id("users"), capability: v.string() },
  handler: async (ctx, { userId, capability }) => {
    return requireCapabilityForUser(ctx, userId, capability);
  },
});
