import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuthenticatedUser, requireRole } from "./lib/auth";

// Role matrix (spec `specs/auth-roles/spec.md` §4): reads are open to any
// authenticated, active user (all four roles); register/update/deactivate
// are admin-only (R9).

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireAuthenticatedUser(ctx);
    return ctx.db
      .query("devices")
      .withIndex("by_zone_and_status")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const get = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAuthenticatedUser(ctx);
    return ctx.db.get(deviceId);
  },
});

export const register = mutation({
  args: {
    externalId: v.string(),
    name: v.string(),
    type: v.string(),
    zone: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db
      .query("devices")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();
    if (existing) {
      throw new Error(`Device with externalId ${args.externalId} already exists`);
    }
    return ctx.db.insert("devices", {
      ...args,
      status: "unknown",
      isActive: true,
    });
  },
});

export const update = mutation({
  args: {
    deviceId: v.id("devices"),
    name: v.optional(v.string()),
    zone: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { deviceId, ...patch }) => {
    await requireRole(ctx, ["admin"]);
    await ctx.db.patch(deviceId, patch);
  },
});

export const deactivate = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireRole(ctx, ["admin"]);
    await ctx.db.patch(deviceId, { isActive: false });
  },
});
