"use client";

import { useQuery } from "convex/react";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { api } from "../../../backend/_generated/api";
import { activeNavItem, visibleNavItems } from "../../lib/nav";
import styles from "./AppShell.module.css";
import { SideNav } from "./SideNav";
import { TopBar } from "./TopBar";

// The one shared frame (navigation + top bar) for every authenticated page,
// mounted once in the root layout so it persists across client-side route
// changes (design-system R3, R5). The proxy (frontend/proxy.ts) already sends
// signed-out visitors to /signin; this only decides what to draw, and every
// protected query/mutation re-checks the caller's role server-side regardless.
//
// The content wrapper is a <div>, not <main>: pages render their own <main>.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useQuery(api.users.me);

  if (pathname === "/signin" || me === null) return <>{children}</>;

  // `me === undefined`: still loading. Draw the frame with no links or
  // identity so the page doesn't shift when the query resolves.
  const items = me ? visibleNavItems(me.capabilities) : [];

  return (
    <div className={styles.shell}>
      <SideNav items={items} pathname={pathname} />
      <div className={styles.main}>
        <TopBar
          title={me ? activeNavItem(pathname)?.label : undefined}
          identity={me ? { email: me.email, role: me.role } : undefined}
        />
        <div id="content" className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
