"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { AccountMenu } from "./AccountMenu";

export interface TopBarIdentity {
  email?: string;
  role: string;
}

// Section title plus the signed-in identity and sign-out, via the account
// menu convention (design-system R3, R17 #1, #2). Sign-out is the same
// handler the shell always used (R9). While the identity is still loading,
// the bar renders empty so the layout doesn't shift.
export function TopBar({ title, identity }: { title?: string; identity?: TopBarIdentity }) {
  const { signOut } = useAuthActions();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/signin");
  }

  return (
    <header className="flex items-center justify-between gap-4 sticky top-0 z-10 h-topbar bg-surface shadow-1 px-content">
      <span className="text-xl font-semibold text-fg">{title}</span>
      {identity && <AccountMenu identity={identity} onSignOut={() => void handleSignOut()} />}
    </header>
  );
}
