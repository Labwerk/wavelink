import type { Capability } from "../../backend/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  /** The one capability a user needs to see (and reach) this section. */
  capability: Capability;
  /** `exact` highlights only on the same path; `prefix` also on child paths. */
  match: "exact" | "prefix";
}

// Sections of the app shell. Visibility is driven by `users.me` capabilities
// (single source of role -> capability: backend/lib/permissions.ts), so there
// is no parallel role table here to drift. Adding a section later is one entry.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", href: "/", capability: "data.read", match: "exact" },
  { label: "Devices", href: "/devices", capability: "data.read", match: "prefix" },
  { label: "Users", href: "/admin/users", capability: "user.manage", match: "prefix" },
];

/** Items the caller may reach. Others are omitted, never rendered disabled (R4). */
export function visibleNavItems(capabilities: readonly string[]): NavItem[] {
  return NAV_ITEMS.filter((item) => capabilities.includes(item.capability));
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The nav item a path belongs to, for the top bar's section title. */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item));
}
