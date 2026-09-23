"use client";

import { Button as HeadlessButton } from "@headlessui/react";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

/**
 * The single selectable-list convention (design-system R17 #10): stacked
 * full-width rows, each a button with `aria-pressed`, hover/pressed/selected
 * surface states, row dividers, one padding token. Built on Headless UI's
 * `Button` (R16) so the row is keyboard-focusable (a plain `<li onClick>`
 * cannot be).
 */
export function SelectableList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("divide-y divide-border", className)}>{children}</ul>;
}

export function SelectableListItem({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <HeadlessButton
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={cx(
          "block w-full text-left px-3 py-2 text-sm transition-colors -outline-offset-2 data-hover:bg-surface-raised data-active:bg-surface-hover",
          selected && "bg-surface-raised",
        )}
      >
        {children}
      </HeadlessButton>
    </li>
  );
}
