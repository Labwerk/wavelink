import { describe, expect, test } from "vitest";
import { setupTest } from "./testUtils";
import { api } from "./_generated/api";
import { NOT_AUTHORIZED } from "./lib/auth";
import { createUserFixture } from "../tests/testUtils";

// `data.read` is the minimum-role capability every `liveView.*` query
// requires (viewer and up) — see backend/lib/permissions.ts.
async function authed(t: ReturnType<typeof setupTest>) {
  const { as } = await createUserFixture(t, "viewer");
  return as;
}

async function seedDevice(
  t: ReturnType<typeof setupTest>,
  overrides: Partial<{
    externalId: string;
    name: string;
    type: string;
    zone: string;
    status: "online" | "offline" | "unknown";
    lastSeenAt: number;
    isActive: boolean;
    metadata: Record<string, string>;
  }> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("devices", {
      externalId: overrides.externalId ?? "dev-1",
      name: overrides.name ?? "Device 1",
      type: overrides.type ?? "cnc-mill",
      zone: overrides.zone,
      status: overrides.status ?? "online",
      lastSeenAt: overrides.lastSeenAt,
      isActive: overrides.isActive ?? true,
      metadata: overrides.metadata,
    }),
  );
}

describe("liveView.overview", () => {
  test("throws for an unauthenticated caller (R8)", async () => {
    const t = setupTest();
    await expect(t.query(api.liveView.overview, {})).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("shows status/lastSeenAt verbatim and resolved key metrics for active devices (R1, R2)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t, {
      status: "online",
      lastSeenAt: 1_000,
      zone: "line-a",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 900,
        metric: "temperature_c",
        value: 41,
      });
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 1_000,
        metric: "temperature_c",
        value: 47,
      });
    });

    const rows = await (await authed(t)).query(api.liveView.overview, {});
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.status).toBe("online");
    expect(row.lastSeenAt).toBe(1_000);
    expect(row.zone).toBe("line-a");

    const temp = row.keyMetrics.find((m: { metric: string }) => m.metric === "temperature_c");
    expect(temp?.value).toBe(47);
    expect(temp?.ts).toBe(1_000);

    // cycle_count/error_code were never reported: present, but null (R2 — a
    // metric with no reading renders as "—", distinguishable from a zero).
    const cycles = row.keyMetrics.find((m: { metric: string }) => m.metric === "cycle_count");
    expect(cycles?.value).toBeNull();
  });

  test("excludes decommissioned devices (R1)", async () => {
    const t = setupTest();
    await seedDevice(t, { externalId: "active-1", isActive: true });
    await seedDevice(t, { externalId: "gone-1", isActive: false });

    const rows = await (await authed(t)).query(api.liveView.overview, {});
    expect(rows.map((r: { externalId: string }) => r.externalId)).toEqual(["active-1"]);
  });

  test("resolves a per-device metadata.expectedIntervalMs override (R6)", async () => {
    const t = setupTest();
    await seedDevice(t, { metadata: { expectedIntervalMs: "60000" } });

    const rows = await (await authed(t)).query(api.liveView.overview, {});
    expect(rows[0].expectedIntervalMs).toBe(60_000);
  });
});

describe("liveView.deviceSnapshot", () => {
  test("throws for an unauthenticated caller (R8)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);
    await expect(t.query(api.liveView.deviceSnapshot, { deviceId })).rejects.toThrow(
      NOT_AUTHORIZED,
    );
  });

  test("returns null for a nonexistent device", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);
    await t.run((ctx) => ctx.db.delete(deviceId));

    const snapshot = await (await authed(t)).query(api.liveView.deviceSnapshot, { deviceId });
    expect(snapshot).toBeNull();
  });

  test("returns the union of configured and discovered metrics, each resolved exactly (R3)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);
    await t.run(async (ctx) => {
      // A metric not in the configured key-metric list for this type.
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 100,
        metric: "vibration_mm_s",
        value: 0.4,
      });
      await ctx.db.insert("telemetry", {
        deviceId,
        ts: 200,
        metric: "temperature_c",
        value: 52,
      });
    });

    const snapshot = await (await authed(t)).query(api.liveView.deviceSnapshot, { deviceId });
    const metricNames = snapshot!.metrics.map((m: { metric: string }) => m.metric).sort();
    expect(metricNames).toEqual(
      ["cycle_count", "error_code", "temperature_c", "vibration_mm_s"].sort(),
    );
    const vibration = snapshot!.metrics.find(
      (m: { metric: string }) => m.metric === "vibration_mm_s",
    );
    expect(vibration?.value).toBe(0.4);
  });

  test("still returns a decommissioned device, labelled, instead of null (R3 edge case)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t, { isActive: false });

    const snapshot = await (await authed(t)).query(api.liveView.deviceSnapshot, { deviceId });
    expect(snapshot).not.toBeNull();
    expect(snapshot!.device.isActive).toBe(false);
  });
});

describe("liveView.recentEvents", () => {
  test("throws for an unauthenticated caller (R8)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);
    await expect(t.query(api.liveView.recentEvents, { deviceId })).rejects.toThrow(
      NOT_AUTHORIZED,
    );
  });

  test("returns telemetry rows newest-first, bounded by limit (R4)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("telemetry", {
          deviceId,
          ts: i * 10,
          metric: "temperature_c",
          value: i,
        });
      }
    });

    const events = await (await authed(t)).query(api.liveView.recentEvents, { deviceId, limit: 3 });
    expect(events.map((e: { ts: number }) => e.ts)).toEqual([40, 30, 20]);
  });

  test("defaults to 50 and never returns alert data (R4)", async () => {
    const t = setupTest();
    const deviceId = await seedDevice(t);
    await t.run((ctx) =>
      ctx.db.insert("telemetry", { deviceId, ts: 1, metric: "temperature_c", value: 1 }),
    );

    const events = await (await authed(t)).query(api.liveView.recentEvents, { deviceId });
    expect(events).toHaveLength(1);
    // Shape assertion backing the "reads only telemetry" claim: every key on
    // every returned entry is one of the telemetry-row fields this function
    // maps, never an alert-record field (severity/message/acknowledgedBy/...).
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(["id", "metric", "ts", "value"]);
    }
  });
});
