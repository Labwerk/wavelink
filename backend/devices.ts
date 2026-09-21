import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { requireCapability } from "./lib/auth";
import { recordAudit, diffFields } from "./lib/audit";
import { authedMutation, authedQuery } from "./lib/functions";
import { deviceListPageSize, heartbeatWindowMs } from "./lib/config";
import {
  normalizeExternalIdKey,
  throwIfErrors,
  trimToUndefinedIfBlank,
  validateMetadataInto,
  validateRequiredTrimmed,
  validationError,
  type FieldError,
} from "./lib/validation";

const DEVICE_NOT_FOUND = () => validationError([{ field: "_form", message: "Device not found" }]);

// Role matrix (spec `specs/auth-roles/spec.md` "Users & roles"): reads need
// `data.read` (all four roles); register/update/decommission/reactivate/
// changeHistory need `device.manage` (admin). Every write appends an audit
// row in the same mutation (R11).

const statusValidator = v.union(
  v.literal("online"),
  v.literal("offline"),
  v.literal("unknown"),
);

const FACETS_SCAN_CAP = 1000;

function recomputeStatus(
  lastSeenAt: number | undefined,
  now: number,
): "online" | "offline" | "unknown" {
  if (lastSeenAt === undefined) return "unknown";
  return now - lastSeenAt < heartbeatWindowMs() ? "online" : "offline";
}

type DeviceFilterArgs = {
  zone?: string;
  type?: string;
  status?: "online" | "offline" | "unknown";
  includeDecommissioned?: boolean;
};

/**
 * Index-narrows on the single most selective filter supplied (status, then
 * zone, then type — plan.md's Data model table assigns each its own compound
 * index, all prefixed by `lifecycle`); any remaining filters are applied as
 * residual in-query predicates by the caller (plan.md "Multi-dimension
 * filtering"). `includeDecommissioned` spans both lifecycle values, which no
 * compound index (all prefixed by `lifecycle`) can narrow on, so it falls
 * back to a full scan — acceptable at the low-hundreds fleet size this is
 * admin-only and gated behind.
 */
function selectDeviceSource(ctx: QueryCtx, { zone, type, status, includeDecommissioned }: DeviceFilterArgs) {
  if (includeDecommissioned) {
    return ctx.db.query("devices");
  }
  if (status !== undefined) {
    return ctx.db
      .query("devices")
      .withIndex("by_lifecycle_status_lastSeenAt", (q) => q.eq("lifecycle", "in_service").eq("status", status));
  }
  if (zone !== undefined) {
    return ctx.db
      .query("devices")
      .withIndex("by_lifecycle_and_zone", (q) => q.eq("lifecycle", "in_service").eq("zone", zone));
  }
  if (type !== undefined) {
    return ctx.db
      .query("devices")
      .withIndex("by_lifecycle_and_type", (q) => q.eq("lifecycle", "in_service").eq("type", type));
  }
  return ctx.db.query("devices").withIndex("by_lifecycle_status_lastSeenAt", (q) => q.eq("lifecycle", "in_service"));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * R7/R10/R11: filtered, paginated, reactive device list. Filters combine with
 * AND. Defaults to in-service devices only (R25); `includeDecommissioned` is
 * admin-only and marks them.
 */
export const list = authedQuery({
  capability: "data.read",
  args: {
    paginationOpts: paginationOptsValidator,
    zone: v.optional(v.string()),
    type: v.optional(v.string()),
    status: v.optional(statusValidator),
    includeDecommissioned: v.optional(v.boolean()),
  },
  handler: async (ctx, { paginationOpts, zone, type, status, includeDecommissioned }) => {
    if (includeDecommissioned) {
      await requireCapability(ctx, "device.manage");
    }

    // R11: bound the result set server-side regardless of what a caller
    // requests — `usePaginatedQuery` normally asks for `DEVICE_LIST_PAGE_SIZE`,
    // but nothing stops a direct call from requesting more, so clamp to a
    // generous multiple of the configured default rather than trusting the
    // client-supplied `numItems` outright.
    const cappedPaginationOpts = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, deviceListPageSize() * 4),
    };

    const source = selectDeviceSource(ctx, { zone, type, status, includeDecommissioned });
    const result = await source.paginate(cappedPaginationOpts);
    const page = result.page.filter((d) => {
      if (!includeDecommissioned && d.lifecycle !== "in_service") return false;
      if (zone !== undefined && d.zone !== zone) return false;
      if (type !== undefined && d.type !== type) return false;
      if (status !== undefined && d.status !== status) return false;
      return true;
    });

    return { ...result, page };
  },
});

/** Detail: registry fields + lifecycle + connectivity, all from the one stored row (R5, R28). */
export const get = authedQuery({
  capability: "data.read",
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    return ctx.db.get(deviceId);
  },
});

/**
 * R8/R9: distinct zones/types/statuses with counts, derived from devices
 * that actually exist (no hard-coded list), respecting the filters already
 * active on the other dimensions.
 */
export const facets = authedQuery({
  capability: "data.read",
  args: {
    zone: v.optional(v.string()),
    type: v.optional(v.string()),
    status: v.optional(statusValidator),
    includeDecommissioned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.includeDecommissioned) {
      await requireCapability(ctx, "device.manage");
    }

    // Deliberately NOT `selectDeviceSource`: each tally below excludes its
    // own dimension's filter (a facet must offer every zone as a choice even
    // while a zone filter is active), so the shared base scan must not be
    // index-narrowed by zone/type/status at all — doing so would silently
    // drop every OTHER value of whichever dimension the index happened to
    // narrow on, corrupting exactly that dimension's own facet. Only
    // `lifecycle` (common to every tally) is safe to narrow by here; `list`
    // (which returns one AND-filtered result set, not three independent
    // per-dimension tallies) is where `by_lifecycle_and_zone`/
    // `by_lifecycle_and_type` are put to use.
    const rows = args.includeDecommissioned
      ? await ctx.db.query("devices").take(FACETS_SCAN_CAP + 1)
      : await ctx.db
          .query("devices")
          .withIndex("by_lifecycle_status_lastSeenAt", (q) => q.eq("lifecycle", "in_service"))
          .take(FACETS_SCAN_CAP + 1);
    const truncated = rows.length > FACETS_SCAN_CAP;
    const scanned = truncated ? rows.slice(0, FACETS_SCAN_CAP) : rows;

    function matches(d: Doc<"devices">, exclude: "zone" | "type" | "status"): boolean {
      if (!args.includeDecommissioned && d.lifecycle !== "in_service") return false;
      if (exclude !== "zone" && args.zone !== undefined && d.zone !== args.zone) return false;
      if (exclude !== "type" && args.type !== undefined && d.type !== args.type) return false;
      if (exclude !== "status" && args.status !== undefined && d.status !== args.status)
        return false;
      return true;
    }

    function tally(
      exclude: "zone" | "type" | "status",
      keyFn: (d: Doc<"devices">) => string | undefined,
    ): { value: string; count: number }[] {
      const counts = new Map<string, number>();
      for (const d of scanned) {
        if (!matches(d, exclude)) continue;
        const key = keyFn(d);
        if (key === undefined) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value));
    }

    return {
      truncated,
      zones: tally("zone", (d) => d.zone),
      types: tally("type", (d) => d.type),
      statuses: tally("status", (d) => d.status),
    };
  },
});

/** R17/R31: admin-only change history for one device, newest first. */
export const changeHistory = authedQuery({
  capability: "device.manage",
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    return ctx.db
      .query("auditLog")
      .withIndex("by_target", (q) => q.eq("targetTable", "devices").eq("targetId", deviceId))
      .order("desc")
      .collect();
  },
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** R12/R18/R19/R20/R22/R23: validate → insert → audit. */
export const register = authedMutation({
  capability: "device.manage",
  args: {
    externalId: v.string(),
    name: v.string(),
    type: v.string(),
    zone: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const errors: FieldError[] = [];
    const externalId = validateRequiredTrimmed("externalId", args.externalId, errors);
    const name = validateRequiredTrimmed("name", args.name, errors);
    const type = validateRequiredTrimmed("type", args.type, errors);
    const zone = args.zone !== undefined ? trimToUndefinedIfBlank(args.zone) : undefined;
    validateMetadataInto(args.metadata, errors);

    const externalIdKey = normalizeExternalIdKey(externalId);
    if (externalId.length > 0) {
      // R19: unique across ALL lifecycle states, including decommissioned.
      const existing = await ctx.db
        .query("devices")
        .withIndex("by_externalIdKey", (q) => q.eq("externalIdKey", externalIdKey))
        .unique();
      if (existing) {
        errors.push({
          field: "externalId",
          message: `externalId "${externalId}" is already registered to "${existing.name}"`,
        });
      }
    }
    throwIfErrors(errors);

    const deviceId = await ctx.db.insert("devices", {
      externalId,
      externalIdKey,
      name,
      type,
      zone,
      status: "unknown",
      lifecycle: "in_service",
      metadata: args.metadata,
    });

    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.register",
      targetTable: "devices",
      targetId: deviceId,
      changes: [
        { field: "externalId", after: externalId },
        { field: "name", after: name },
        { field: "type", after: type },
        ...(zone !== undefined ? [{ field: "zone", after: zone }] : []),
        ...(args.metadata !== undefined
          ? [{ field: "metadata", after: JSON.stringify(args.metadata).slice(0, 512) }]
          : []),
      ],
    });

    return deviceId;
  },
});

/**
 * R13/R21/R23: edit name/type/zone/metadata. `externalId` is deliberately not
 * declared in `args` — Convex's arg validator rejects an undeclared field
 * before this handler ever runs, which is what makes the identifier
 * immutable (R21) at the platform level.
 */
export const update = authedMutation({
  capability: "device.manage",
  args: {
    deviceId: v.id("devices"),
    name: v.optional(v.string()),
    type: v.optional(v.string()),
    zone: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (!device) {
      throw DEVICE_NOT_FOUND();
    }

    const errors: FieldError[] = [];
    const patch: Partial<Doc<"devices">> = {};

    if (args.name !== undefined) {
      patch.name = validateRequiredTrimmed("name", args.name, errors);
    }
    if (args.type !== undefined) {
      patch.type = validateRequiredTrimmed("type", args.type, errors);
    }
    if (args.zone !== undefined) {
      patch.zone = trimToUndefinedIfBlank(args.zone);
    }
    if (args.metadata !== undefined) {
      validateMetadataInto(args.metadata, errors);
      patch.metadata = args.metadata;
    }
    throwIfErrors(errors);

    const changeableFields = Object.keys(patch);
    if (changeableFields.length === 0) {
      return device._id;
    }

    const before = device as unknown as Record<string, unknown>;
    const after = { ...before, ...patch };
    const changes = diffFields(before, after, changeableFields);
    if (changes.length === 0) {
      return device._id;
    }

    await ctx.db.patch(args.deviceId, patch);
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.update",
      targetTable: "devices",
      targetId: args.deviceId,
      changes,
    });

    return args.deviceId;
  },
});

/** R14/R24: non-destructive — only lifecycle (+ who/when) changes; history is untouched. */
export const decommission = authedMutation({
  capability: "device.manage",
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    const device = await ctx.db.get(deviceId);
    if (!device) {
      throw DEVICE_NOT_FOUND();
    }
    if (device.lifecycle === "decommissioned") {
      return deviceId; // Idempotent no-op: nothing changed, nothing to audit (R30).
    }

    await ctx.db.patch(deviceId, {
      lifecycle: "decommissioned",
      decommissionedAt: Date.now(),
      decommissionedBy: ctx.user._id,
    });
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.decommission",
      targetTable: "devices",
      targetId: deviceId,
      changes: [{ field: "lifecycle", before: "in_service", after: "decommissioned" }],
    });

    return deviceId;
  },
});

/** R14/R24: restores the device to `in_service`, recomputing connectivity once. */
export const reactivate = authedMutation({
  capability: "device.manage",
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    const device = await ctx.db.get(deviceId);
    if (!device) {
      throw DEVICE_NOT_FOUND();
    }
    if (device.lifecycle === "in_service") {
      return deviceId; // Idempotent no-op.
    }

    const status = recomputeStatus(device.lastSeenAt, Date.now());
    await ctx.db.patch(deviceId, {
      lifecycle: "in_service",
      decommissionedAt: undefined,
      decommissionedBy: undefined,
      status,
    });
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.reactivate",
      targetTable: "devices",
      targetId: deviceId,
      changes: [{ field: "lifecycle", before: "decommissioned", after: "in_service" }],
    });

    return deviceId;
  },
});

// ---------------------------------------------------------------------------
// Internal (not part of the public API surface — see R17/R27 enumeration test)
// ---------------------------------------------------------------------------

const SWEEP_PAGE_SIZE = 500;

/**
 * R3/R6: the only mechanism that can move a device from `online` to
 * `offline` with no further telemetry — a scheduled WRITE, because Convex
 * freezes `Date.now()` per execution and only invalidates query
 * subscriptions on data change (see plan.md "The one hard constraint"). Run
 * every 15s by `crons.ts`. Documented worst-case visibility delay:
 * `DEVICE_HEARTBEAT_WINDOW_MS` + 15s.
 */
export const sweepOffline = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - heartbeatWindowMs();
    const page = await ctx.db
      .query("devices")
      .withIndex("by_lifecycle_status_lastSeenAt", (q) =>
        q.eq("lifecycle", "in_service").eq("status", "online").lt("lastSeenAt", cutoff),
      )
      .take(SWEEP_PAGE_SIZE);

    for (const device of page) {
      await ctx.db.patch(device._id, { status: "offline" });
    }

    if (page.length === SWEEP_PAGE_SIZE) {
      // The page was full: more devices may be past the cutoff. Keep sweeping
      // now rather than waiting for the next 15s tick.
      await ctx.scheduler.runAfter(0, internal.devices.sweepOffline, {});
    }

    return { swept: page.length };
  },
});

/**
 * One-off migration utility (plan.md "Schema migration"): backfills
 * `lifecycle` from a legacy `isActive: boolean` for a deployment that had
 * devices before this schema version. Run once, after temporarily relaxing
 * the schema to make `lifecycle` optional and before re-tightening it to
 * required — see README "Migrating an existing deployment". A no-op against
 * any deployment where every row already has `lifecycle` (including every
 * fresh deployment of this schema version).
 */
export const backfillLifecycle = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("devices").collect();
    let migrated = 0;
    for (const row of rows) {
      const legacy = row as unknown as { isActive?: boolean; lifecycle?: string };
      if (legacy.lifecycle === undefined) {
        await ctx.db.patch(row._id, {
          lifecycle: legacy.isActive === false ? "decommissioned" : "in_service",
        });
        migrated++;
      }
    }
    return { migrated };
  },
});
