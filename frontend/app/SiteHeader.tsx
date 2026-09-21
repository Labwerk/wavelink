"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../../backend/_generated/api";

// Signed-in identity, sign-out, and admin nav, rendered on every page from
// the root layout. The proxy (frontend/proxy.ts) already sends signed-out
// visitors to /signin (R1); this is cosmetic only (R8/R9) — every protected
// query/mutation re-checks the caller's role server-side regardless.
export function SiteHeader() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const pathname = usePathname();
  const me = useQuery(api.users.me);

  if (pathname === "/signin" || !me) return null;

  async function handleSignOut() {
    await signOut();
    router.replace("/signin");
  }

  const canManageUsers = me.capabilities.includes("user.manage");

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.75rem 2rem",
        borderBottom: "1px solid #ddd",
        fontFamily: "sans-serif",
      }}
    >
      <Link href="/" style={{ fontWeight: "bold", textDecoration: "none", color: "inherit" }}>
        Wavelink
      </Link>
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <span style={{ color: "#666" }}>
          Signed in as {me.email} ({me.role})
        </span>
        <Link href="/devices">Devices</Link>
        {canManageUsers && <Link href="/admin/users">Manage users</Link>}
        <button onClick={() => void handleSignOut()}>Sign out</button>
      </div>
    </header>
  );
}
