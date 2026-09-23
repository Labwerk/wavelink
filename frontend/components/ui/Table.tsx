import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

/**
 * The single table convention (design-system R17 #6): full-width, wrapped
 * in a card surface, left-aligned small-text header, row dividers, one
 * cell-padding token.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-lg bg-surface border border-border shadow-1 overflow-x-auto", className)}>
      <table className="min-w-full divide-y divide-border">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr>{children}</tr>;
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="py-3 px-3 text-left text-sm font-semibold text-fg">{children}</th>;
}

export function Td({ children }: { children: ReactNode }) {
  return <td className="py-2 px-3 text-sm text-fg-muted">{children}</td>;
}
