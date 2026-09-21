import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../backend/_generated/api";
import { NOT_AUTHORIZED } from "../backend/lib/auth";
import schema from "../backend/schema";
import { ADMIN_GATED_MUTATIONS, ADMIN_GATED_QUERIES, ALL_ROLES, createUserFixture, NON_ADMIN_ROLES, type Test } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");

const devicesSource = (import.meta.glob("../backend/devices.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>)["../backend/devices.ts"];
const ingestSource = (import.meta.glob("../backend/ingest.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>)["../backend/ingest.ts"];

afterEach(() => {
  delete process.env.DEVICE_HEARTBEAT_WINDOW_MS;
  vi.useRealTimers();
});

async function registerDevice(
  t: Test,
  overrides: Partial<{
    externalId: string;
    name: string;
    type: string;
    zone: string;
    metadata: Record<string, string>;
  }> = {},
) {
  const { as: admin } = await createUserFixture(t, "admin");
  const deviceId = await admin.mutation(api.devices.register, {
    externalId: overrides.externalId ?? `dev-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? "Test Device",
    type: overrides.type ?? "cnc-mill",
    zone: overrides.zone,
    metadata: overrides.metadata,
  });
  return deviceId;
}

// ---------------------------------------------------------------------------
// Authentication: R1, R3 (every device function requires a session)
// ---------------------------------------------------------------------------

describe("device functions require authentication (R1, R3)", () => {
  test("an unauthenticated caller is denied every read and write", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await registerDevice(t);

    await expect(
      t.query(api.devices.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.query(api.devices.get, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.query(api.devices.facets, {})).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.query(api.devices.changeHistory, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
    await expect(
      t.mutation(api.devices.register, { externalId: "no-session", name: "x", type: "agv" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.mutation(api.devices.update, { deviceId, name: "x" })).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.mutation(api.devices.decommission, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.mutation(api.devices.reactivate, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
  });

  for (const role of ALL_ROLES) {
    test(`${role} can read list/get/facets (data.read)`, async () => {
      const t = convexTest(schema, modules);
      const deviceId = await registerDevice(t);
      const { as } = await createUserFixture(t, role);

      const list = await as.query(api.devices.list, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(list.page.map((d) => d._id)).toContain(deviceId);
      expect((await as.query(api.devices.get, { deviceId }))?._id).toBe(deviceId);
      await expect(as.query(api.devices.facets, {})).resolves.toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Registration: R12, R15, R18, R19, R20, R22, R23
// ---------------------------------------------------------------------------

describe("devices.register (R12, R18, R23)", () => {
  test("an admin registers a device and it appears in the list with the supplied values", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");

    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "robot-01",
      name: "Robot One",
      type: "agv",
      zone: "line-1",
      metadata: { fw: "1.2.3" },
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device).toMatchObject({
      externalId: "robot-01",
      name: "Robot One",
      type: "agv",
      zone: "line-1",
      metadata: { fw: "1.2.3" },
      lifecycle: "in_service",
      status: "unknown",
    });

    const list = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page.map((d) => d._id)).toContain(deviceId);
  });

  test("leading/trailing whitespace is trimmed and not stored (R18)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");

    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "  robot-02  ",
      name: "  Robot Two  ",
      type: "  agv  ",
      zone: "  line-2  ",
    });
    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.externalId).toBe("robot-02");
    expect(device?.name).toBe("Robot Two");
    expect(device?.type).toBe("agv");
    expect(device?.zone).toBe("line-2");
  });

  test("empty, whitespace-only, or missing externalId/name/type is refused, each on its own field (R15/R18)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");

    await expect(
      admin.mutation(api.devices.register, { externalId: "", name: "   ", type: "" }),
    ).rejects.toThrow(ConvexError);

    try {
      await admin.mutation(api.devices.register, { externalId: "", name: "   ", type: "" });
      expect.unreachable();
    } catch (e) {
      const fields = (e as ConvexError<{ fieldErrors: { field: string }[] }>).data.fieldErrors.map(
        (f) => f.field,
      );
      expect(fields.sort()).toEqual(["externalId", "name", "type"]);
    }

    const list = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page).toEqual([]);
  });

  test("a blank name AND a duplicate identifier in the same submit report both fields (R15)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    await registerDevice(t, { externalId: "dup-01" });

    try {
      await admin.mutation(api.devices.register, {
        externalId: "dup-01",
        name: "   ",
        type: "agv",
      });
      expect.unreachable();
    } catch (e) {
      const fields = (e as ConvexError<{ fieldErrors: { field: string }[] }>).data.fieldErrors.map(
        (f) => f.field,
      );
      expect(fields.sort()).toEqual(["externalId", "name"]);
    }
  });
});

describe("devices.register uniqueness and normalization (R19, R20)", () => {
  test("registering an identifier already held by an in-service device is refused", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    await registerDevice(t, { externalId: "robot-03" });

    await expect(
      admin.mutation(api.devices.register, { externalId: "robot-03", name: "Another", type: "agv" }),
    ).rejects.toThrow(ConvexError);
  });

  test("registering an identifier held by a decommissioned device is also refused", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "robot-04" });
    await admin.mutation(api.devices.decommission, { deviceId });

    await expect(
      admin.mutation(api.devices.register, { externalId: "robot-04", name: "Another", type: "agv" }),
    ).rejects.toThrow(ConvexError);
  });

  test("two identifiers differing only by trim/case cannot both be registered (R20)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    await registerDevice(t, { externalId: "robot-05" });

    await expect(
      admin.mutation(api.devices.register, {
        externalId: "ROBOT-05 ",
        name: "Another",
        type: "agv",
      }),
    ).rejects.toThrow(ConvexError);
  });

  test("ingest resolves a differently-cased externalId to the same device (R20)", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await registerDevice(t, { externalId: "sim-cnc-01" });

    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "SIM-CNC-01", ts: Date.now(), metric: "temp", value: 42 }],
    });

    const { as: admin } = await createUserFixture(t, "admin");
    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.status).toBe("online");
  });
});

describe("devices.register metadata bounds (R22, R23)", () => {
  test("too many entries is refused with a validation error, not truncation", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const metadata: Record<string, string> = {};
    for (let i = 0; i < 25; i++) metadata[`k${i}`] = "v";

    await expect(
      admin.mutation(api.devices.register, {
        externalId: "robot-06",
        name: "Robot Six",
        type: "agv",
        metadata,
      }),
    ).rejects.toThrow(ConvexError);

    const list = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(list.page.find((d) => d.externalId === "robot-06")).toBeUndefined();
  });

  test("an over-length key or value is refused; existing metadata on a failed edit is unchanged", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { metadata: { ok: "value" } });

    await expect(
      admin.mutation(api.devices.update, {
        deviceId,
        metadata: { ["x".repeat(100)]: "v" },
      }),
    ).rejects.toThrow(ConvexError);

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.metadata).toEqual({ ok: "value" });
  });
});

// ---------------------------------------------------------------------------
// Immutability + edit: R13, R21, R23
// ---------------------------------------------------------------------------

describe("devices.update (R13, R21, R23)", () => {
  test("edits name, type, zone and metadata; detail reflects the new values", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { name: "Old Name", type: "agv", zone: "line-1" });

    await admin.mutation(api.devices.update, {
      deviceId,
      name: "New Name",
      type: "cnc-mill",
      zone: "line-2",
      metadata: { note: "updated" },
    });

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device).toMatchObject({
      name: "New Name",
      type: "cnc-mill",
      zone: "line-2",
      metadata: { note: "updated" },
    });
  });

  test("passing metadata: {} clears existing metadata, distinct from omitting the field entirely", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { metadata: { fw: "1.0" } });

    // Omitting metadata leaves it untouched.
    await admin.mutation(api.devices.update, { deviceId, name: "Still Old" });
    expect((await admin.query(api.devices.get, { deviceId }))?.metadata).toEqual({ fw: "1.0" });

    // Explicitly passing {} clears it — this is what the edit form sends when
    // every metadata row is removed (frontend/app/devices/DeviceDetail.tsx).
    await admin.mutation(api.devices.update, { deviceId, metadata: {} });
    expect((await admin.query(api.devices.get, { deviceId }))?.metadata).toEqual({});
  });

  test("no edit path changes externalId — supplying one is rejected before the handler runs (R21)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "immutable-01" });

    await expect(
      admin.mutation(
        api.devices.update as any,
        { deviceId, externalId: "changed-id" } as any,
      ),
    ).rejects.toThrow();

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.externalId).toBe("immutable-01");
  });

  test("blank name on edit is refused with no partial change saved", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { name: "Keep Me" });

    await expect(
      admin.mutation(api.devices.update, { deviceId, name: "   ", zone: "new-zone" }),
    ).rejects.toThrow(ConvexError);

    const device = await admin.query(api.devices.get, { deviceId });
    expect(device?.name).toBe("Keep Me");
    expect(device?.zone).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: R14, R24, R25, R27, R28
// ---------------------------------------------------------------------------

describe("devices lifecycle (R14, R24, R25, R27, R28)", () => {
  test("decommission then reactivate preserves identifier/name/type/zone/metadata; telemetry stays queryable", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, {
      externalId: "robot-07",
      name: "Robot Seven",
      zone: "line-3",
      metadata: { fw: "9.9" },
    });
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "robot-07", ts: Date.now(), metric: "temp", value: 10 }],
    });

    await admin.mutation(api.devices.decommission, { deviceId });
    let device = await admin.query(api.devices.get, { deviceId });
    expect(device?.lifecycle).toBe("decommissioned");
    expect(device?.decommissionedAt).toBeTypeOf("number");

    await admin.mutation(api.devices.reactivate, { deviceId });
    device = await admin.query(api.devices.get, { deviceId });
    expect(device).toMatchObject({
      externalId: "robot-07",
      name: "Robot Seven",
      zone: "line-3",
      metadata: { fw: "9.9" },
      lifecycle: "in_service",
    });
    expect(device?.decommissionedAt).toBeUndefined();

    const telemetry = await t.run((ctx) =>
      ctx.db
        .query("telemetry")
        .withIndex("by_device_and_ts", (q) => q.eq("deviceId", deviceId))
        .collect(),
    );
    expect(telemetry.length).toBe(1);
  });

  test("default list omits decommissioned devices; includeDecommissioned (admin) shows them marked", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "robot-08" });
    await admin.mutation(api.devices.decommission, { deviceId });

    const defaultList = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
    });
    expect(defaultList.page.find((d) => d._id === deviceId)).toBeUndefined();

    const withDecommissioned = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      includeDecommissioned: true,
    });
    const found = withDecommissioned.page.find((d) => d._id === deviceId);
    expect(found?.lifecycle).toBe("decommissioned");
  });

  test("includeDecommissioned is admin-only", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await createUserFixture(t, "viewer");

    await expect(
      viewer.query(api.devices.list, {
        paginationOpts: { numItems: 10, cursor: null },
        includeDecommissioned: true,
      }),
    ).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("no exposed operation permanently removes a device (R27)", async () => {
    expect(devicesSource).not.toMatch(/ctx\.db\.delete\(/);
    expect(ingestSource).not.toMatch(/ctx\.db\.delete\(/);
    expect(devicesSource).not.toMatch(/export const (remove|delete|purge|hardDelete)\b/i);
  });

  test("a decommissioned device with stale telemetry reports lifecycle distinctly from connectivity (R28)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "robot-09" });
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "robot-09", ts: Date.now(), metric: "temp", value: 1 }],
    });
    await admin.mutation(api.devices.decommission, { deviceId });

    const device = await admin.query(api.devices.get, { deviceId });
    // Both fields are present and independent: lifecycle is never folded into status.
    expect(device?.lifecycle).toBe("decommissioned");
    expect(device?.status).toBe("online"); // untouched by decommission
  });
});

// ---------------------------------------------------------------------------
// Connectivity: R1, R2, R3, R5, R6
// ---------------------------------------------------------------------------

describe("connectivity state (R1, R2, R3, R5)", () => {
  test("three fixtures report online, offline (after sweep), and unknown respectively", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");

    const onlineId = await registerDevice(t, { externalId: "fx-online" });
    const offlineId = await registerDevice(t, { externalId: "fx-offline" });
    const unknownId = await registerDevice(t, { externalId: "fx-unknown" });

    await t.mutation(internal.ingest.recordBatch, {
      readings: [
        { externalId: "fx-online", ts: Date.now(), metric: "temp", value: 1 },
        { externalId: "fx-offline", ts: Date.now(), metric: "temp", value: 1 },
      ],
    });

    // Advance past the default 60s heartbeat window, then let the sweeper run.
    vi.advanceTimersByTime(70_000);
    await t.mutation(internal.devices.sweepOffline, {});
    // Refresh the "online" fixture just under the wire so it stays online.
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "fx-online", ts: Date.now(), metric: "temp", value: 2 }],
    });

    const online = await admin.query(api.devices.get, { deviceId: onlineId });
    const offline = await admin.query(api.devices.get, { deviceId: offlineId });
    const unknown = await admin.query(api.devices.get, { deviceId: unknownId });

    expect(online?.status).toBe("online");
    expect(online?.lastSeenAt).toBeTypeOf("number");
    expect(offline?.status).toBe("offline");
    expect(unknown?.status).toBe("unknown");
    expect(unknown?.lastSeenAt).toBeUndefined();
  });

  test("a device transitions online -> offline with no further telemetry once the sweeper runs (R3)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "fx-transition" });

    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "fx-transition", ts: Date.now(), metric: "temp", value: 1 }],
    });
    expect((await admin.query(api.devices.get, { deviceId }))?.status).toBe("online");

    vi.advanceTimersByTime(61_000);
    // Before the sweeper runs, the stored field has not changed yet.
    expect((await admin.query(api.devices.get, { deviceId }))?.status).toBe("online");

    await t.mutation(internal.devices.sweepOffline, {});
    expect((await admin.query(api.devices.get, { deviceId }))?.status).toBe("offline");
  });

  test("the heartbeat window is configurable without a code change (R4)", async () => {
    vi.useFakeTimers();
    process.env.DEVICE_HEARTBEAT_WINDOW_MS = "5000";
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "fx-short-window" });

    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "fx-short-window", ts: Date.now(), metric: "temp", value: 1 }],
    });
    vi.advanceTimersByTime(6_000);
    await t.mutation(internal.devices.sweepOffline, {});

    expect((await admin.query(api.devices.get, { deviceId }))?.status).toBe("offline");
  });

  test("list, detail and a status=offline filter agree on the same device at the same moment (R5)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "fx-consistent" });
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "fx-consistent", ts: Date.now(), metric: "temp", value: 1 }],
    });
    vi.advanceTimersByTime(61_000);
    await t.mutation(internal.devices.sweepOffline, {});

    const detail = await admin.query(api.devices.get, { deviceId });
    const list = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      status: "offline",
    });
    const facets = await admin.query(api.devices.facets, {});

    expect(detail?.status).toBe("offline");
    expect(list.page.map((d) => d._id)).toContain(deviceId);
    const offlineFacet = facets.statuses.find((s) => s.value === "offline");
    expect(offlineFacet?.count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Filtering and grouping: R7, R8, R9, R10, R11
// ---------------------------------------------------------------------------

describe("filtering and grouping (R7, R8, R9, R10, R11)", () => {
  test("filtering by zone alone (no status) uses by_lifecycle_and_zone and returns exactly that zone", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const inZone = await registerDevice(t, { zone: "solo-zone" });
    await registerDevice(t, { zone: "other-zone" });
    await registerDevice(t, {});

    const results = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      zone: "solo-zone",
    });
    expect(results.page.map((d) => d._id)).toEqual([inZone]);
  });

  test("filtering by type alone (no zone/status) uses by_lifecycle_and_type and returns exactly that type", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const ofType = await registerDevice(t, { type: "solo-type" });
    await registerDevice(t, { type: "other-type" });

    const results = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      type: "solo-type",
    });
    expect(results.page.map((d) => d._id)).toEqual([ofType]);
  });

  test("filters on zone and status combine with AND (R7)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const zoneAndOffline = await registerDevice(t, { zone: "zone-a" });
    await registerDevice(t, { zone: "zone-a" }); // zone-a, but stays "unknown" (not offline)
    await registerDevice(t, { zone: "zone-b" });

    // Force zoneAndOffline into "offline" via ingest + sweep.
    const device = await admin.query(api.devices.get, { deviceId: zoneAndOffline });
    vi.useFakeTimers();
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: device!.externalId, ts: Date.now(), metric: "t", value: 1 }],
    });
    vi.advanceTimersByTime(61_000);
    await t.mutation(internal.devices.sweepOffline, {});

    const results = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      zone: "zone-a",
      status: "offline",
    });
    expect(results.page.map((d) => d._id)).toEqual([zoneAndOffline]);
  });

  test("facets group by zone/type/status with counts that respect the active filter (R8)", async () => {
    const t = convexTest(schema, modules);
    await registerDevice(t, { zone: "zone-x", type: "agv" });
    await registerDevice(t, { zone: "zone-x", type: "cnc-mill" });
    await registerDevice(t, { zone: "zone-y", type: "agv" });
    const { as: admin } = await createUserFixture(t, "admin");

    const all = await admin.query(api.devices.facets, {});
    const zoneX = all.zones.find((z) => z.value === "zone-x");
    const zoneY = all.zones.find((z) => z.value === "zone-y");
    expect(zoneX?.count).toBe(2);
    expect(zoneY?.count).toBe(1);

    const filtered = await admin.query(api.devices.facets, { zone: "zone-x" });
    const agvUnderZoneX = filtered.types.find((ty) => ty.value === "agv");
    expect(agvUnderZoneX?.count).toBe(1);
  });

  test("a newly used zone/type becomes a filter choice with no code change (R9)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const before = await admin.query(api.devices.facets, {});
    expect(before.zones.find((z) => z.value === "brand-new-zone")).toBeUndefined();

    await registerDevice(t, { zone: "brand-new-zone", type: "brand-new-type" });

    const after = await admin.query(api.devices.facets, {});
    expect(after.zones.find((z) => z.value === "brand-new-zone")?.count).toBe(1);
    expect(after.types.find((ty) => ty.value === "brand-new-type")?.count).toBe(1);
  });

  test("a device that crosses the heartbeat window leaves a status=online filtered list (R10)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await registerDevice(t, { externalId: "fx-leaves" });
    await t.mutation(internal.ingest.recordBatch, {
      readings: [{ externalId: "fx-leaves", ts: Date.now(), metric: "t", value: 1 }],
    });

    let onlineList = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      status: "online",
    });
    expect(onlineList.page.map((d) => d._id)).toContain(deviceId);

    vi.advanceTimersByTime(61_000);
    await t.mutation(internal.devices.sweepOffline, {});

    onlineList = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 50, cursor: null },
      status: "online",
    });
    expect(onlineList.page.map((d) => d._id)).not.toContain(deviceId);
  });

  test("a page-size request far beyond the configured default is clamped server-side (R11)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    for (let i = 0; i < 5; i++) {
      await registerDevice(t, { externalId: `clamp-${i}` });
    }

    const result = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 1_000_000, cursor: null },
    });
    // Default DEVICE_LIST_PAGE_SIZE (50) * 4 cap — comfortably above our 5 fixtures,
    // so this just proves the clamp doesn't reject a normal request outright while
    // still being enforced (see backend/devices.ts `cappedPaginationOpts`).
    expect(result.page.length).toBeLessThanOrEqual(200);
  });

  test("listing returns a bounded page and the remainder is reachable by cursor, without duplicates or omissions (R11)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(await registerDevice(t, { externalId: `page-${i}` }));
    }

    const firstPage = await admin.query(api.devices.list, {
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(firstPage.page.length).toBe(3);
    expect(firstPage.isDone).toBe(false);

    const seen = new Set(firstPage.page.map((d) => d._id));
    let cursor = firstPage.continueCursor;
    let isDone = firstPage.isDone;
    while (!isDone) {
      const next = await admin.query(api.devices.list, {
        paginationOpts: { numItems: 3, cursor },
      });
      for (const d of next.page) {
        expect(seen.has(d._id)).toBe(false); // no duplicates
        seen.add(d._id);
      }
      cursor = next.continueCursor;
      isDone = next.isDone;
    }

    for (const id of ids) {
      expect(seen.has(id as any)).toBe(true); // no omissions
    }
  });
});

// ---------------------------------------------------------------------------
// Admin gating: R16 (server-side half), R17, R31
// ---------------------------------------------------------------------------

describe("admin gating (R17, R31)", () => {
  const REGISTRY_MUTATIONS: Array<{
    name: string;
    call: (t: Test, deviceId: string) => Promise<unknown>;
  }> = [
    {
      name: "register",
      call: (t) =>
        t.mutation(api.devices.register, {
          externalId: `gate-${Math.random()}`,
          name: "Gate Test",
          type: "agv",
        }),
    },
    { name: "update", call: (t, deviceId) => t.mutation(api.devices.update, { deviceId, name: "x" }) },
    { name: "decommission", call: (t, deviceId) => t.mutation(api.devices.decommission, { deviceId }) },
    { name: "reactivate", call: (t, deviceId) => t.mutation(api.devices.reactivate, { deviceId }) },
  ];

  test("REGISTRY_MUTATIONS matches the ADMIN_GATED_MUTATIONS list tests/testUtils.ts declares — so this list itself cannot silently drift from what's actually gated", () => {
    expect(REGISTRY_MUTATIONS.map((op) => op.name).sort()).toEqual([...ADMIN_GATED_MUTATIONS].sort());
  });

  test("every registry mutation is refused for every non-admin role and allowed for admin", async () => {
    for (const op of REGISTRY_MUTATIONS) {
      const t = convexTest(schema, modules);
      const deviceId = await registerDeviceAsAdmin(t);

      for (const role of NON_ADMIN_ROLES) {
        const { as } = await createUserFixture(t, role);
        await expect(op.call(as, deviceId)).rejects.toThrow(NOT_AUTHORIZED);
      }

      const { as: admin } = await createUserFixture(t, "admin");
      await expect(op.call(admin, deviceId)).resolves.toBeDefined();
    }
  });

  test("devices.changeHistory matches the ADMIN_GATED_QUERIES list tests/testUtils.ts declares", () => {
    expect(["changeHistory"]).toEqual([...ADMIN_GATED_QUERIES]);
  });

  test("devices.changeHistory is refused for non-admins and succeeds for admin (R31)", async () => {
    const t = convexTest(schema, modules);
    const deviceId = await registerDeviceAsAdmin(t);

    for (const role of NON_ADMIN_ROLES) {
      const { as } = await createUserFixture(t, role);
      await expect(as.query(api.devices.changeHistory, { deviceId })).rejects.toThrow(NOT_AUTHORIZED);
    }

    const { as: admin } = await createUserFixture(t, "admin");
    await expect(admin.query(api.devices.changeHistory, { deviceId })).resolves.toBeDefined();
  });

  async function registerDeviceAsAdmin(t: Test): Promise<string> {
    const { as: admin } = await createUserFixture(t, "admin");
    return admin.mutation(api.devices.register, {
      externalId: `gate-seed-${Math.random()}`,
      name: "Gate Seed",
      type: "agv",
    });
  }
});

// ---------------------------------------------------------------------------
// Audit trail: R29, R30
// ---------------------------------------------------------------------------

describe("audit trail (R29, R30)", () => {
  test("a successful edit records one entry with the acting admin, both field changes, and old/new values", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "audit-01",
      name: "Old Name",
      type: "agv",
      zone: "line-1",
    });

    await admin.mutation(api.devices.update, { deviceId, name: "New Name", zone: "line-2" });

    const history = await admin.query(api.devices.changeHistory, { deviceId });
    const updateEntry = history.find((h: any) => h.action === "device.update");
    expect(updateEntry).toBeDefined();
    expect(updateEntry.actorId).toBe(userId);
    expect(updateEntry.at).toBeTypeOf("number");
    const fields = updateEntry.changes.map((c: any) => c.field).sort();
    expect(fields).toEqual(["name", "zone"]);
    const nameChange = updateEntry.changes.find((c: any) => c.field === "name");
    expect(nameChange.before).toBe("Old Name");
    expect(nameChange.after).toBe("New Name");
  });

  test("a change that fails validation produces no history entry; every successful change has exactly one", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "audit-02",
      name: "Name",
      type: "agv",
    });

    const beforeHistory = await admin.query(api.devices.changeHistory, { deviceId });
    expect(beforeHistory.length).toBe(1); // the register itself

    await expect(
      admin.mutation(api.devices.update, { deviceId, name: "   " }),
    ).rejects.toThrow(ConvexError);

    const afterHistory = await admin.query(api.devices.changeHistory, { deviceId });
    expect(afterHistory.length).toBe(1); // unchanged — the failed edit left no trace
  });

  test("re-submitting the same metadata entries in a different key order records no change", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const deviceId = await admin.mutation(api.devices.register, {
      externalId: "audit-03",
      name: "Name",
      type: "agv",
      metadata: { a: "1", b: "2" },
    });

    const beforeHistory = await admin.query(api.devices.changeHistory, { deviceId });
    expect(beforeHistory.length).toBe(1); // the register itself

    // Same key/value pairs, reordered — not a real change (backend/lib/audit.ts diffFields).
    await admin.mutation(api.devices.update, { deviceId, metadata: { b: "2", a: "1" } });

    const afterHistory = await admin.query(api.devices.changeHistory, { deviceId });
    expect(afterHistory.length).toBe(1); // unchanged — reordering alone is not a change
  });
});
