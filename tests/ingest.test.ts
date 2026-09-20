import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import schema from "../backend/schema";
import { isValidServiceToken } from "../backend/lib/serviceAuth";
import { createUserFixture, type Test } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");
const ingestSource = (
  import.meta.glob("../backend/ingest.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>
)["../backend/ingest.ts"];
const TOKEN = "test-ingest-token-123";

async function seedDevice(t: Test) {
  return t.run((ctx) =>
    ctx.db.insert("devices", {
      externalId: "sim-1",
      name: "Sim 1",
      type: "cnc-mill",
      status: "unknown",
      isActive: true,
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
