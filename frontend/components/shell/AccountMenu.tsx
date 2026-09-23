"use client";

import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";

export interface AccountMenuIdentity {
  email?: string;
  role: string;
}

// The account menu convention (design-system R17 #2): a dropdown in the top
// bar showing the signed-in identity, with sign-out inside. Built on
// Headless UI's `Menu` (R16) for full keyboard/ARIA handling (Enter/Space to
// open, arrow keys between items, Escape closes and returns focus to the
// button). Sign-out is the exact handler the shell always used (R9).
export function AccountMenu({
  identity,
  onSignOut,
}: {
  identity: AccountMenuIdentity;
  onSignOut: () => void;
}) {
  return (
    <Menu>
      <MenuButton className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors -outline-offset-2 data-hover:bg-surface-raised data-active:bg-surface-hover">
        <span className="text-fg-muted">{identity.email}</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold capitalize text-fg">
          {identity.role}
        </span>
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        transition
        className="min-w-max rounded-md bg-surface-raised shadow-2 z-30 py-1 transition data-closed:opacity-0 motion-safe:data-closed:scale-95"
      >
        <MenuItem>
          <button
            type="button"
            onClick={onSignOut}
            className="block w-full text-left px-3 py-2 text-sm text-fg transition-colors data-focus:bg-surface-hover"
          >
            Sign out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}
