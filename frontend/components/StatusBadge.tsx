import {
  Ban,
  CircleCheck,
  CircleMinus,
  CircleQuestionMark,
  CircleX,
  ClockAlert,
  TriangleAlert,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cx } from "../lib/cx";

export type StatusKind =
  | "online"
  | "offline"
  | "stale"
  | "unknown"
  | "decommissioned"
  | "error"
  | "warning"
  | "active"
  | "inactive";

// Every kind has its own icon shape (lucide-react, design-system R12) and a
// text label, so meaning survives grayscale and color-blindness (R2). This
// is the only sanctioned status badge implementation (R13, R17 #5); see
// styles/README.md. The icon is rendered once, here, sized and stroked from
// the theme's icon token so weight/size can't drift between kinds.
export const STATUS_ICON: Record<StatusKind, LucideIcon> = {
  online: Wifi,
  offline: WifiOff,
  stale: ClockAlert,
  unknown: CircleQuestionMark,
  decommissioned: Ban,
  warning: TriangleAlert,
  error: CircleX,
  active: CircleCheck,
  inactive: CircleMinus,
};

export const STATUS_LABEL: Record<StatusKind, string> = {
  online: "Online",
  offline: "Offline",
  stale: "Stale",
  unknown: "Unknown",
  decommissioned: "Decommissioned",
  warning: "Warning",
  error: "Error",
  active: "Active",
  inactive: "Inactive",
};

// Static, complete class strings per kind (Tailwind detects classes by
// plain-text scanning, so these are never interpolated fragments). This is
// the one allowlisted place status-color utilities may appear (R13).
const STATUS_TONE: Record<StatusKind, string> = {
  online: "text-success bg-success-bg",
  offline: "text-danger bg-danger-bg",
  stale: "text-warning bg-warning-bg",
  unknown: "text-neutral bg-neutral-bg",
  decommissioned: "text-decommissioned bg-neutral-bg",
  warning: "text-warning bg-warning-bg",
  error: "text-danger bg-danger-bg",
  active: "text-accent bg-accent-bg",
  inactive: "text-neutral bg-neutral-bg",
};

export function StatusBadge({ kind, label }: { kind: StatusKind; label?: string }) {
  const Icon = STATUS_ICON[kind];
  return (
    <span
      data-kind={kind}
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_TONE[kind],
      )}
    >
      <Icon className="size-icon shrink-0" aria-hidden="true" />
      {label ?? STATUS_LABEL[kind]}
    </span>
  );
}
