import Link from "next/link";
import { isActive, type NavItem } from "../../lib/nav";
import styles from "./SideNav.module.css";

// Persistent navigation (design-system R3). Items are already filtered by
// capability by the caller (R4). The active item is marked with
// aria-current plus a left bar and heavier weight, not color alone.
export function SideNav({ items, pathname }: { items: readonly NavItem[]; pathname: string }) {
  return (
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}>
        Wavelink
      </Link>
      <nav aria-label="Primary">
        <ul className={styles.list}>
          {items.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={styles.item}
                  aria-current={active ? "page" : undefined}
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
