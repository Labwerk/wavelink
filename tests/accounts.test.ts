// Account lifecycle: first-admin bootstrap (R13), admin provisioning, atomic
// creation + attribution (R11), deactivation, and the deployment-admin-key
// operations (recovery, password reset).

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "../backend/_generated/api";
import schema from "../backend/schema";
import { NOT_AUTHORIZED } from "../backend/lib/auth";
import { createUserFixture, type Test } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");
const ADMIN_EMAIL = "boss@example.com";

let previousAdminEmail: string | undefined;
beforeEach(() => {
  previousAdminEmail = process.env.INITIAL_ADMIN_EMAIL;
  process.env.INITIAL_ADMIN_EMAIL = ADMIN_EMAIL;
});
afterEach(() => {
  if (previousAdminEmail === undefined) delete process.env.INITIAL_ADMIN_EMAIL;
  else process.env.INITIAL_ADMIN_EMAIL = previousAdminEmail;
});

/** Drives the library's creation path directly (what createAccount runs). */
function createAccountRaw(t: Test, email: string, profile: Record<string, unknown>) {
  return t.mutation(internal.auth.store, {
    args: {
      type: "createAccountFromCredentials",
      provider: "password",
      account: { id: email, secret: "password123" },
      profile: { email, name: "x", role: "viewer", isActive: true, ...profile },
    },
  });
}

const tableCounts = (t: Test) =>
  t.run(async (ctx) => ({
    users: (await ctx.db.query("users").collect()).length,
    accounts: (await ctx.db.query("authAccounts").collect()).length,
    audit: (await ctx.db.query("auditLog").collect()).length,
  }));

describe("first-admin bootstrap (R13): internal action, admin-key only", () => {
  test("creates a working admin, its account and its audit row in one go", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.users.bootstrapAdmin, {
      email: "Boss@Example.com",
      password: "s3cret-pass",
    });

    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: ADMIN_EMAIL, role: "admin", isActive: true });
    expect(users[0].createdBy).toBeUndefined();

    const as = t.withIdentity({ subject: `${users[0]._id}|s` });
    await expect(as.query(api.users.list, {})).resolves.toHaveLength(1);
    const log = await as.query(api.audit.list, {});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorId: users[0]._id,
      action: "user.bootstrapAdmin",
      targetId: users[0]._id,
    });

    const accounts = await t.run((ctx) => ctx.db.query("authAccounts").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0].providerAccountId).toBe(ADMIN_EMAIL);
    expect(accounts[0].secret).toBeTruthy();
    expect(accounts[0].secret).not.toBe("s3cret-pass");
  });

  test("is not a public function", async () => {
    // convex-test does not enforce visibility, so assert the declaration; the
    // deny-by-default meta-test separately guarantees no raw `action` export.
    const src = (
      import.meta.glob("../backend/users.ts", { query: "?raw", import: "default", eager: true }) as Record<
        string,
        string
      >
    )["../backend/users.ts"];
    expect(src).toContain("export const bootstrapAdmin = internalAction(");
    expect(src).toContain("export const setPassword = internalAction(");
    expect(src).not.toMatch(/export const bootstrapAdmin = action\(/);
  });

  test("refuses a different email and leaves nothing behind", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.users.bootstrapAdmin, { email: "attacker@example.com", password: "s3cret-pass" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    expect(await tableCounts(t)).toEqual({ users: 0, accounts: 0, audit: 0 });
  });

  test("refuses once any user exists, even with the configured email", async () => {
    const t = convexTest(schema, modules);
    await createUserFixture(t, "viewer", { email: "someone@example.com" });
    await expect(
      t.action(internal.users.bootstrapAdmin, { email: ADMIN_EMAIL, password: "s3cret-pass" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    expect((await tableCounts(t)).users).toBe(1);
  });

  test("refuses everything when INITIAL_ADMIN_EMAIL is not configured", async () => {
    delete process.env.INITIAL_ADMIN_EMAIL;
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.users.bootstrapAdmin, { email: ADMIN_EMAIL, password: "s3cret-pass" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    await expect(
      t.action(internal.users.bootstrapAdmin, { email: "", password: "s3cret-pass" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("cannot be run twice", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.users.bootstrapAdmin, { email: ADMIN_EMAIL, password: "s3cret-pass" });
    await expect(
      t.action(internal.users.bootstrapAdmin, { email: ADMIN_EMAIL, password: "s3cret-pass" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    expect((await tableCounts(t)).users).toBe(1);
  });

  test("a too-short password is rejected before anything is created", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.users.bootstrapAdmin, { email: ADMIN_EMAIL, password: "abc" }),
    ).rejects.toThrow("at least 8");
    expect(await tableCounts(t)).toEqual({ users: 0, accounts: 0, audit: 0 });
  });
});

describe("creation is one transaction, decided inside the callback (R2, R3, R11)", () => {
  test("empty table + non-matching email: rejected, no account, no user, no audit row", async () => {
    const t = convexTest(schema, modules);
    await expect(createAccountRaw(t, "nobody@example.com", {})).rejects.toThrow(
      "not permitted",
    );
    expect(await tableCounts(t)).toEqual({ users: 0, accounts: 0, audit: 0 });
  });

  test("a forged role in the profile is ignored on the bootstrap path only when the email matches", async () => {
    const t = convexTest(schema, modules);
    // Matching email on an empty table is the bootstrap: admin, by derivation.
    await createAccountRaw(t, ADMIN_EMAIL, { role: "viewer" });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users[0].role).toBe("admin");
    // Any later account cannot claim admin through the profile.
    const { userId: adminId } = { userId: users[0]._id };
    await createAccountRaw(t, "second@example.com", { role: "admin", createdBy: adminId });
    const second = await t.run((ctx) =>
      ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "second@example.com")).unique(),
    );
    expect(second?.role).toBe("viewer");
    expect(second?.createdBy).toBe(adminId);
  });

  test("non-empty table with no createdBy is rejected (public sign-up cannot create users)", async () => {
    const t = convexTest(schema, modules);
    await createUserFixture(t, "admin");
    const before = await tableCounts(t);
    await expect(createAccountRaw(t, "walkin@example.com", {})).rejects.toThrow("not permitted");
    await expect(
      createAccountRaw(t, "walkin@example.com", { role: "admin", isActive: true }),
    ).rejects.toThrow("not permitted");
    expect(await tableCounts(t)).toEqual(before);
  });

  test("createdBy must reference an existing, active admin", async () => {
    const t = convexTest(schema, modules);
    const { userId: viewer } = await createUserFixture(t, "viewer", { email: "v@example.com" });
    const { userId: operator } = await createUserFixture(t, "operator", { email: "o@example.com" });
    const { userId: inactiveAdmin } = await createUserFixture(t, "admin", {
      email: "ia@example.com",
      isActive: false,
    });
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        email: "gone@example.com",
        name: "g",
        role: "admin",
        isActive: true,
      });
      await ctx.db.delete(id);
      return id;
    });
    const before = await tableCounts(t);
    for (const createdBy of [viewer, operator, inactiveAdmin, gone, "garbage", 42, null]) {
      await expect(createAccountRaw(t, "new@example.com", { createdBy })).rejects.toThrow(
        "not permitted",
      );
    }
    expect(await tableCounts(t)).toEqual(before);
  });

  test("an admin-attributed creation writes viewer + createdBy + audit row together", async () => {
    const t = convexTest(schema, modules);
    const { userId: adminId } = await createUserFixture(t, "admin");
    const before = Date.now();
    const userId = await createAccountRaw(t, "new@example.com", { createdBy: adminId }).then(
      async () =>
        (await t.run((ctx) => ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "new@example.com")).unique()))!
          ._id,
    );
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: adminId, action: "user.create", targetId: userId });
    expect(log[0].at).toBeGreaterThanOrEqual(before);
  });
});

describe("admin provisioning: users.createUser (invite-only; default role)", () => {
  test("an admin creates an account: viewer, createdBy the admin, audit row", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId: adminId } = await createUserFixture(t, "admin");
    const newId = await admin.action(api.users.createUser, {
      email: "New.Person@Example.com",
      temporaryPassword: "temp-pass-1",
    });

    const created = await t.run((ctx) => ctx.db.get(newId));
    expect(created).toMatchObject({
      email: "new.person@example.com",
      name: "new.person",
      role: "viewer",
      isActive: true,
      createdBy: adminId,
    });
    const account = await t.run((ctx) =>
      ctx.db
        .query("authAccounts")
        .filter((q) => q.eq(q.field("userId"), newId))
        .unique(),
    );
    expect(account?.secret).toBeTruthy();

    const log = await admin.query(api.audit.list, {});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorId: adminId,
      action: "user.create",
      targetTable: "users",
      targetId: newId,
    });
  });

  test("non-admins and unauthenticated callers are denied and nothing is created", async () => {
    const t = convexTest(schema, modules);
    for (const role of ["viewer", "operator", "maintenance"] as const) {
      const { as } = await createUserFixture(t, role);
      await expect(
        as.action(api.users.createUser, {
          email: `x-${role}@example.com`,
          temporaryPassword: "temp-pass-1",
        }),
      ).rejects.toThrow(NOT_AUTHORIZED);
    }
    await expect(
      t.action(api.users.createUser, { email: "x@example.com", temporaryPassword: "temp-pass-1" }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    expect((await tableCounts(t)).users).toBe(3);
    expect((await tableCounts(t)).accounts).toBe(0);
  });

  test("rejects a duplicate email and a too-short password", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    await expect(
      admin.action(api.users.createUser, { email: "admin@example.com", temporaryPassword: "temp-pass-1" }),
    ).rejects.toThrow("already exists");
    await expect(
      admin.action(api.users.createUser, { email: "short@example.com", temporaryPassword: "abc" }),
    ).rejects.toThrow("at least 8");
  });
});

describe("users.setActive (R7, R11)", () => {
  test("admin deactivates and reactivates a user; each change is audited; effect is immediate", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId: adminId } = await createUserFixture(t, "admin");
    const { as: target, userId: targetId } = await createUserFixture(t, "operator");
    await expect(target.query(api.devices.listActive, {})).resolves.toBeDefined();

    await admin.mutation(api.users.setActive, { userId: targetId, isActive: false });
    await expect(target.query(api.devices.listActive, {})).rejects.toThrow(NOT_AUTHORIZED);
    await expect(target.query(api.users.me, {})).resolves.toBeNull();

    await admin.mutation(api.users.setActive, { userId: targetId, isActive: true });
    await expect(target.query(api.devices.listActive, {})).resolves.toBeDefined();

    const log = await admin.query(api.audit.list, {});
    expect(log.map((l) => l.action)).toEqual(["user.setActive", "user.setActive"]);
    expect(log.map((l) => l.details)).toEqual([
      { from: "false", to: "true" },
      { from: "true", to: "false" },
    ]);
    for (const l of log) expect(l).toMatchObject({ actorId: adminId, targetId });
  });

  test("is admin-only and denies before looking at the target", async () => {
    const t = convexTest(schema, modules);
    const { userId: target } = await createUserFixture(t, "viewer");
    for (const role of ["viewer", "operator", "maintenance"] as const) {
      const { as } = await createUserFixture(t, role, { email: `${role}-x@example.com` });
      await expect(
        as.mutation(api.users.setActive, { userId: target, isActive: false }),
      ).rejects.toThrow(NOT_AUTHORIZED);
    }
    await expect(
      t.mutation(api.users.setActive, { userId: target, isActive: false }),
    ).rejects.toThrow(NOT_AUTHORIZED);
    const row = await t.run((ctx) => ctx.db.get(target));
    expect(row?.isActive).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);
  });

  test("cannot deactivate yourself", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId } = await createUserFixture(t, "admin", { email: "a1@example.com" });
    await createUserFixture(t, "admin", { email: "a2@example.com" });
    await expect(
      admin.mutation(api.users.setActive, { userId, isActive: false }),
    ).rejects.toThrow("your own account");
    expect((await t.run((ctx) => ctx.db.get(userId)))?.isActive).toBe(true);
  });

  test("cannot deactivate the last active admin, but can when another active admin remains", async () => {
    const t = convexTest(schema, modules);
    const { as: admin1 } = await createUserFixture(t, "admin", { email: "a1@example.com" });
    const { as: admin2, userId: id2 } = await createUserFixture(t, "admin", { email: "a2@example.com" });
    // admin2 is not the caller of the next call, so "yourself" does not apply.
    await admin1.mutation(api.users.setActive, { userId: id2, isActive: false });
    // Now admin1 is the only active admin: a second (inactive) admin does not count.
    const { userId: id1 } = { userId: (await admin1.query(api.users.me, {}))!._id };
    await expect(
      admin1.mutation(api.users.setRole, { userId: id1, role: "viewer" }),
    ).rejects.toThrow("last admin");
    await expect(admin2.query(api.users.list, {})).rejects.toThrow(NOT_AUTHORIZED);
  });

  test("setRole does not let the last ACTIVE admin be demoted just because an inactive admin exists", async () => {
    const t = convexTest(schema, modules);
    const { as: admin, userId } = await createUserFixture(t, "admin", { email: "a1@example.com" });
    await createUserFixture(t, "admin", { email: "a2@example.com", isActive: false });
    await expect(
      admin.mutation(api.users.setRole, { userId, role: "operator" }),
    ).rejects.toThrow("last admin");
  });

  test("a no-op change writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const { userId } = await createUserFixture(t, "viewer");
    await admin.mutation(api.users.setActive, { userId, isActive: true });
    expect(await admin.query(api.audit.list, {})).toHaveLength(0);
  });
});

describe("deployment-admin-key operations (internal)", () => {
  test("promoteBootstrapAdmin recovers a lone stranded non-admin user and audits it", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createUserFixture(t, "viewer", { email: ADMIN_EMAIL });
    await t.mutation(internal.users.promoteBootstrapAdmin, { userId });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.role).toBe("admin");
    const log = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "user.recoverAdmin", targetId: userId });
    expect(log[0].actorId).toBeUndefined();
    expect(log[0].details).toMatchObject({ via: "deployment-admin-key" });
  });

  test("promoteBootstrapAdmin refuses when other users exist or the email differs", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await createUserFixture(t, "viewer", { email: ADMIN_EMAIL });
    await createUserFixture(t, "viewer", { email: "other@example.com" });
    await expect(t.mutation(internal.users.promoteBootstrapAdmin, { userId })).rejects.toThrow(
      NOT_AUTHORIZED,
    );

    const t2 = convexTest(schema, modules);
    const { userId: lone } = await createUserFixture(t2, "viewer", { email: "lone@example.com" });
    await expect(t2.mutation(internal.users.promoteBootstrapAdmin, { userId: lone })).rejects.toThrow(
      NOT_AUTHORIZED,
    );
  });

  test("setPassword replaces the credential, signs the user out, and is audited without an actor", async () => {
    const t = convexTest(schema, modules);
    const { as: admin } = await createUserFixture(t, "admin");
    const userId = await admin.action(api.users.createUser, {
      email: "forgot@example.com",
      temporaryPassword: "old-password-1",
    });
    const before = await t.run((ctx) =>
      ctx.db
        .query("authAccounts")
        .filter((q) => q.eq(q.field("userId"), userId))
        .unique(),
    );
    await t.run((ctx) =>
      ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }),
    );

    await t.action(internal.users.setPassword, {
      email: "Forgot@Example.com",
      newPassword: "new-password-2",
    });

    const after = await t.run((ctx) =>
      ctx.db
        .query("authAccounts")
        .filter((q) => q.eq(q.field("userId"), userId))
        .unique(),
    );
    expect(after?.secret).toBeTruthy();
    expect(after?.secret).not.toBe(before?.secret);
    expect(after?.secret).not.toBe("new-password-2");

    const sessions = await t.run((ctx) =>
      ctx.db
        .query("authSessions")
        .filter((q) => q.eq(q.field("userId"), userId))
        .collect(),
    );
    expect(sessions).toHaveLength(0);

    const log = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "user.setPassword"))
        .collect(),
    );
    expect(log).toHaveLength(1);
    expect(log[0].actorId).toBeUndefined();
    expect(log[0]).toMatchObject({ targetId: userId, details: { via: "deployment-admin-key" } });
  });

  test("setPassword rejects an unknown user and a short password", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.users.setPassword, { email: "nobody@example.com", newPassword: "new-password-2" }),
    ).rejects.toThrow("User not found");
    await expect(
      t.action(internal.users.setPassword, { email: "nobody@example.com", newPassword: "x" }),
    ).rejects.toThrow("at least 8");
  });
});
