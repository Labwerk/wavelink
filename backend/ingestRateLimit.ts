import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { applyTokenBucket } from "./lib/ingestRateLimit";

// Convex-facing wrapper around the pure token-bucket arithmetic in
// `backend/lib/ingestRateLimit.ts` (see that file's header for why this is a
// hand-rolled fallback rather than the `@convex-dev/rate-limiter`
// component). Exposed as its own `internalMutation` — not folded into
// `ingest.recordBatch` — so it commits independently: a later validation
// failure or crash in `recordBatch` cannot roll back the throttle accounting
// (plan.md's "Where rate limiting runs" rationale, preserved even though the
// mechanism changed).
export const consume = internalMutation({
  args: {
    key: v.string(),
    cost: v.number(),
    config: v.object({
      rate: v.number(),
      periodMs: v.number(),
      capacity: v.number(),
    }),
  },
  handler: async (ctx, { key, cost, config }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("ingestRateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();

    const bucket = existing ? { tokens: existing.tokens, lastRefillAt: existing.lastRefillAt } : null;
    const result = applyTokenBucket(bucket, config, now, cost);

    if (existing) {
      await ctx.db.patch(existing._id, {
        tokens: result.newState.tokens,
        lastRefillAt: result.newState.lastRefillAt,
      });
    } else {
      await ctx.db.insert("ingestRateLimits", {
        key,
        tokens: result.newState.tokens,
        lastRefillAt: result.newState.lastRefillAt,
      });
    }

    return { ok: result.ok, retryAfter: result.retryAfter };
  },
});
