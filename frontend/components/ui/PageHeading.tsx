import type { ReactNode } from "react";

/**
 * The single page-heading convention (design-system R17 #3): h1 on the
 * left, page actions right-aligned. This must be the first element of every
 * authenticated page's primary render (loading/error branches are exempt).
 */
export function PageHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold leading-tight text-fg">{children}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
