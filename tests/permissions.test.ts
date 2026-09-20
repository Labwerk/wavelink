import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../backend/schema";
import { NOT_AUTHORIZED, requireCapability } from "../backend/lib/auth";
import {
  CAPABILITY_MIN_ROLE,
  ROLES,
  ROLE_RANK,
  capabilitiesFor,
  roleHasCapability,
  type Capability,
  type Role,
} from "../backend/lib/permissions";
import { createUserFixture } from "./testUtils";

const modules = import.meta.glob("../backend/**/*.*s");

// The spec's "Users & roles" table, written out independently of the
// implementation's map so a drift in either is caught (R5).
const SPEC_TABLE: Record<Role, Capability[]> = {
  viewer: ["data.read"],
  operator: ["data.read", "alert.acknowledge", "note.write"],
  maintenance: [
    "data.read",
    "alert.acknowledge",
    "note.write",
    "history.export",
    "device.diagnostics",
  ],
  admin: [
    "data.read",
    "alert.acknowledge",
    "note.write",
    "history.export",
    "device.diagnostics",
    "device.manage",
    "alertRule.manage",
    "user.manage",
  ],
};

describe("capability map (R5)", () => {
  test("ranks are strictly ordered viewer < operator < maintenance < admin", () => {
    expect(ROLES.map((r) => ROLE_RANK[r])).toEqual([0, 1, 2, 3]);
  });

  for (const role of ROLES) {
    test(`${role} holds exactly the capabilities in the spec table`, () => {
      expect([...capabilitiesFor(role)].sort()).toEqual([...SPEC_TABLE[role]].sort());
    });
  }

  test("higher roles inherit every lower role's capabilities", () => {
    for (let i = 1; i < ROLES.length; i++) {
      const lower = new Set(capabilitiesFor(ROLES[i - 1]));
      const higher = new Set(capabilitiesFor(ROLES[i]));
      for (const c of lower) expect(higher.has(c)).toBe(true);
    }
  });

  test("every declared capability is granted to at least the admin", () => {
    for (const c of Object.keys(CAPABILITY_MIN_ROLE) as Capability[]) {
      expect(roleHasCapability("admin", c)).toBe(true);
    }
  });

  test("deny-by-default: an unknown capability is granted to no role (R4)", () => {
    for (const role of ROLES) {
      expect(roleHasCapability(role, "not.a.capability")).toBe(false);
      expect(roleHasCapability(role, "")).toBe(false);
      expect(roleHasCapability(role, "toString")).toBe(false);
      expect(roleHasCapability(role, "__proto__")).toBe(false);
    }
  });
});

// One allowed and one forbidden action per role, enforced through the real
// server check (R5).
describe("requireCapability per role (R3, R5)", () => {
  const cases: Array<{ role: Role; allowed: Capability; forbidden: Capability | null }> = [
    { role: "viewer", allowed: "data.read", forbidden: "alert.acknowledge" },
    { role: "operator", allowed: "alert.acknowledge", forbidden: "history.export" },
    { role: "maintenance", allowed: "history.export", forbidden: "device.manage" },
    { role: "admin", allowed: "user.manage", forbidden: null },
  ];

  for (const { role, allowed, forbidden } of cases) {
    test(`${role}: allowed ${allowed}${forbidden ? `, forbidden ${forbidden}` : ""}`, async () => {
      const t = convexTest(schema, modules);
      const { as, userId } = await createUserFixture(t, role);
      const user = await as.run((ctx) => requireCapability(ctx, allowed));
      expect(user._id).toBe(userId);
      if (forbidden) {
        await expect(as.run((ctx) => requireCapability(ctx, forbidden))).rejects.toThrow(
          NOT_AUTHORIZED,
        );
      }
    });
  }

  test("an unknown capability denies even an admin (R4)", async () => {
    const t = convexTest(schema, modules);
    const { as } = await createUserFixture(t, "admin");
    await expect(as.run((ctx) => requireCapability(ctx, "brand.new.capability"))).rejects.toThrow(
      NOT_AUTHORIZED,
    );
  });

  test("unauthenticated and deactivated callers are denied with the same error", async () => {
    const t = convexTest(schema, modules);
    const { as: inactive } = await createUserFixture(t, "admin", { isActive: false });
    await expect(t.run((ctx) => requireCapability(ctx, "data.read"))).rejects.toThrow(NOT_AUTHORIZED);
    await expect(inactive.run((ctx) => requireCapability(ctx, "data.read"))).rejects.toThrow(
      NOT_AUTHORIZED,
    );
  });

  test("an identity whose user row no longer exists is denied", async () => {
    const t = convexTest(schema, modules);
    const { as, userId } = await createUserFixture(t, "admin");
    await t.run((ctx) => ctx.db.delete(userId));
    await expect(as.run((ctx) => requireCapability(ctx, "data.read"))).rejects.toThrow(NOT_AUTHORIZED);
  });
});
