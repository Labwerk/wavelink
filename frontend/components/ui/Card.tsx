import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../../lib/cx";

const BASE = "rounded-lg bg-surface border border-border shadow-1 p-4";
const INTERACTIVE =
  "transition hover:bg-surface-raised hover:shadow-2 motion-safe:hover:-translate-y-0.5 active:shadow-1 motion-safe:active:translate-y-0";
const WARNING_TONE = "border-warning bg-warning-bg";

/**
 * The single card convention (design-system R17 #4): rounded-lg surface at
 * elevation 1, one padding token, no outer margin. `interactive` adds the
 * hover/pressed lift (R11) for a `next/link` card. `tone="warning"` swaps in
 * the stale-card tint (the one allowlisted status-color use outside
 * StatusBadge, per R13).
 */
export function Card({
  href,
  interactive = false,
  tone,
  className,
  children,
  ...rest
}: {
  href?: string;
  interactive?: boolean;
  tone?: "warning";
  className?: string;
  children: ReactNode;
  [key: string]: unknown;
}) {
  const classes = cx(BASE, interactive && INTERACTIVE, tone === "warning" && WARNING_TONE, className);
  if (href) {
    return (
      <Link href={href} className={cx(classes, "block")} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
