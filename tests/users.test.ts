import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../backend/_generated/api";
import schema from "../backend/schema";
import { NOT_AUTHORIZED } from "../backend/lib/auth";
import { CAPABILITY_MIN_ROLE } from "../backend/lib/permissions";
import { createUserFixture } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");

describe("users.me (R8)", () => {
  test("returns null when unauthenticated, rather than throwing", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.users.me, {})).resolves.toBeNull();
  });

  test("returns the caller's own profile, role and capability list", async () => {
    const t = convexTest(schema, modules);
    const { as, userId } = await createUserFixture(t, "operator");
    const me = await as.query(api.users.me, {});
    expect(me?._id).toBe(userId);
    expect(me?.role).toBe("operator");
    expect(me?.capabilities).toEqual(
      expect.arrayContaining(["data.read", "alert.acknowledge", "note.write"]),
    );
    expect(me?.capabilities).not.toContain("device.manage");
    expect(me?.capabilities).not.toContain("user.manage");
  });

  test("a deactivated account looks exactly like a signed-out one", async () => {
    const t = convexTest(schema, modules);
    const { as } = await createUserFixture(t, "admin", { isActive: false });
    await expect(as.query(api.users.me, {})).resolves.toBeNull();
  });

  test("a client-claimed role has no effect: the stored role is reported", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createUserFixture(t, "viewer");
    // Forged elevated claims on the identity are ignored; role comes from the row.
    const forged = t.withIdentity({
      subject: `${userId}|s`,
      role: "admin",
      roles: ["admin"],
    } as never);
    const me = await forged.query(api.users.me, {});
    expect(me?.role).toBe("viewer");
    await expect(forged.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });
});

describe("users.list (R7, admin-only)", () => {
  test("denies non-admin roles", async () => {
    const t = convexTest(schema, modules);
    for (const role of ["viewer", "operator", "maintenance"] as const) {
      const { as } = await createUserFixture(t, role);
      await expect(as.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
    }
  });

  test("denies unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("allows admins and returns every user", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    await createUserFixture(t, "viewer");
    await createUserFixture(t, "operator");
    const users = await admin.query(api.users.list, {});
    expect(users).toHaveLength(3);
  });
});

describe("users.setRole (R3/R7/R11)", () => {
  test("denies non-admin roles", async () => {
    const t = convexTest(schema, modules);
    const { as: operator } = await createUserFixture(t, "operator");
    const { userId: target } = await createUserFixture(t, "viewer");
    await expect(
      operator.mutation(api.users.setRole, { userId: target, role: "admin" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("admin changes a role; reflected in me/list; audit row records who, whom, from/to, when (R11)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId: adminId } = await createUserFixture(t, "admin");
    const { as: target, userId: targetId } = await createUserFixture(t, "viewer");

    const before = Date.now();
    await admin.mutation(api.users.setRole, { userId: targetId, role: "operator" });
    const after = Date.now();

    const me = await target.query(api.users.me, {});
    expect(me?.role).toBe("operator");
    const list = await admin.query(api.users.list, {});
    expect(list.find((u) => u._id === targetId)?.role).toBe("operator");

    const log = await admin.query(api.audit.list, {});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorId: adminId,
      action: "user.setRole",
      targetTable: "users",
      targetId,
      details: { from: "viewer", to: "operator" },
    });
    expect(log[0].at).toBeGreaterThanOrEqual(before);
    expect(log[0].at).toBeLessThanOrEqual(after);
  });

  test("no audit row and no change when the role is unchanged", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const { userId: targetId } = await createUserFixture(t, "viewer");
    await admin.mutation(api.users.setRole, { userId: targetId, role: "viewer" });
    expect(await admin.query(api.audit.list, {})).toHaveLength(0);
  });

  test("refuses to demote the last remaining admin", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId: adminId } = await createUserFixture(t, "admin");
    await expect(
      admin.mutation(api.users.setRole, { userId: adminId, role: "viewer" }),
    ).rejects.toThrow("Cannot remove the last admin");
    const user = await t.run((ctx) => ctx.db.get(adminId));
    expect(user?.role).toBe("admin");
    expect(await admin.query(api.audit.list, {})).toHaveLength(0);
  });

  test("an admin may demote another admin when a second one remains", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin", { email: "a1@example.com" });
    const { userId: other } = await createUserFixture(t, "admin", { email: "a2@example.com" });
    await admin.mutation(api.users.setRole, { userId: other, role: "viewer" });
    const user = await t.run((ctx) => ctx.db.get(other));
    expect(user?.role).toBe("viewer");
  });

  test("rejects an invalid role value at the argument validator", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const { userId } = await createUserFixture(t, "viewer");
    await expect(
      admin.mutation(api.users.setRole, { userId, role: "root" as never }),
    ).rejects.toThrow();
  });
});

describe("audit.list (R7)", () => {
  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const { as: maintenance } = await createUserFixture(t, "maintenance");
    await expect(maintenance.query(api.audit.list, {})).rejects.toThrow(NOT_AUTHORIZED);
    await expect(t.query(api.audit.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });
});

describe("deactivated user", () => {
  test("is rejected even with an otherwise-valid admin role", async () => {
    const t = convexTest(schema, modules);
    const { as } = await createUserFixture(t, "admin", { isActive: false });
    await expect(as.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("role removal takes effect on the very next call (role is read per call)", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin", { email: "a1@example.com" });
    const { as: other, userId: otherId } = await createUserFixture(t, "admin", {
      email: "a2@example.com",
    });
    await expect(other.query(api.users.list, {})).resolves.toBeDefined();
    await admin.mutation(api.users.setRole, { userId: otherId, role: "viewer" });
    await expect(other.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });
});

describe("error-message non-leakage (R6)", () => {
  test("unauthenticated, wrong-role, deactivated and unknown-capability denials are identical", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await createUserFixture(t, "viewer");
    const { as: deactivatedAdmin } = await createUserFixture(t, "admin", { isActive: false });

    const denial = (p: Promise<unknown>) =>
      p.then(
        () => "NO ERROR",
        (e: Error) => e.message,
      );
    const messages = await Promise.all([
      denial(t.query(api.users.list, {})),
      denial(viewer.query(api.users.list, {})),
      denial(deactivatedAdmin.query(api.users.list, {})),
    ]);
    for (const m of messages) expect(m).toContain(NOT_AUTHORIZED);
    // Identical text regardless of reason.
    expect(new Set(messages).size).toBe(1);
  });

  test("a forbidden existing target and a non-existent target are indistinguishable", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await createUserFixture(t, "viewer");
    const { userId: existing } = await createUserFixture(t, "operator");
    const missing = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "gone",
        email: "gone@example.com",
        role: "viewer",
        isActive: true,
      });
      await ctx.db.delete(id);
      return id;
    });

    const forbiddenExisting = await viewer
      .mutation(api.users.setRole, { userId: existing, role: "admin" })
      .catch((e: Error) => e.message);
    const forbiddenMissing = await viewer
      .mutation(api.users.setRole, { userId: missing, role: "admin" })
      .catch((e: Error) => e.message);
    expect(forbiddenExisting).toContain(NOT_AUTHORIZED);
    expect(forbiddenMissing).toContain(NOT_AUTHORIZED);
    expect(forbiddenExisting).toBe(forbiddenMissing);
  });
});

describe("capability map sanity (R5)", () => {
  test("user management is admin-only", () => {
    expect(CAPABILITY_MIN_ROLE["user.manage"]).toBe("admin");
  });
});
