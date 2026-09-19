import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../backend/_generated/api";
import schema from "../backend/schema";
import { NOT_AUTHORIZED } from "../backend/lib/auth";
import { createUserFixture } from "./testUtils";
import { syncUserOnLogin } from "../backend/users";

const modules = import.meta.glob("../backend/**/*.*s");

describe("bootstrap rule (spec §5, R11)", () => {
  test("the first user ever created is auto-assigned admin", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      syncUserOnLogin(ctx, { existingUserId: null, profile: { email: "first@example.com" } }),
    );
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.role).toBe("admin");
  });

  test("every subsequent first-login user defaults to viewer", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      syncUserOnLogin(ctx, { existingUserId: null, profile: { email: "first@example.com" } }),
    );
    const secondUserId = await t.run((ctx) =>
      syncUserOnLogin(ctx, { existingUserId: null, profile: { email: "second@example.com" } }),
    );
    const second = await t.run((ctx) => ctx.db.get(secondUserId));
    expect(second?.role).toBe("viewer");
  });

  test("repeat logins are a no-op that returns the existing id", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) =>
      syncUserOnLogin(ctx, { existingUserId: null, profile: { email: "first@example.com" } }),
    );
    const again = await t.run((ctx) =>
      syncUserOnLogin(ctx, { existingUserId: userId, profile: { email: "first@example.com" } }),
    );
    expect(again).toBe(userId);
  });
});

describe("users.me (R6)", () => {
  test("returns null when unauthenticated, rather than throwing", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.users.me, {})).resolves.toBeNull();
  });

  test("returns the caller's own profile + role when authenticated", async () => {
    const t = convexTest(schema, modules);
    const { as, userId } = await createUserFixture(t, "operator");
    const me = await as.query(api.users.me, {});
    expect(me?._id).toBe(userId);
    expect(me?.role).toBe("operator");
  });
});

describe("users.list (R7, admin-only)", () => {
  test("denies non-admin roles", async () => {
    const t = convexTest(schema, modules);
    const { as } = await createUserFixture(t, "maintenance");
    await expect(as.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
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

describe("users.setRole (R3/R8, admin-only)", () => {
  test("denies non-admin roles", async () => {
    const t = convexTest(schema, modules);
    const { as: operator } = await createUserFixture(t, "operator");
    const { userId: target } = await createUserFixture(t, "viewer");
    await expect(
      operator.mutation(api.users.setRole, { userId: target, role: "admin" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("admin can change a target user's role, reflected in me/list", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const { as: target, userId: targetId } = await createUserFixture(t, "viewer");

    await admin.mutation(api.users.setRole, { userId: targetId, role: "operator" });

    const me = await target.query(api.users.me, {});
    expect(me?.role).toBe("operator");

    const list = await admin.query(api.users.list, {});
    expect(list.find((u) => u._id === targetId)?.role).toBe("operator");
  });
});

describe("deactivated user (spec §4)", () => {
  test("is rejected even with an otherwise-valid admin role", async () => {
    const t = convexTest(schema, modules);
    const { as } = await createUserFixture(t, "admin", { isActive: false });
    await expect(as.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });
});

describe("error-message non-leakage (R4)", () => {
  test("unauthenticated, wrong-role, and deactivated denials are indistinguishable", async () => {
    const t = convexTest(schema, modules);
    const { as: viewer } = await createUserFixture(t, "viewer");
    const { as: deactivatedAdmin } = await createUserFixture(t, "admin", { isActive: false });

    const unauthenticated = t.query(api.users.list, {}).catch((e: Error) => e.message);
    const wrongRole = viewer.query(api.users.list, {}).catch((e: Error) => e.message);
    const deactivated = deactivatedAdmin.query(api.users.list, {}).catch((e: Error) => e.message);

    const [m1, m2, m3] = await Promise.all([unauthenticated, wrongRole, deactivated]);
    expect(m1).toContain(NOT_AUTHORIZED);
    expect(m2).toContain(NOT_AUTHORIZED);
    expect(m3).toContain(NOT_AUTHORIZED);
  });
});
