import { describe, expect, test } from "vitest";
import { setupTest } from "./testUtils";
import { api } from "./_generated/api";
import { normalizeExternalIdKey } from "./lib/validation";
import { createUserFixture } from "../tests/testUtils";

// Auth behavior (unauthenticated/per-role) for `telemetry.latestForDevice`
// is covered by tests/devices.test.ts; this file only exercises the
// latest-per-metric reduction, so it just needs any authenticated caller —
// `data.read` is held by every role (backend/lib/permissions.ts).
async function authed(t: ReturnType<typeof setupTest>) {
  const { as } = await createUserFixture(t, "viewer");
  return as;
}

async function seedDevice(t: ReturnType<typeof setupTest>) {
  return t.run((ctx) =>
    ctx.db.insert("devices", {
      externalId: "dev-1",
      externalIdKey: normalizeExternalIdKey("dev-1"),
      name: "Device 1",
      type: "cnc-mill",
      status: "online",
      lifecycle: "in_service",
    }),
  );
}

describe("telemetry.latestForDevice", () => {
  test("returns one row per metric, the newest one", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 100,
        metric: "temperature_c",
        value: 40,
      });
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 200,
        metric: "temperature_c",
        value: 55,
      });
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 150,
        metric: "cycle_count",
        value: 3,
      });
    });

    const readings = await (await authed(t)).query(api.telemetry.latestForDevice, { deviceId });
    const byMetric = Object.fromEntries(readings.map((r) => [r.metric, r]));

    expect(readings).toHaveLength(2);
    expect(byMetric.temperature_c.value).toBe(55);
    expect(byMetric.temperature_c.ts).toBe(200);
    expect(byMetric.cycle_count.value).toBe(3);
  });

  test("returns an empty array for a device with no telemetry", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);

    const readings = await (await authed(t)).query(api.telemetry.latestForDevice, { deviceId });
    expect(readings).toEqual([]);
  });
});
