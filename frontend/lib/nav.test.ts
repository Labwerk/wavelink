import { describe, expect, it } from "vitest";
import { capabilitiesFor, ROLES, type Role } from "../../backend/lib/permissions";
import { activeNavItem, isActive, NAV_ITEMS, visibleNavItems } from "./nav";

// Expected nav per role, from specs/design-system/plan.md "Role -> nav mapping".
const EXPECTED: Record<Role, string[]> = {
  viewer: ["Overview", "Devices"],
  operator: ["Overview", "Devices"],
  maintenance: ["Overview", "Devices"],
  admin: ["Overview", "Devices", "Users"],
};

describe("visibleNavItems (R4)", () => {
  for (const role of ROLES) {
    it(`lists the permitted sections for ${role}`, () => {
      const labels = visibleNavItems(capabilitiesFor(role)).map((item) => item.label);
      expect(labels).toEqual(EXPECTED[role]);
    });
  }

  it("shows nothing without capabilities", () => {
    expect(visibleNavItems([])).toEqual([]);
  });
});

function item(label: string) {
  const found = NAV_ITEMS.find((i) => i.label === label);
  if (!found) throw new Error(`no nav item ${label}`);
  return found;
}

describe("isActive (R5)", () => {
  it("matches / exactly", () => {
    expect(isActive("/", item("Overview"))).toBe(true);
    expect(isActive("/devices", item("Overview"))).toBe(false);
    expect(isActive("/signin", item("Overview"))).toBe(false);
  });

  it("matches /devices and its children for Devices", () => {
    expect(isActive("/devices", item("Devices"))).toBe(true);
    expect(isActive("/devices/abc", item("Devices"))).toBe(true);
    expect(isActive("/devicesx", item("Devices"))).toBe(false);
    expect(isActive("/", item("Devices"))).toBe(false);
  });

  it("matches /admin/users for Users", () => {
    expect(isActive("/admin/users", item("Users"))).toBe(true);
    expect(isActive("/devices", item("Users"))).toBe(false);
  });

  it("activates nothing on /signin", () => {
    expect(NAV_ITEMS.some((i) => isActive("/signin", i))).toBe(false);
  });
});

describe("activeNavItem", () => {
  it("finds the item for a path", () => {
    expect(activeNavItem("/devices/abc")?.label).toBe("Devices");
    expect(activeNavItem("/")?.label).toBe("Overview");
    expect(activeNavItem("/nowhere")).toBeUndefined();
  });
});
