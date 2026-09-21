import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../backend/_generated/api";
import schema from "../backend/schema";
import { NOT_AUTHORIZED } from "../backend/lib/auth";
import { createUserFixture, type Role, type Test } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");

const ALL_ROLES: Role[] = ["viewer", "operator", "maintenance", "admin"];

async function registerDevice(t: Test) {
  const { as: admin } = await createUserFixture(t, "admin");
  const deviceId = await admin.mutation(api.devices.register, {
    externalId: "dev-1",
    name: "Test Device",
    type: "cnc-mill",
  });
  return deviceId;
}

describe("reads: devices.listActive / devices.get / telemetry.latestForDevice (R9)", () => {
  test("unauthenticated calls are rejected", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await registerDevice(t);
    await expect(t.query(api.devices.listActive, {})).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.query(api.devices.get, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
    await expect(
      t.query(api.telemetry.latestForDevice, { deviceId }),
    ).rejects.toThrow(NOT_AUTHORIZED);
  });

  for (const role of ALL_ROLES) {
    test(`${role} can read listActive/get/latestForDevice`, async () => {
      const t = convexTest(schema, modules);
      const deviceId = await registerDevice(t);
      const { as } = await createUserFixture(t, role);

      const list = await as.query(api.devices.listActive, {});
      expect(list.map((d) => d._id)).toContain(deviceId);

      const device = await as.query(api.devices.get, { deviceId });
      expect(device?._id).toBe(deviceId);

      await expect(as.query(api.telemetry.latestForDevice, { deviceId })).resolves.toEqual([]);
    });
  }
});

describe("writes: devices.register/update/deactivate are admin-only (R9)", () => {
  for (const role of ["viewer", "operator", "maintenance"] as Role[]) {
    test(`${role} is denied register/update/deactivate`, async () => {
      const t = convexTest(schema, modules);
      const deviceId = await registerDevice(t);
      const { as } = await createUserFixture(t, role);

      await expect(
        as.mutation(api.devices.register, {
          externalId: "dev-2",
          name: "Other Device",
          type: "agv",
        }),
      ).rejects.toThrow(NOT_AUTHORIZED);

      await expect(
        as.mutation(api.devices.update, { deviceId, name: "Renamed" }),
      ).rejects.toThrow(NOT_AUTHORIZED);

      await expect(
        as.mutation(api.devices.deactivate, { deviceId }),
      ).rejects.toThrow(NOT_AUTHORIZED);
    });
  }

  test("admin is allowed to register, update, and deactivate", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");

    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "dev-3",
      name: "Admin Device",
      type: "robot-arm",
    });
    expect(deviceId).toBeTruthy();

    await admin.mutation(api.devices.update, { deviceId, name: "Renamed by admin" });
    const updated = await admin.query(api.devices.get, { deviceId });
    expect(updated?.name).toBe("Renamed by admin");

    await admin.mutation(api.devices.deactivate, { deviceId });
    const deactivated = await admin.query(api.devices.get, { deviceId });
    expect(deactivated?.isActive).toBe(false);
  });
});

describe("device writes are audited (R11)", () => {
  test("register, update and deactivate each record the acting admin and time", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId: adminId } = await createUserFixture(t, "admin");
    const before = Date.now();
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "dev-audit",
      name: "Audited",
      type: "agv",
    });
    await admin.mutation(api.devices.update, { deviceId, name: "Audited 2" });
    await admin.mutation(api.devices.deactivate, { deviceId });
    const after = Date.now();

    const log = await admin.query(api.audit.list, {});
    expect(log.map((l) => l.action).sort()).toEqual([
      "device.deactivate",
      "device.register",
      "device.update",
    ]);
    for (const entry of log) {
      expect(entry.actorId).toBe(adminId);
      expect(entry.targetTable).toBe("devices");
      expect(entry.targetId).toBe(deviceId);
      expect(entry.at).toBeGreaterThanOrEqual(before);
      expect(entry.at).toBeLessThanOrEqual(after);
    }
  });

  test("a denied write leaves no change and no extra audit row", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await registerDevice(t);
    const { as: viewer } = await createUserFixture(t, "viewer");
    await expect(
      viewer.mutation(api.devices.deactivate, { deviceId }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    const device = await t.run((ctx) => ctx.db.get(deviceId));
    expect(device?.isActive).toBe(true);
    const rows = await t.run((ctx) => ctx.db.query("auditLog").collect());
    // Only the fixture's own `device.register` row exists.
    expect(rows.map((r) => r.action)).toEqual(["device.register"]);
  });
});

describe("non-leakage (R6)", () => {
  test("a forbidden write on an existing device and on a non-existent one are indistinguishable", async () => {
    const t = convexTest(schema, modules);
    const existing = await registerDevice(t);
    const missing = await t.run(async (ctx) => {
      const id = await ctx.db.insert("devices", {
        externalId: "ghost",
        name: "ghost",
        type: "agv",
        status: "unknown",
        isActive: true,
      });
      await ctx.db.delete(id);
      return id;
    });
    const { as: operator } = await createUserFixture(t, "operator");
    const a = await operator
      .mutation(api.devices.deactivate, { deviceId: existing })
      .catch((e: Error) => e.message);
    const b = await operator
      .mutation(api.devices.deactivate, { deviceId: missing })
      .catch((e: Error) => e.message);
    expect(a).toContain(NOT_AUTHORIZED);
    expect(a).toBe(b);
  });

  test("a forbidden read of an existing device and of a non-existent one are indistinguishable", async () => {
    const t = convexTest(schema, modules);
    const existing = await registerDevice(t);
    const missing = await t.run(async (ctx) => {
      const id = await ctx.db.insert("devices", {
        externalId: "ghost",
        name: "ghost",
        type: "agv",
        status: "unknown",
        isActive: true,
      });
      await ctx.db.delete(id);
      return id;
    });
    // Signed out: both fail identically, before any existence check.
    const a = await t
      .query(api.devices.get, { deviceId: existing })
      .catch((e: Error) => e.message);
    const b = await t
      .query(api.devices.get, { deviceId: missing })
      .catch((e: Error) => e.message);
    expect(a).toContain(NOT_AUTHORIZED);
    expect(a).toBe(b);
  });
});

describe("R1: deactivated callers get no protected data", () => {
  test("a deactivated user is treated like a signed-out one", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await registerDevice(t);
    const { as } = await createUserFixture(t, "admin", { isActive: false });
    await expect(as.query(api.devices.listActive, {})).rejects.toThrow(NOT_AUTHORIZED);
    await expect(as.query(api.devices.get, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
  });
});
