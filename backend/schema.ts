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
