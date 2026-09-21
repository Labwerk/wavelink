import styles from "./StatusBadge.module.css";

export type StatusKind =
  | "online"
  | "offline"
  | "stale"
  | "unknown"
  | "decommissioned"
  | "error"
  | "warning";

// Every kind has its own glyph shape and a text label, so meaning survives
// grayscale and color-blindness (design-system R2). This is the only
// sanctioned way to color a status; see styles/README.md.
export const STATUS_GLYPH: Record<StatusKind, string> = {
  online: "●",
  offline: "○",
  stale: "◐",
  unknown: "?",
  decommissioned: "⊘",
  warning: "⚠",
  error: "✕",
};

export const STATUS_LABEL: Record<StatusKind, string> = {
  online: "Online",
  offline: "Offline",
  stale: "Stale",
  unknown: "Unknown",
  decommissioned: "Decommissioned",
  warning: "Warning",
  error: "Error",
};

export function StatusBadge({ kind, label }: { kind: StatusKind; label?: string }) {
  return (
    <span className={styles.badge} data-kind={kind}>
      <span className={styles.glyph} aria-hidden="true">
        {STATUS_GLYPH[kind]}
      </span>
      {label ?? STATUS_LABEL[kind]}
    </span>
  );
}
