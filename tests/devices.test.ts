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
