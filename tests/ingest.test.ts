// R2, R20, R26: ingest resolves devices by normalized externalIdKey and never
// resurrects a decommissioned device's state.

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "../backend/_generated/api";
import schema from "../backend/schema";
import { createUserFixture } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");

describe("ingest.recordBatch", () => {
  test("an unregistered externalId is skipped, not auto-created", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.ingest.recordBatch, {
      readings: [{ externalId: "ghost-01", ts: Date.now(), metric: "t", value: 1 }],
    });
    const { as: admin } = await createUserFixture(t, "admin");
    const list = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page).toEqual([]);
  });

  test("telemetry for an in-service device is recorded and flips it online (R2)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "live-01",
      name: "Live",
      type: "agv",
    });

    await t.mutation(api.ingest.recordBatch, {
      readings: [{ externalId: "live-01", ts: 1000, metric: "temp", value: 42 }],
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.status).toBe("online");
    expect(device?.lastSeenAt).toBe(1000);

    const readings = await admin.query(api.telemetry.latestForDevice, { deviceId });
    expect(readings).toHaveLength(1);
  });

  test("telemetry for a decommissioned device is refused: no new telemetry row, lifecycle/status unchanged, and the refusal is observable (R26)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "dead-01",
      name: "Dead",
      type: "agv",
    });
    // Give it prior state so we can prove decommission doesn't touch connectivity.
    await t.mutation(api.ingest.recordBatch, {
      readings: [{ externalId: "dead-01", ts: Date.now(), metric: "t", value: 1 }],
    });
    await admin.mutation(api.devices.decommission, { deviceId });
    const before = await admin.query(api.devices.get, { deviceId });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.mutation(api.ingest.recordBatch, {
      readings: [
        { externalId: "dead-01", ts: Date.now(), metric: "t", value: 2 },
        { externalId: "dead-01", ts: Date.now(), metric: "t", value: 3 },
      ],
    });

    const after = await admin.query(api.devices.get, { deviceId });
    expect(after?.lifecycle).toBe("decommissioned");
    expect(after?.status).toBe(before?.status);
    expect(after?.lastSeenAt).toBe(before?.lastSeenAt);
    // Observable rather than silently dropped: aggregated once per batch per device.
    expect(after?.rejectedReadingCount).toBe(2);
    expect(after?.lastRejectedReadingAt).toBeTypeOf("number");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const telemetry = await t.run((ctx) =>
      ctx.db
        .query("telemetry")
        .withIndex("by_device_and_ts", (q) => q.eq("deviceId", deviceId))
        .collect(),
    );
    expect(telemetry).toHaveLength(1); // only the pre-decommission reading

    warnSpy.mockRestore();
  });

  test("a differently-cased/whitespace externalId still resolves to the registered device (R20)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "case-01",
      name: "Case",
      type: "agv",
    });

    await t.mutation(api.ingest.recordBatch, {
      readings: [{ externalId: " CASE-01 ", ts: 5000, metric: "t", value: 1 }],
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.status).toBe("online");
    expect(device?.lastSeenAt).toBe(5000);
  });
});
