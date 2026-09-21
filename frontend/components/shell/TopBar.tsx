"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import styles from "./TopBar.module.css";

export interface TopBarIdentity {
  email?: string;
  role: string;
}

// Section title plus the signed-in identity and sign-out (design-system R3).
// Sign-out is the same handler the old SiteHeader used (R9). While the
// identity is still loading, the bar renders empty so the layout doesn't shift.
export function TopBar({ title, identity }: { title?: string; identity?: TopBarIdentity }) {
  const { signOut } = useAuthActions();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/signin");
  }

  return (
    <header className={styles.bar}>
      <span className={styles.title}>{title}</span>
      {identity && (
        <div className={styles.identity}>
          <span className={styles.email}>{identity.email}</span>
          <span className={styles.role}>{identity.role}</span>
          <button onClick={() => void handleSignOut()}>Sign out</button>
        </div>
      )}
    </header>
  );
}
