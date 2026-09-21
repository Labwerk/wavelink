// Hardened telemetry ingestion: the full `POST /ingest/readings` pipeline
// (spec `specs/telemetry-ingestion/spec.md` R1-R27), exercised end to end
// through `convex-test`'s `t.fetch(...)`, which actually runs the real
// `httpRouter()` → `ingestHttp.ingestReadings` httpAction →
// `internal.ingest.recordBatch` mutation chain against an in-memory Convex
// backend. This is genuine integration coverage of the request pipeline —
// not just unit tests of its pieces (those live in
// `tests/ingestAuth.test.ts`, `tests/ingestConfig.test.ts`,
// `tests/ingestValidation.test.ts`, `tests/ingestRateLimit.test.ts`) — closing
// the "no live verification possible in this sandbox" gap review.md flagged
// for the pre-merge build (still no real Docker/self-hosted-backend
// verification, but the pipeline's actual logic now runs for real).
//
// Supersedes the pre-merge `main` version of this file, which tested
// auth-roles' minimal `/ingest/telemetry` + `INGEST_SERVICE_TOKEN` +
// `isValidServiceToken` design — all now superseded by this feature's
// `/ingest/readings` + `INGEST_TOKENS` + `backend/lib/ingestAuth.ts`
// (`specs/telemetry-ingestion/tasks.md`'s Deviations record why). Also
// covers device-registry's R2/R12/R20/R26: devices are resolved by
// normalized `externalIdKey`, and a decommissioned device's readings are
// rejected without resurrecting its lifecycle/status/lastSeenAt.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../backend/_generated/api";
import schema from "../backend/schema";
import { createUserFixture, type Test } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");

const SOURCE_ID = "test-src";
const SECRET = "s3cret-123";
const TOKEN = `${SOURCE_ID}.${SECRET}`;

/** Sets env vars for the duration of `fn`, restoring the previous values
 * (including "was unset") afterward — used for `INGEST_TOKENS` and the
 * `INGEST_*` tunables, which `backend/lib/ingestConfig.ts` reads live from
 * `process.env` on every call. */
async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withToken<T>(fn: () => Promise<T>, tokens: string = TOKEN): Promise<T> {
  return withEnv({ INGEST_TOKENS: tokens }, fn);
}

async function seedDevice(
  t: Test,
  overrides: Partial<{
    externalId: string;
    lifecycle: "in_service" | "decommissioned";
    lastSeenAt: number;
    status: "online" | "offline" | "unknown";
  }> = {},
) {
  const externalId = overrides.externalId ?? "sim-1";
  return t.run((ctx) =>
    ctx.db.insert("devices", {
      externalId,
      externalIdKey: externalId.trim().toLowerCase(),
      name: "Sim 1",
      type: "cnc-mill",
      status: overrides.status ?? "unknown",
      lifecycle: overrides.lifecycle ?? "in_service",
      lastSeenAt: overrides.lastSeenAt,
    }),
  );
}

function post(t: Test, body: unknown, auth?: string) {
  return t.fetch("/ingest/readings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function readingsBatch(readings: unknown[]) {
  return { readings };
}

describe("POST /ingest/readings — authentication (R1, R2, R3, R5, R6, R7)", () => {
  test("a batch posted with a valid credential is accepted and its readings land in telemetry, visible to a live query (R1)", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const deviceId = await seedDevice(t);
      const res = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "temperature_c", value: 55.5 }]),
        `Bearer ${TOKEN}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ outcome: "accepted", submitted: 1, stored: 1, rejected: [] });

      const rows = await t.run((ctx) => ctx.db.query("telemetry").collect());
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deviceId, metric: "temperature_c", value: 55.5 });

      // Acceptance criterion R1, literally: "visible to a device's live query".
      const { as } = await createUserFixture(t, "viewer");
      const latest = await as.query(api.telemetry.latestForDevice, { deviceId });
      expect(latest).toHaveLength(1);
      expect(latest[0]).toMatchObject({ metric: "temperature_c", value: 55.5 });
    });
  });

  test("missing, garbage, and wrong-scheme credentials each return 401 unauthorized and write nothing (R2)", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const batch = readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "temperature_c", value: 1 }]);
      for (const auth of [undefined, "Bearer wrong", `Bearer ${TOKEN}x`, TOKEN, `Basic ${TOKEN}`]) {
        const res = await post(t, batch, auth);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ outcome: "error", category: "unauthorized" });
      }
      expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
    });
  });

  test("a user session's identity cannot substitute for the service credential (R3)", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const { as } = await createUserFixture(t, "admin");
      const batch = readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "temperature_c", value: 1 }]);
      // Neither an unauthenticated fetch nor one made through an
      // authenticated user's `t` presents a matching INGEST_TOKENS entry —
      // ingestHttp never consults ctx.auth at all.
      const res = await as.fetch("/ingest/readings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer some-user-session-jwt" },
        body: JSON.stringify(batch),
      });
      expect(res.status).toBe(401);
      expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
    });
  });

  test("with INGEST_TOKENS unset or empty, every request is refused (R5)", async () => {
    for (const tokens of [undefined, ""]) {
      await withEnv({ INGEST_TOKENS: tokens }, async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const res = await post(
          t,
          readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "temperature_c", value: 1 }]),
          `Bearer ${TOKEN}`,
        );
        expect(res.status).toBe(401);
      });
    }
  });

  test("rotation: two tokens sharing a sourceId both work; retiring one stops it immediately with no gap for the other (R6)", async () => {
    const oldToken = `${SOURCE_ID}.old-secret`;
    const newToken = `${SOURCE_ID}.new-secret`;
    const t = convexTest(schema, modules);
    await seedDevice(t);
    const batch = readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "temperature_c", value: 1 }]);

    await withEnv({ INGEST_TOKENS: `${oldToken},${newToken}` }, async () => {
      expect((await post(t, batch, `Bearer ${oldToken}`)).status).toBe(200);
      expect((await post(t, batch, `Bearer ${newToken}`)).status).toBe(200);
    });

    await withEnv({ INGEST_TOKENS: newToken }, async () => {
      expect((await post(t, batch, `Bearer ${oldToken}`)).status).toBe(401);
      expect((await post(t, batch, `Bearer ${newToken}`)).status).toBe(200);
    });
  });

  test("wrong-credential responses are byte-identical regardless of the claimed batch, and each failure is counted (R7)", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t, { externalId: "real-device" });
      const forRealDevice = readingsBatch([
        { externalId: "real-device", ts: Date.now(), metric: "temperature_c", value: 1 },
      ]);
      const forNonexistentDevice = readingsBatch([
        { externalId: "no-such-device", ts: Date.now(), metric: "temperature_c", value: 1 },
      ]);
      const resA = await post(t, forRealDevice, "Bearer wrong-credential");
      const resB = await post(t, forNonexistentDevice, "Bearer wrong-credential");
      expect(resA.status).toBe(resB.status);
      expect(await resA.text()).toBe(await resB.text());

      const summary = await t.query(internal.ingestStats.summary, { fromTs: 0, toTs: Date.now() + 1 });
      expect(summary.requestsCredentialFailed).toBe(2);
    });
  });
});

describe("malformed readings (R8, R9, R10)", () => {
  const cases: Array<{ name: string; reading: unknown; reason: string }> = [
    { name: "missing externalId", reading: { ts: 1, metric: "m", value: 1 }, reason: "missing_field" },
    { name: "empty externalId", reading: { externalId: "", ts: 1, metric: "m", value: 1 }, reason: "missing_field" },
    {
      name: "unexpected field",
      reading: { externalId: "sim-1", ts: 1, metric: "m", value: 1, extra: true },
      reason: "unexpected_field",
    },
    {
      name: "boolean value",
      reading: { externalId: "sim-1", ts: 1, metric: "m", value: true },
      reason: "wrong_type",
    },
    {
      name: "string timestamp",
      reading: { externalId: "sim-1", ts: "not-a-number", metric: "m", value: 1 },
      reason: "wrong_type",
    },
    {
      name: "over-length externalId",
      reading: { externalId: "x".repeat(129), ts: 1, metric: "m", value: 1 },
      reason: "external_id_too_long",
    },
    {
      name: "over-length metric",
      reading: { externalId: "sim-1", ts: 1, metric: "x".repeat(65), value: 1 },
      reason: "metric_too_long",
    },
    {
      name: "over-length string value",
      reading: { externalId: "sim-1", ts: 1, metric: "m", value: "x".repeat(513) },
      reason: "string_value_too_long",
    },
  ];

  for (const { name, reading, reason } of cases) {
    test(`${name} -> ${reason}`, async () => {
      await withToken(async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const res = await post(t, readingsBatch([reading]), `Bearer ${TOKEN}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.stored).toBe(0);
        expect(body.rejected).toEqual([expect.objectContaining({ index: 0, reason })]);
      });
    });
  }

  test("non-finite numeric value -> value_not_finite", async () => {
    // JSON has no Infinity/NaN literal: `JSON.stringify(Infinity)` silently
    // becomes `null` (which would test `missing_field`/`wrong_type`
    // instead). A real over-the-wire non-finite number arrives as an
    // oversized numeric literal in the JSON *text* — `1e400` parses to
    // `Infinity` per the JSON spec — so this posts a raw body rather than
    // going through `JSON.stringify` on a JS `Infinity` value.
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const rawBody = '{"readings":[{"externalId":"sim-1","ts":1,"metric":"m","value":1e400}]}';
      expect(JSON.parse(rawBody).readings[0].value).toBe(Infinity); // sanity-check the premise
      const res = await post(t, rawBody, `Bearer ${TOKEN}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stored).toBe(0);
      expect(body.rejected).toEqual([expect.objectContaining({ index: 0, reason: "value_not_finite" })]);
    });
  });

  test("a timestamp far in the future or far in the past is rejected with a timestamp reason (R9)", async () => {
    await withEnv({ INGEST_TOKENS: TOKEN, INGEST_MAX_FUTURE_SKEW_MS: "5000", INGEST_MAX_BACKFILL_AGE_MS: "5000" }, async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const now = Date.now();
      const future = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: now + 60_000, metric: "m", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      expect((await future.json()).rejected[0].reason).toBe("timestamp_too_far_future");

      const past = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: now - 60_000, metric: "m", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      expect((await past.json()).rejected[0].reason).toBe("timestamp_too_old");

      const inWindow = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: now, metric: "m", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      expect((await inWindow.json()).stored).toBe(1);
    });
  });
});

describe("unknown and inactive devices (R11, R12)", () => {
  test("an unregistered externalId is rejected as unknown_device and no device row is created", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const res = await post(
        t,
        readingsBatch([{ externalId: "never-registered", ts: Date.now(), metric: "m", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      const body = await res.json();
      expect(body.rejected).toEqual([expect.objectContaining({ reason: "unknown_device" })]);
      expect(await t.run((ctx) => ctx.db.query("devices").collect())).toHaveLength(0);
    });
  });

  test("a decommissioned device is rejected as inactive_device, distinct from unknown_device, and no telemetry is written for it", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t, { lifecycle: "decommissioned" });
      const res = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      const body = await res.json();
      expect(body.rejected).toEqual([expect.objectContaining({ reason: "inactive_device" })]);
      expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
    });
  });
});

describe("rejection records (R13)", () => {
  test("a batch with one instance of every rejection reason records every rejection, and stored + rejected === submitted", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t, { externalId: "active-device" });
      await seedDevice(t, { externalId: "inactive-device", lifecycle: "decommissioned" });

      const readings = [
        { ts: 1, metric: "m", value: 1 }, // missing_field
        { externalId: "x", ts: 1, metric: "m", value: 1, extra: 1 }, // unexpected_field
        { externalId: "x", ts: "bad", metric: "m", value: 1 }, // wrong_type
        { externalId: "x", ts: Date.now() + 999_999_999, metric: "m", value: 1 }, // timestamp_too_far_future
        { externalId: "x", ts: 1, metric: "m", value: 1 }, // timestamp_too_old (ts=1 is ancient)
        { externalId: "x", ts: Date.now(), metric: "m", value: "__NON_FINITE__" }, // value_not_finite (see below)
        { externalId: "x".repeat(200), ts: Date.now(), metric: "m", value: 1 }, // external_id_too_long
        { externalId: "x", ts: Date.now(), metric: "m".repeat(100), value: 1 }, // metric_too_long
        { externalId: "x", ts: Date.now(), metric: "m", value: "v".repeat(600) }, // string_value_too_long
        { externalId: "never-registered", ts: Date.now(), metric: "m", value: 1 }, // unknown_device
        { externalId: "inactive-device", ts: Date.now(), metric: "m", value: 1 }, // inactive_device
        { externalId: "active-device", ts: Date.now(), metric: "m", value: 1 }, // accepted
      ];
      // JSON has no Infinity/NaN literal (JSON.stringify(NaN) silently
      // becomes `null`); a "__NON_FINITE__" placeholder is stringified with
      // the rest of the batch, then swapped for the oversized numeric
      // literal `1e400` (which JSON.parse turns into Infinity) in the raw
      // request text — see the dedicated "non-finite numeric value" test
      // above for why this is what a real non-finite value looks like
      // on the wire.
      const rawBody = JSON.stringify(readingsBatch(readings)).replace('"__NON_FINITE__"', "1e400");
      const res = await post(t, rawBody, `Bearer ${TOKEN}`);
      const body = await res.json();

      expect(body.submitted).toBe(readings.length);
      expect(body.stored + body.rejected.length).toBe(readings.length);
      expect(body.stored).toBe(1);
      expect(body.rejected).toHaveLength(readings.length - 1);

      const rejectionRows = await t.run((ctx) => ctx.db.query("ingestRejections").collect());
      expect(rejectionRows).toHaveLength(readings.length - 1);
      const reasons = new Set(rejectionRows.map((r) => r.reason));
      expect(reasons).toEqual(
        new Set([
          "missing_field",
          "unexpected_field",
          "wrong_type",
          "timestamp_too_far_future",
          "timestamp_too_old",
          "value_not_finite",
          "external_id_too_long",
          "metric_too_long",
          "string_value_too_long",
          "unknown_device",
          "inactive_device",
        ]),
      );
      // Every rejection row is attributable: reason, batch position, source, time.
      for (const row of rejectionRows) {
        expect(row.sourceId).toBe(SOURCE_ID);
        expect(typeof row.index).toBe("number");
        expect(typeof row.ts).toBe("number");
      }
    });
  });
});

describe("partial success (R14, R15)", () => {
  test("one malformed reading among three devices still stores the other two, with their live values updated", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const d1 = await seedDevice(t, { externalId: "d1" });
      const d2 = await seedDevice(t, { externalId: "d2" });
      const d3 = await seedDevice(t, { externalId: "d3" });
      const now = Date.now();
      const res = await post(
        t,
        readingsBatch([
          { externalId: "d1", ts: now, metric: "temperature_c", value: 10 },
          { externalId: "d2", ts: now, metric: "temperature_c", value: true }, // malformed
          { externalId: "d3", ts: now, metric: "temperature_c", value: 30 },
        ]),
        `Bearer ${TOKEN}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ outcome: "accepted", submitted: 3, stored: 2 });
      expect(body.rejected).toEqual([expect.objectContaining({ index: 1, reason: "wrong_type" })]);

      const { as } = await createUserFixture(t, "viewer");
      expect((await as.query(api.telemetry.latestForDevice, { deviceId: d1 }))[0]?.value).toBe(10);
      expect(await as.query(api.telemetry.latestForDevice, { deviceId: d2 })).toHaveLength(0);
      expect((await as.query(api.telemetry.latestForDevice, { deviceId: d3 }))[0]?.value).toBe(30);
    });
  });
});

describe("request-level failures (R16, R18)", () => {
  test("unparseable JSON is a 400 malformed_payload and writes nothing", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const res = await post(t, "{not valid json", `Bearer ${TOKEN}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ outcome: "error", category: "malformed_payload" });
      expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
    });
  });

  test("a body with no readings array is a 400 malformed_payload", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const res = await post(t, {}, `Bearer ${TOKEN}`);
      expect(res.status).toBe(400);
      expect((await res.json()).category).toBe("malformed_payload");
    });
  });

  test("an empty readings array is rejected as malformed_payload rather than a vacuous 200", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const res = await post(t, readingsBatch([]), `Bearer ${TOKEN}`);
      expect(res.status).toBe(400);
      expect((await res.json()).category).toBe("malformed_payload");
    });
  });

  test("a batch one reading over the configured maximum is refused as batch_too_large; exactly at the limit succeeds (R18)", async () => {
    await withEnv({ INGEST_TOKENS: TOKEN, INGEST_MAX_READINGS_PER_BATCH: "2" }, async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const reading = { externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 };

      const atLimit = await post(t, readingsBatch([reading, reading]), `Bearer ${TOKEN}`);
      expect(atLimit.status).toBe(200);

      const overLimit = await post(t, readingsBatch([reading, reading, reading]), `Bearer ${TOKEN}`);
      expect(overLimit.status).toBe(413);
      expect((await overLimit.json()).category).toBe("batch_too_large");
    });
  });

  test("a request over the payload-size limit is refused as payload_too_large, unaffected by batch-size config", async () => {
    await withEnv({ INGEST_TOKENS: TOKEN, INGEST_MAX_PAYLOAD_BYTES: "50" }, async () => {
      const t = convexTest(schema, modules);
      await seedDevice(t);
      const res = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "temperature_c", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      expect(res.status).toBe(413);
      expect((await res.json()).category).toBe("payload_too_large");
    });
  });
});

describe("durability (R17)", () => {
  test("after a 200 response, a fresh read returns the accepted readings", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const deviceId = await seedDevice(t);
      const res = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "cycle_count", value: 7 }]),
        `Bearer ${TOKEN}`,
      );
      expect(res.status).toBe(200);
      const { as } = await createUserFixture(t, "viewer");
      const latest = await as.query(api.telemetry.latestForDevice, { deviceId });
      expect(latest[0]?.value).toBe(7);
    });
  });
});

describe("freshness monotonicity (R19, R20)", () => {
  test("a device whose every reading is rejected is left completely unchanged", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const deviceId = await seedDevice(t, { status: "offline", lastSeenAt: 1000 });
      await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: Date.now(), metric: "m", value: true }]),
        `Bearer ${TOKEN}`,
      );
      const device = await t.run((ctx) => ctx.db.get(deviceId));
      expect(device?.status).toBe("offline");
      expect(device?.lastSeenAt).toBe(1000);
    });
  });

  test("a device with accepted readings is updated once, to the max accepted timestamp, not once per reading", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const deviceId = await seedDevice(t, { lastSeenAt: 1000 });
      const now = Date.now();
      await post(
        t,
        readingsBatch([
          { externalId: "sim-1", ts: now, metric: "a", value: 1 },
          { externalId: "sim-1", ts: now + 5, metric: "b", value: 2 },
          { externalId: "sim-1", ts: now - 5, metric: "c", value: 3 },
        ]),
        `Bearer ${TOKEN}`,
      );
      const device = await t.run((ctx) => ctx.db.get(deviceId));
      expect(device?.status).toBe("online");
      expect(device?.lastSeenAt).toBe(now + 5);
    });
  });

  test("an accepted reading older than the device's current lastSeenAt stores telemetry but does not regress freshness (R20)", async () => {
    await withToken(async () => {
      const t = convexTest(schema, modules);
      const now = Date.now();
      const deviceId = await seedDevice(t, { status: "online", lastSeenAt: now });
      const res = await post(
        t,
        readingsBatch([{ externalId: "sim-1", ts: now - 10_000, metric: "m", value: 1 }]),
        `Bearer ${TOKEN}`,
      );
      expect((await res.json()).stored).toBe(1);
      const device = await t.run((ctx) => ctx.db.get(deviceId));
      expect(device?.lastSeenAt).toBe(now);
      expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(1);
    });
  });
});

describe("rate limiting (R21, R22, R23)", () => {
  test("a sender exceeding the configured request rate is throttled with a distinct, retryable outcome, writing nothing", async () => {
    await withEnv(
      { INGEST_TOKENS: TOKEN, INGEST_REQUEST_BURST: "1", INGEST_REQUESTS_PER_MINUTE: "1" },
      async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const reading = { externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 };

        const first = await post(t, readingsBatch([reading]), `Bearer ${TOKEN}`);
        expect(first.status).toBe(200);

        const second = await post(t, readingsBatch([reading]), `Bearer ${TOKEN}`);
        expect(second.status).toBe(429);
        const body = await second.json();
        expect(body.category).toBe("rate_limited");
        expect(typeof body.retryAfterMs).toBe("number");
        expect(second.headers.get("Retry-After")).not.toBeNull();

        // Only the first request's reading was stored.
        expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(1);
      },
    );
  });

  test("a batch whose reading count exceeds the reading-burst capacity is refused as batch_too_large, not a hopeless rate_limited promise", async () => {
    // Regression test for a real bug: INGEST_READING_BURST configured below
    // a batch's reading count made every such request permanently denied
    // (a token bucket's capacity is a hard ceiling — no wait ever satisfies
    // cost > capacity), yet the old response still promised a finite
    // retryAfterMs. ingestHttp.ts now catches this before ever calling the
    // rate limiter.
    await withEnv(
      { INGEST_TOKENS: TOKEN, INGEST_READING_BURST: "2", INGEST_READINGS_PER_MINUTE: "2" },
      async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const reading = { externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 };
        const res = await post(t, readingsBatch([reading, reading, reading]), `Bearer ${TOKEN}`);
        expect(res.status).toBe(413);
        expect((await res.json()).category).toBe("batch_too_large");
        expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(0);
      },
    );
  });

  test("a burst within the configured allowance is never throttled", async () => {
    await withEnv(
      { INGEST_TOKENS: TOKEN, INGEST_REQUEST_BURST: "5", INGEST_REQUESTS_PER_MINUTE: "60" },
      async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const reading = { externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 };
        for (let i = 0; i < 5; i++) {
          const res = await post(t, readingsBatch([reading]), `Bearer ${TOKEN}`);
          expect(res.status).toBe(200);
        }
      },
    );
  });

  test("a reading-count burst is enforced independently of the request burst", async () => {
    // Request burst is generous (10) so it's never the bottleneck; the
    // reading-rate bucket (capacity 3) is what throttles the second request.
    // Each request's cost (2) stays <= capacity (3) throughout, so this
    // exercises the real rate limiter rather than the cost > capacity guard
    // tested separately above.
    await withEnv(
      {
        INGEST_TOKENS: TOKEN,
        INGEST_REQUEST_BURST: "10",
        INGEST_REQUESTS_PER_MINUTE: "600",
        INGEST_READING_BURST: "3",
        INGEST_READINGS_PER_MINUTE: "3",
      },
      async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const reading = { externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 };

        const first = await post(t, readingsBatch([reading, reading]), `Bearer ${TOKEN}`);
        expect(first.status).toBe(200); // consumes 2 of 3 tokens

        const second = await post(t, readingsBatch([reading, reading]), `Bearer ${TOKEN}`);
        expect(second.status).toBe(429); // only 1 token left, cost is 2
        expect((await second.json()).category).toBe("rate_limited");

        expect(await t.run((ctx) => ctx.db.query("telemetry").collect())).toHaveLength(2);
      },
    );
  });

  test("saturating one source's limit leaves a different source's batches accepted (R23)", async () => {
    const tokenA = "src-a.secretA";
    const tokenB = "src-b.secretB";
    await withEnv(
      {
        INGEST_TOKENS: `${tokenA},${tokenB}`,
        INGEST_REQUEST_BURST: "1",
        INGEST_REQUESTS_PER_MINUTE: "1",
      },
      async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const reading = { externalId: "sim-1", ts: Date.now(), metric: "m", value: 1 };

        expect((await post(t, readingsBatch([reading]), `Bearer ${tokenA}`)).status).toBe(200);
        expect((await post(t, readingsBatch([reading]), `Bearer ${tokenA}`)).status).toBe(429);
        // Source B's own allowance is untouched by source A's saturation.
        expect((await post(t, readingsBatch([reading]), `Bearer ${tokenB}`)).status).toBe(200);
      },
    );
  });
});

describe("observability (R25)", () => {
  test("after a mixed run, accepted/rejected/credential-failed/throttled counts are all retrievable", async () => {
    await withEnv(
      { INGEST_TOKENS: TOKEN, INGEST_REQUEST_BURST: "2", INGEST_REQUESTS_PER_MINUTE: "2" },
      async () => {
        const t = convexTest(schema, modules);
        await seedDevice(t);
        const now = Date.now();

        // 1 accepted, 1 rejected (unknown_device), in the same request.
        await post(
          t,
          readingsBatch([
            { externalId: "sim-1", ts: now, metric: "m", value: 1 },
            { externalId: "no-such-device", ts: now, metric: "m", value: 1 },
          ]),
          `Bearer ${TOKEN}`,
        );
        // 1 credential failure.
        await post(t, readingsBatch([{ externalId: "sim-1", ts: now, metric: "m", value: 1 }]), "Bearer wrong");
        // 1 throttled request (burst of 2 already spent: 1 above + this one).
        await post(t, readingsBatch([{ externalId: "sim-1", ts: now, metric: "m", value: 1 }]), `Bearer ${TOKEN}`);
        const throttled = await post(
          t,
          readingsBatch([{ externalId: "sim-1", ts: now, metric: "m", value: 1 }]),
          `Bearer ${TOKEN}`,
        );
        expect(throttled.status).toBe(429);

        const summary = await t.query(internal.ingestStats.summary, { fromTs: 0, toTs: Date.now() + 1 });
        expect(summary.readingsAccepted).toBeGreaterThanOrEqual(2);
        expect(summary.readingsRejected).toBeGreaterThanOrEqual(1);
        expect(summary.rejectedByReason.unknown_device).toBeGreaterThanOrEqual(1);
        expect(summary.requestsCredentialFailed).toBe(1);
        expect(summary.requestsRateLimited).toBe(1);

        const drilldown = await t.query(internal.ingestStats.rejectionsByReason, {
          reason: "unknown_device",
          fromTs: 0,
          toTs: Date.now() + 1,
        });
        expect(drilldown.length).toBeGreaterThanOrEqual(1);
        expect(drilldown[0]).toMatchObject({ reason: "unknown_device", externalId: "no-such-device" });
      },
    );
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
      sourceId: "test",
      batchId: "test-batch",
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

    // A realistic "now" timestamp, not a historical constant: our hardened
    // recordBatch enforces R9's backfill-age window (default 7 days), which
    // the pre-merge minimal recordBatch this test block was originally
    // written against did not.
    const ts = Date.now();
    await t.mutation(internal.ingest.recordBatch, {
      sourceId: "test",
      batchId: "test-batch",
      readings: [{ externalId: "live-01", ts, metric: "temp", value: 42 }],
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.status).toBe("online");
    expect(device?.lastSeenAt).toBe(ts);

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
      sourceId: "test",
      batchId: "test-batch",
      readings: [{ externalId: "dead-01", ts: Date.now(), metric: "t", value: 1 }],
    });
    await admin.mutation(api.devices.decommission, { deviceId });
    const before = await admin.query(api.devices.get, { deviceId });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await t.mutation(internal.ingest.recordBatch, {
      sourceId: "test",
      batchId: "test-batch",
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
    vi.useRealTimers();
  });

  test("a differently-cased/whitespace externalId still resolves to the registered device (R20)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "case-01",
      name: "Case",
      type: "agv",
    });

    // A realistic "now" timestamp — see the R2 test above for why.
    const ts = Date.now();
    await t.mutation(internal.ingest.recordBatch, {
      sourceId: "test",
      batchId: "test-batch",
      readings: [{ externalId: " CASE-01 ", ts, metric: "t", value: 1 }],
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.status).toBe("online");
    expect(device?.lastSeenAt).toBe(ts);
  });
});
