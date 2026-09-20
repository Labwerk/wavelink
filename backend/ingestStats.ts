import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { loadIngestConfig } from "./lib/ingestConfig";

// Per-minute ingestion counters (telemetry-ingestion R25) and the retention
// cron's cleanup. Kept as `internalQuery`/`internalMutation` — no public
// read surface yet — per plan.md's "Observability read path" decision: the
// spec forbids depending on end-user auth being finished, so R25's "an
// operator can determine" is satisfied via the operator-only dashboard/CLI
// (`npx convex run ingestStats:summary '{"fromTs":...,"toTs":...}'`) until
// `auth-roles` lands and a public admin-gated wrapper can be added.

const MINUTE_MS = 60_000;

function floorToMinute(ts: number): number {
  return Math.floor(ts / MINUTE_MS) * MINUTE_MS;
}

/** Sentinel `sourceId` for request-level failures that never authenticated,
 * so they have no real ingestion source to attribute to (plan.md's
 * "unauthenticated" sentinel). */
export const UNAUTHENTICATED_SOURCE = "unauthenticated";

const outcomeValidator = v.union(
  v.literal("accepted"),
  v.literal("credentialFailed"),
  v.literal("rateLimited"),
  v.literal("oversize"),
  v.literal("malformed"),
);

/**
 * Records the outcome of one ingestion request against the current minute's
 * counter row for `sourceId`, creating it if needed. Called once per request
 * from `backend/ingestHttp.ts` — never once per reading — so write
 * contention stays at the request rate (plan.md's data-model note).
 */
export const record = internalMutation({
  args: {
    sourceId: v.string(),
    outcome: outcomeValidator,
    readingsAccepted: v.optional(v.number()),
    readingsRejected: v.optional(v.number()),
    rejectedByReason: v.optional(v.record(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const minuteStart = floorToMinute(Date.now());
    const existing = await ctx.db
      .query("ingestStats")
      .withIndex("by_source_and_minuteStart", (q) =>
        q.eq("sourceId", args.sourceId).eq("minuteStart", minuteStart),
      )
      .unique();

    const base = existing ?? {
      minuteStart,
      sourceId: args.sourceId,
      readingsAccepted: 0,
      readingsRejected: 0,
      rejectedByReason: {} as Record<string, number>,
      requestsAccepted: 0,
      requestsCredentialFailed: 0,
      requestsRateLimited: 0,
      requestsOversize: 0,
      requestsMalformed: 0,
    };

    const rejectedByReason = { ...base.rejectedByReason };
    for (const [reason, count] of Object.entries(args.rejectedByReason ?? {})) {
      rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + count;
    }

    const updated = {
      minuteStart,
      sourceId: args.sourceId,
      readingsAccepted: base.readingsAccepted + (args.readingsAccepted ?? 0),
      readingsRejected: base.readingsRejected + (args.readingsRejected ?? 0),
      rejectedByReason,
      requestsAccepted: base.requestsAccepted + (args.outcome === "accepted" ? 1 : 0),
      requestsCredentialFailed:
        base.requestsCredentialFailed + (args.outcome === "credentialFailed" ? 1 : 0),
      requestsRateLimited: base.requestsRateLimited + (args.outcome === "rateLimited" ? 1 : 0),
      requestsOversize: base.requestsOversize + (args.outcome === "oversize" ? 1 : 0),
      requestsMalformed: base.requestsMalformed + (args.outcome === "malformed" ? 1 : 0),
    };

    if (existing) {
      await ctx.db.patch(existing._id, updated);
    } else {
      await ctx.db.insert("ingestStats", updated);
    }
  },
});

/** Aggregates per-minute counters over `[fromTs, toTs)` for R25's "how much
 * was accepted/rejected/throttled, and why". */
export const summary = internalQuery({
  args: { fromTs: v.number(), toTs: v.number() },
  handler: async (ctx, { fromTs, toTs }) => {
    const rows = await ctx.db
      .query("ingestStats")
      .filter((q) => q.and(q.gte(q.field("minuteStart"), fromTs), q.lt(q.field("minuteStart"), toTs)))
      .collect();

    const totals = {
      readingsAccepted: 0,
      readingsRejected: 0,
      rejectedByReason: {} as Record<string, number>,
      requestsAccepted: 0,
      requestsCredentialFailed: 0,
      requestsRateLimited: 0,
      requestsOversize: 0,
      requestsMalformed: 0,
      bySource: {} as Record<string, { readingsAccepted: number; readingsRejected: number }>,
    };

    for (const row of rows) {
      totals.readingsAccepted += row.readingsAccepted;
      totals.readingsRejected += row.readingsRejected;
      totals.requestsAccepted += row.requestsAccepted;
      totals.requestsCredentialFailed += row.requestsCredentialFailed;
      totals.requestsRateLimited += row.requestsRateLimited;
      totals.requestsOversize += row.requestsOversize;
      totals.requestsMalformed += row.requestsMalformed;
      for (const [reason, count] of Object.entries(row.rejectedByReason)) {
        totals.rejectedByReason[reason] = (totals.rejectedByReason[reason] ?? 0) + count;
      }
      const bySource = totals.bySource[row.sourceId] ?? {
        readingsAccepted: 0,
        readingsRejected: 0,
      };
      bySource.readingsAccepted += row.readingsAccepted;
      bySource.readingsRejected += row.readingsRejected;
      totals.bySource[row.sourceId] = bySource;
    }

    return totals;
  },
});

const PRUNE_PAGE_SIZE = 500;
// Convex transactions cap the number of documents a query can scan/read well
// below realistic large values of INGEST_REJECTION_MAX_ROWS (the default is
// 200,000 rows), so an atomic "delete until exactly at the cap" is not
// possible at that default — see README's Ingestion section. The count-based
// backstop below is only exact when the configured cap is small enough to
// probe in one bounded query; age-based retention (above it) is the primary,
// always-exact control for both tables.
const ROW_CAP_PROBE_LIMIT = 4000;

/**
 * Hourly cleanup (`backend/crons.ts`): bounds `ingestRejections` and
 * `ingestStats` storage by age, and additionally trims `ingestRejections` by
 * row count when that is cheaply checkable. Deletes in bounded pages per
 * invocation rather than all at once, so a large backlog converges over
 * several cron runs instead of blowing a single transaction's write/scan
 * limits.
 */
export const prune = internalMutation({
  args: {},
  handler: async (ctx) => {
    const config = loadIngestConfig();
    const now = Date.now();

    // Age-based retention: ingestRejections (R13's bound).
    const staleRejections = await ctx.db
      .query("ingestRejections")
      .withIndex("by_ts", (q) => q.lt("ts", now - config.rejectionRetentionMs))
      .order("asc")
      .take(PRUNE_PAGE_SIZE);
    for (const row of staleRejections) {
      await ctx.db.delete(row._id);
    }

    // Age-based retention: ingestStats (R25's bound).
    const staleStats = await ctx.db
      .query("ingestStats")
      .withIndex("by_minuteStart", (q) => q.lt("minuteStart", now - config.statsRetentionMs))
      .order("asc")
      .take(PRUNE_PAGE_SIZE);
    for (const row of staleStats) {
      await ctx.db.delete(row._id);
    }

    // Count-based backstop for ingestRejections, only when exactly checkable
    // in one bounded query (see ROW_CAP_PROBE_LIMIT above).
    if (config.rejectionMaxRows < ROW_CAP_PROBE_LIMIT) {
      const probe = await ctx.db
        .query("ingestRejections")
        .withIndex("by_ts")
        .order("asc")
        .take(config.rejectionMaxRows + PRUNE_PAGE_SIZE);
      const overflow = probe.length - config.rejectionMaxRows;
      if (overflow > 0) {
        for (const row of probe.slice(0, overflow)) {
          await ctx.db.delete(row._id);
        }
      }
    }
  },
});
