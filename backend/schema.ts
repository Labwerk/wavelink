import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator } from "./lib/permissions";

export default defineSchema({
  // Convex Auth's own tables (authSessions, authAccounts, authRefreshTokens,
  // authVerificationCodes, authVerifiers, authRateLimits). Its default
  // `users` table is intentionally overridden below with our own shape
  // (see `specs/auth-roles/plan.md`, Data model): our `createOrUpdateUser`
  // callback in `backend/auth.ts` owns user-row creation, so none of
  // Convex Auth's default `users` fields are required.
  ...authTables,

  devices: defineTable({
    externalId: v.string(),
    name: v.string(),
    type: v.string(),
    zone: v.optional(v.string()),
    status: v.union(
      v.literal("online"),
      v.literal("offline"),
      v.literal("unknown"),
    ),
    lastSeenAt: v.optional(v.number()),
    isActive: v.boolean(),
    metadata: v.optional(v.record(v.string(), v.string())),
  })
    .index("by_externalId", ["externalId"])
    .index("by_zone_and_status", ["zone", "status"]),

  telemetry: defineTable({
    deviceId: v.id("devices"),
    ts: v.number(),
    metric: v.string(),
    value: v.union(v.number(), v.string()),
  })
    .index("by_device_and_ts", ["deviceId", "ts"])
    .index("by_device_metric_and_ts", ["deviceId", "metric", "ts"]),

  alertRules: defineTable({
    deviceType: v.optional(v.string()),
    deviceId: v.optional(v.id("devices")),
    metric: v.string(),
    condition: v.union(
      v.literal("gt"),
      v.literal("lt"),
      v.literal("eq"),
      v.literal("offline_duration"),
    ),
    threshold: v.number(),
    sustainedForMs: v.optional(v.number()),
    isActive: v.boolean(),
    createdBy: v.id("users"),
  }).index("by_device_and_metric", ["deviceId", "metric"]),

  alerts: defineTable({
    deviceId: v.id("devices"),
    ruleId: v.optional(v.id("alertRules")),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    message: v.string(),
    triggeredAt: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("acknowledged"),
      v.literal("resolved"),
    ),
    acknowledgedBy: v.optional(v.id("users")),
    acknowledgedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_device_and_status", ["deviceId", "status"])
    .index("by_status_and_triggeredAt", ["status", "triggeredAt"]),

  // Identity + exactly one role (R2). The row's own `_id` is the identity
  // (`getAuthUserId`); `role` is written only by the creation callback in
  // `auth.ts` (via `lib/provisioning.ts`: "viewer", or "admin" on the
  // self-derived first-admin bootstrap) and by `users.setRole`.
  users: defineTable({
    email: v.string(),
    name: v.string(),
    role: roleValidator,
    isActive: v.boolean(),
    // The admin who provisioned this account, validated inside the creation
    // transaction. Absent for the bootstrap admin.
    createdBy: v.optional(v.id("users")),
  })
    .index("by_email", ["email"])
    .index("by_role", ["role"]),

  // One row per rejected reading (telemetry-ingestion R13). Optional fields
  // are optional because a malformed payload may not have supplied them — a
  // rejection row must never itself fail to write because the input was
  // garbage.
  ingestRejections: defineTable({
    ts: v.number(),
    sourceId: v.string(),
    batchId: v.string(),
    index: v.number(),
    reason: v.union(
      v.literal("missing_field"),
      v.literal("unexpected_field"),
      v.literal("wrong_type"),
      v.literal("timestamp_too_far_future"),
      v.literal("timestamp_too_old"),
      v.literal("value_not_finite"),
      v.literal("external_id_too_long"),
      v.literal("metric_too_long"),
      v.literal("string_value_too_long"),
      v.literal("unknown_device"),
      v.literal("inactive_device"),
    ),
    externalId: v.optional(v.string()),
    metric: v.optional(v.string()),
    claimedTs: v.optional(v.number()),
  })
    .index("by_ts", ["ts"])
    .index("by_reason_and_ts", ["reason", "ts"]),

  // Per-minute ingestion counters (telemetry-ingestion R25). One doc per
  // (sourceId, minuteStart), read-modify-written once per batch — never per
  // reading — so contention stays at the request rate. `"unauthenticated"` is
  // the sentinel sourceId for credential failures, which have no real source.
  ingestStats: defineTable({
    minuteStart: v.number(),
    sourceId: v.string(),
    readingsAccepted: v.number(),
    readingsRejected: v.number(),
    rejectedByReason: v.record(v.string(), v.number()),
    requestsAccepted: v.number(),
    requestsCredentialFailed: v.number(),
    requestsRateLimited: v.number(),
    requestsOversize: v.number(),
    requestsMalformed: v.number(),
  })
    .index("by_source_and_minuteStart", ["sourceId", "minuteStart"])
    // Used by the prune cron for age-based retention across all sources —
    // by_source_and_minuteStart can't be scanned time-first without pinning
    // a sourceId first.
    .index("by_minuteStart", ["minuteStart"]),

  // Hand-rolled token-bucket state, one row per rate-limit key (e.g.
  // "ingestRequests:<sourceId>" or "ingestReadings:<sourceId>" — see
  // backend/lib/ingestRateLimit.ts). Fallback for the
  // @convex-dev/rate-limiter component; see
  // specs/telemetry-ingestion/tasks.md "Deviations from plan".
  ingestRateLimits: defineTable({
    key: v.string(),
    tokens: v.number(),
    lastRefillAt: v.number(),
  }).index("by_key", ["key"]),

  // Attribution (R11): appended in the same mutation as every state change.
  auditLog: defineTable({
    // Always the authenticated user who acted. Absent ONLY for break-glass
    // operations run with the deployment admin key, which have no user
    // (currently `user.setPassword`); those rows carry `details.via`.
    actorId: v.optional(v.id("users")),
    action: v.string(),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    details: v.optional(v.record(v.string(), v.string())),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_actor_and_at", ["actorId", "at"])
    .index("by_target", ["targetTable", "targetId", "at"]),
});
