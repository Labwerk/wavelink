import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { keyMetricsForType } from "./lib/keyMetrics";
import { expectedIntervalMsFor } from "./lib/freshness";
import { resolveLatestMetrics } from "./lib/latestMetrics";

// specs/live-telemetry-view/plan.md: this feature's entire read surface
// lives in this one file so it's auditable against R1-R8 in one place,
// instead of growing registry-owned (devices.ts) / ingestion-owned
// (telemetry.ts) modules.

// Spec'd deployment ceiling is "tens to low hundreds" of devices; this bound
// just prevents an unbounded read regression, it isn't expected to bite.
const MAX_OVERVIEW_DEVICES = 500;

// How many of a device's most-recent telemetry rows to scan to *discover*
// metric names the config doesn't already know about (R3's "all current
// metrics"). Each discovered name is then resolved exactly.
const METRIC_DISCOVERY_SCAN = 200;

const DEFAULT_EVENT_LOG_LIMIT = 50;
const MAX_EVENT_LOG_LIMIT = 200;

/**
 * Overview screen (R1, R2, R6, R7, R8): every active device's connectivity
 * status and last-seen timestamp verbatim from storage, plus its resolved
 * key metrics and staleness threshold. Filtering/grouping (R7) happens
 * client-side over this one subscribed list.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);

    // Indexed on isActive directly (schema.ts: "by_isActive") rather than
    // scanning by_zone_and_status and filtering post-hoc — R7's zone/status
    // filtering happens client-side over this one subscribed list, so no
    // index ordering on those fields is needed here.
    const devices = await ctx.db
      .query("devices")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .take(MAX_OVERVIEW_DEVICES);

    return Promise.all(
      devices.map(async (device) => {
        const keyMetrics = await resolveLatestMetrics(
          ctx,
          device._id,
          keyMetricsForType(device.type),
        );
        return {
          deviceId: device._id,
          externalId: device.externalId,
          name: device.name,
          type: device.type,
          zone: device.zone,
          status: device.status,
          lastSeenAt: device.lastSeenAt,
          expectedIntervalMs: expectedIntervalMsFor(device),
          keyMetrics,
        };
      }),
    );
  },
});

/**
 * Device detail view (R3, R6, R8): all of a device's current metric values —
 * the union of its configured key metrics and whatever metric names show up
 * in its recent telemetry, each resolved exactly. A decommissioned device
 * (isActive: false) still renders here, labelled, rather than 404ing — it
 * just never appears in `overview`'s list.
 */
export const deviceSnapshot = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAuth(ctx);

    const device = await ctx.db.get(deviceId);
    if (!device) {
      return null;
    }

    const recentRows = await ctx.db
      .query("telemetry")
      .withIndex("by_device_and_ts", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(METRIC_DISCOVERY_SCAN);

    const metricNames = new Set<string>(keyMetricsForType(device.type));
    for (const row of recentRows) {
      metricNames.add(row.metric);
    }

    const metrics = await resolveLatestMetrics(ctx, deviceId, Array.from(metricNames));

    return {
      device: {
        deviceId: device._id,
        externalId: device.externalId,
        name: device.name,
        type: device.type,
        zone: device.zone,
        status: device.status,
        lastSeenAt: device.lastSeenAt,
        isActive: device.isActive,
        metadata: device.metadata,
        expectedIntervalMs: expectedIntervalMsFor(device),
      },
      metrics,
    };
  },
});

/**
 * Device detail view's recent event log (R4, R8): the device's last `limit`
 * raw telemetry rows, newest first. Deliberately reads nothing from `alerts`
 * or `alertRules` — "recent event log" here is device/telemetry activity,
 * not alert history (an explicit non-goal in spec.md).
 */
export const recentEvents = query({
  args: { deviceId: v.id("devices"), limit: v.optional(v.number()) },
  handler: async (ctx, { deviceId, limit }) => {
    await requireAuth(ctx);

    const take = Math.min(Math.max(limit ?? DEFAULT_EVENT_LOG_LIMIT, 1), MAX_EVENT_LOG_LIMIT);

    const rows = await ctx.db
      .query("telemetry")
      .withIndex("by_device_and_ts", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(take);

    return rows.map((row) => ({
      id: row._id,
      ts: row.ts,
      metric: row.metric,
      value: row.value,
    }));
  },
});
