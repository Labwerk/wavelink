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
    externalId: v.string(), // Trimmed, as entered. Displayed. Immutable after registration (R21).
    externalIdKey: v.string(), // externalId.trim().toLowerCase() — the uniqueness key (R20). Never shown.
    name: v.string(),
    type: v.string(),
    zone: v.optional(v.string()),
    status: v.union(
      v.literal("online"),
      v.literal("offline"),
      v.literal("unknown"),
    ),
    lastSeenAt: v.optional(v.number()),
    // Lifecycle, distinct from connectivity `status` (R28). Replaces the old
    // `isActive: boolean` — see specs/device-registry/plan.md "Schema migration"
    // and devices.backfillLifecycle for migrating a deployment with legacy rows.
    lifecycle: v.union(v.literal("in_service"), v.literal("decommissioned")),
    decommissionedAt: v.optional(v.number()),
    decommissionedBy: v.optional(v.id("users")),
    metadata: v.optional(v.record(v.string(), v.string())),
    // R26: telemetry received for a decommissioned device is refused but observable.
    rejectedReadingCount: v.optional(v.number()),
    lastRejectedReadingAt: v.optional(v.number()),
  })
    .index("by_externalIdKey", ["externalIdKey"])
    .index("by_lifecycle_status_lastSeenAt", ["lifecycle", "status", "lastSeenAt"])
    .index("by_lifecycle_and_zone", ["lifecycle", "zone"])
    .index("by_lifecycle_and_type", ["lifecycle", "type"]),

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

  // General audit trail (R11/R29/R30/R31). Attribution (R11): appended in the
  // same mutation as every state change. `actorId` is always the
  // authenticated user who acted, EXCEPT for break-glass operations run with
  // the deployment admin key (no user), which carry `details.via` instead.
  // `targetTable`/`targetId` are generic (by convention, not a typed
  // reference) so any feature can reuse this table. `details` holds simple
  // key/value context (e.g. a role change's from/to); `changes` holds a
  // structured per-field before/after diff for edits touching several fields
  // at once (e.g. a device edit) — see `lib/audit.ts` `diffFields`.
  auditLog: defineTable({
    actorId: v.optional(v.id("users")),
    action: v.string(),
    targetTable: v.optional(v.string()),
    targetId: v.optional(v.string()),
    details: v.optional(v.record(v.string(), v.string())),
    changes: v.optional(
      v.array(
        v.object({
          field: v.string(),
          before: v.optional(v.string()),
          after: v.optional(v.string()),
        }),
      ),
    ),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_actor_and_at", ["actorId", "at"])
    .index("by_target", ["targetTable", "targetId", "at"]),
});
