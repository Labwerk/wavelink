import { v } from "convex/values";
import { recordAudit } from "./lib/audit";
import { authedMutation, authedQuery } from "./lib/functions";

// Role matrix (spec `specs/auth-roles/spec.md` "Users & roles"): reads need
// `data.read` (all four roles); register/update/deactivate need
// `device.manage` (admin). Every write appends an audit row in the same
// mutation (R11).

export const listActive = authedQuery({
  capability: "data.read",
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("devices")
      .withIndex("by_zone_and_status")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const get = authedQuery({
  capability: "data.read",
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    return ctx.db.get(deviceId);
  },
});

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
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();
    if (existing) {
      throw new Error(`Device with externalId ${args.externalId} already exists`);
    }
    const deviceId = await ctx.db.insert("devices", {
      ...args,
      status: "unknown",
      isActive: true,
    });
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.register",
      targetTable: "devices",
      targetId: deviceId,
      details: { externalId: args.externalId },
    });
    return deviceId;
  },
});

export const update = authedMutation({
  capability: "device.manage",
  args: {
    deviceId: v.id("devices"),
    name: v.optional(v.string()),
    zone: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { deviceId, ...patch }) => {
    await ctx.db.patch(deviceId, patch);
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.update",
      targetTable: "devices",
      targetId: deviceId,
    });
  },
});

export const deactivate = authedMutation({
  capability: "device.manage",
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await ctx.db.patch(deviceId, { isActive: false });
    await recordAudit(ctx, {
      actorId: ctx.user._id,
      action: "device.deactivate",
      targetTable: "devices",
      targetId: deviceId,
    });
  },
});
