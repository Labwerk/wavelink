import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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

  users: defineTable({
    authId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("viewer"),
      v.literal("operator"),
      v.literal("maintenance"),
      v.literal("admin"),
    ),
    isActive: v.boolean(),
  })
    .index("by_authId", ["authId"])
    .index("by_role", ["role"]),

  // General audit trail (R29/R30/R31). `entityTable`/`entityId` are generic
  // (by convention, not a typed reference) so future features — role changes,
  // alert-rule edits — can reuse this table instead of each growing its own.
  auditLog: defineTable({
    entityTable: v.string(),
    entityId: v.string(),
    action: v.string(),
    actorUserId: v.optional(v.id("users")),
    actorLabel: v.string(),
    at: v.number(),
    changes: v.array(
      v.object({
        field: v.string(),
        before: v.optional(v.string()),
        after: v.optional(v.string()),
      }),
    ),
  })
    .index("by_entity", ["entityTable", "entityId", "at"])
    .index("by_at", ["at"]),
});
