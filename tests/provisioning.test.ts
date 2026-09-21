import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../backend/_generated/api";
import schema from "../backend/schema";
import { createUserFixture } from "./testUtils";
import { createUserRecord, passwordProfile } from "../backend/lib/provisioning";

const modules = import.meta.glob("../backend/**/*.*s");

describe("public sign-up is disabled (invite-only)", () => {
  test("the Password provider profile hook rejects the signUp flow", () => {
    expect(() =>
      passwordProfile({ flow: "signUp", email: "me@example.com", password: "password123" }),
    ).toThrow(/Sign-up is disabled/);
  });

  test("every non-signIn flow is refused, including a missing flow", () => {
    for (const flow of ["reset", "reset-verification", "email-verification", "", undefined]) {
      expect(() => passwordProfile({ flow, email: "me@example.com" })).toThrow();
    }
  });

  test("signIn is allowed and normalizes the email", () => {
    expect(passwordProfile({ flow: "signIn", email: "  Me@Example.COM " })).toMatchObject({
      email: "me@example.com",
    });
  });

  test("signIn with no email is rejected", () => {
    expect(() => passwordProfile({ flow: "signIn" })).toThrow();
  });
});

describe("default role: every newly created account is a viewer", () => {
  test("createUserRecord ignores a role/isActive smuggled into the profile (R3)", async () => {
    const t = convexTest(schema, modules);
    const { userId: adminId } = await createUserFixture(t, "admin");
    const id = await t.run((ctx) =>
      createUserRecord(ctx, {
        email: "evil@example.com",
        role: "admin",
        isActive: false,
        createdBy: adminId,
      } as never),
    );
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user).toMatchObject({ email: "evil@example.com", role: "viewer", isActive: true });
  });

  test("the auth creation callback (auth:store) writes viewer even when the profile says admin", async () => {
    const t = convexTest(schema, modules);
    const { userId: adminId } = await createUserFixture(t, "admin");
    await t.mutation(internal.auth.store, {
      args: {
        type: "createAccountFromCredentials",
        provider: "password",
        account: { id: "sneaky@example.com", secret: "password123" },
        profile: {
          email: "sneaky@example.com",
          name: "Sneaky",
          role: "admin",
          isActive: true,
          createdBy: adminId,
        },
      },
    });
    const sneaky = await t.run((ctx) =>
      ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", "sneaky@example.com")).unique(),
    );
    expect(sneaky?.role).toBe("viewer");
  });

  test("createUserRecord refuses a duplicate email and a blank email", async () => {
    const t = convexTest(schema, modules);
    const { userId: adminId } = await createUserFixture(t, "admin");
    await t.run((ctx) => createUserRecord(ctx, { email: "dup@example.com", createdBy: adminId }));
    await expect(
      t.run((ctx) => createUserRecord(ctx, { email: "DUP@example.com", createdBy: adminId })),
    ).rejects.toThrow("already exists");
    await expect(
      t.run((ctx) => createUserRecord(ctx, { email: "  ", createdBy: adminId })),
    ).rejects.toThrow();
  });

  test("the users table cannot hold a role outside the four (R2)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run((ctx) =>
        ctx.db.insert("users", {
          email: "x@example.com",
          name: "x",
          role: "superuser" as never,
          isActive: true,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      t.run((ctx) =>
        ctx.db.insert("users", { email: "y@example.com", name: "y", isActive: true } as never),
      ),
    ).rejects.toThrow();
  });
});
