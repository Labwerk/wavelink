import Link from "next/link";
import { isActive, type NavItem } from "../../lib/nav";
import { cx } from "../../lib/cx";

const ACTIVE_ITEM = "bg-surface-raised text-fg font-semibold";
const INACTIVE_ITEM =
  "text-fg-muted font-medium hover:bg-surface-raised hover:text-fg active:bg-surface-hover";

// Persistent navigation (design-system R3, R17 #1). Items are already
// filtered by capability by the caller (R4). The active item is marked with
// aria-current plus a raised fill and heavier weight, not color alone (R2).
export function SideNav({ items, pathname }: { items: readonly NavItem[]; pathname: string }) {
  return (
    <aside className="w-sidebar shrink-0 sticky top-0 h-screen bg-surface shadow-1 z-20 flex flex-col">
      <Link
        href="/"
        className="flex items-center h-topbar px-content text-xl font-semibold text-fg no-underline hover:text-accent-hover active:text-fg-muted transition-colors -outline-offset-2"
      >
        Wavelink
      </Link>
      <nav aria-label="Primary" className="px-3">
        <ul className="space-y-1">
          {items.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex rounded-md px-3 py-2 text-sm transition-colors -outline-offset-2",
                    active ? ACTIVE_ITEM : INACTIVE_ITEM,
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
