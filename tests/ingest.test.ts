// R2, R12, R20, R26: ingest authenticates with a service token at the HTTP
// layer, resolves devices by normalized externalIdKey, and never resurrects
// a decommissioned device's state.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../backend/_generated/api";
import schema from "../backend/schema";
import { isValidServiceToken } from "../backend/lib/serviceAuth";
import { createUserFixture, type Test } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");
const ingestSource = (
  import.meta.glob("../backend/ingest.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>
)["../backend/ingest.ts"];
const TOKEN = "test-ingest-token-123";

async function seedDevice(t: Test, externalId = "sim-1") {
  return t.run((ctx) =>
    ctx.db.insert("devices", {
      externalId,
      externalIdKey: externalId.trim().toLowerCase(),
      name: "Sim 1",
      type: "cnc-mill",
      status: "unknown",
      lifecycle: "in_service",
    }),
  );
}

const batch = {
  readings: [{ externalId: "sim-1", ts: 1000, metric: "temperature_c", value: 55.5 }],
};

function post(t: Test, body: unknown, auth?: string) {
  return t.fetch("/ingest/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("isValidServiceToken (R12)", () => {
  test("accepts only the exact bearer token", () => {
    expect(isValidServiceToken(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isValidServiceToken(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isValidServiceToken(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(isValidServiceToken(TOKEN, TOKEN)).toBe(false);
    expect(isValidServiceToken(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(isValidServiceToken(null, TOKEN)).toBe(false);
    expect(isValidServiceToken("Bearer ", TOKEN)).toBe(false);
  });

  test("fails closed when no token is configured", () => {
    expect(isValidServiceToken("Bearer anything", undefined)).toBe(false);
    expect(isValidServiceToken("Bearer ", "")).toBe(false);
    expect(isValidServiceToken("Bearer  ", "  ")).toBe(false);
  });
});

describe("POST /ingest/telemetry (R12)", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.INGEST_SERVICE_TOKEN;
    process.env.INGEST_SERVICE_TOKEN = TOKEN;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.INGEST_SERVICE_TOKEN;
    else process.env.INGEST_SERVICE_TOKEN = previous;
  });

  test("the gateway posts a batch with the service token and no user session", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await seedDevice(t);
    const res = await post(t, batch, `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
    const rows = await t.run((ctx) => ctx.db.query("telemetry").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId, metric: "temperature_c", value: 55.5 });
    const device = await t.run((ctx) => ctx.db.get(deviceId));
    expect(device?.status).toBe("online");
  });

  test("a missing or wrong token gets a bare 401 and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedDevice(t);
    for (const auth of [undefined, "Bearer wrong", `Bearer ${TOKEN}x`, TOKEN]) {
      const res = await post(t, batch, auth);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe("");
    }
    expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
  });

  test("a user session cannot substitute for the service credential", async () => {
    const t = convexTest(schema, modules);
    await seedDevice(t);
    const { as } = await createUserFixture(t, "admin");
    const res = await as.fetch("/ingest/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer some-user-jwt" },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
  });

  test("with no INGEST_SERVICE_TOKEN configured every request is rejected", async () => {
    delete process.env.INGEST_SERVICE_TOKEN;
    const t = convexTest(schema, modules);
    await seedDevice(t);
    expect((await post(t, batch, `Bearer ${TOKEN}`)).status).toBe(401);
    expect((await post(t, batch, "Bearer ")).status).toBe(401);
  });

  test("malformed bodies are 400 after a valid token, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    await seedDevice(t);
    expect((await post(t, "not json", `Bearer ${TOKEN}`)).status).toBe(400);
    expect((await post(t, { readings: [{ externalId: 1 }] }, `Bearer ${TOKEN}`)).status).toBe(400);
    expect((await post(t, {}, `Bearer ${TOKEN}`)).status).toBe(400);
    expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
  });

  test("unknown devices are skipped rather than created", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, batch, `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
    expect(await t.run((ctx) => ctx.db.query("devices").collect())).toHaveLength(0);
  });

  test("ingest.recordBatch is registered as an internal mutation, not a public one", () => {
    // convex-test does not enforce public/internal visibility, so assert the
    // declaration itself (the deployed backend does enforce it).
    const src = ingestSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(src).toContain("export const recordBatch = internalMutation(");
    expect(src).not.toContain("export const recordBatch = mutation(");
  });
});

// ---------------------------------------------------------------------------
// Device-matching business logic (R2, R20, R26) — exercised by calling the
// internal mutation directly, since it's the device-matching/decommission
// behavior under test here, not the HTTP-layer auth already covered above.
// ---------------------------------------------------------------------------

describe("ingest.recordBatch device matching (R2, R20, R26)", () => {
  test("an unregistered externalId is skipped, not auto-created", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.ingest.recordBatch, {
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

    await t.mutation(internal.ingest.recordBatch, {
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
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "dead-01", ts: Date.now(), metric: "t", value: 1 }],
    });
    await admin.mutation(api.devices.decommission, { deviceId });
    const before = await admin.query(api.devices.get, { deviceId });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.mutation(internal.ingest.recordBatch, {
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

    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: " CASE-01 ", ts: 5000, metric: "t", value: 1 }],
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.status).toBe("online");
    expect(device?.lastSeenAt).toBe(5000);
  });
});
