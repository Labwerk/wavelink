// Single source of truth for role -> capability mapping (spec R5).
//
// Roles are ranked; a capability is granted to every role whose rank is at
// least the capability's minimum. That makes "higher roles inherit all
// lower-role capabilities" a single comparison instead of four allow-lists
// that can drift. Pure (no Convex runtime state), so it is used unchanged by
// the server wrappers, `users.me`, and the tests.

import { v } from "convex/values";

export const ROLES = ["viewer", "operator", "maintenance", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const roleValidator = v.union(
  v.literal("viewer"),
  v.literal("operator"),
  v.literal("maintenance"),
  v.literal("admin"),
);

export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  maintenance: 2,
  admin: 3,
};

// Capability -> minimum role. Mirrors the "Users & roles" table in
// specs/auth-roles/spec.md. Capabilities for features that have not shipped
// yet (alert.acknowledge, history.export, ...) are declared now and become
// enforceable when the functions that use them land.
export const CAPABILITY_MIN_ROLE = {
  "data.read": "viewer",
  "alert.acknowledge": "operator",
  "note.write": "operator",
  "history.export": "maintenance",
  "device.diagnostics": "maintenance",
  "device.manage": "admin",
  "alertRule.manage": "admin",
  "user.manage": "admin",
} as const satisfies Record<string, Role>;

export type Capability = keyof typeof CAPABILITY_MIN_ROLE;

export function isKnownCapability(capability: string): capability is Capability {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_MIN_ROLE, capability);
}

/**
 * Whether `role` holds `capability`. Deny-by-default (R4): an unknown
 * capability, or an unknown role, is never granted.
 */
export function roleHasCapability(role: Role, capability: string): boolean {
  if (!isKnownCapability(capability)) return false;
  const roleRank = ROLE_RANK[role];
  if (roleRank === undefined) return false;
  return roleRank >= ROLE_RANK[CAPABILITY_MIN_ROLE[capability]];
}

/** Every capability `role` holds, for UI gating via `users.me` (R8/R9). */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITY_MIN_ROLE) as Capability[]).filter((c) =>
    roleHasCapability(role, c),
  );
}
