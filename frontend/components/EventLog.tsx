"use client";

import styles from "./EventLog.module.css";

export interface EventLogReading {
  id: string;
  ts: number;
  metric: string;
  value: number | string;
}

type Row =
  | ({ kind: "reading" } & EventLogReading)
  | { kind: "gap"; fromTs: number; toTs: number };

/**
 * Device detail view's recent event log (R4) — telemetry/status activity
 * only. `entries` comes straight from `liveView.recentEvents`, which reads
 * nothing but the `telemetry` table, so there is no alert-record content
 * here to leak; this component's prop type has no alert fields either.
 * Between two consecutive readings spaced further apart than
 * `gapThresholdMs`, a synthesized "gap" marker is inserted client-side
 * (plan.md's "Event log" decision) — server data is untouched.
 */
export function EventLog({
  entries,
  gapThresholdMs,
}: {
  entries: readonly EventLogReading[];
  gapThresholdMs: number;
}) {
  if (entries.length === 0) {
    return <p>No recent activity.</p>;
  }

  const rows: Row[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    rows.push({ kind: "reading", ...entry });
    const next = entries[i + 1]; // entries are newest-first; `next` is older
    if (next && entry.ts - next.ts > gapThresholdMs) {
      rows.push({ kind: "gap", fromTs: next.ts, toTs: entry.ts });
    }
  }

  return (
    <ul className={styles.log}>
      {rows.map((row) =>
        row.kind === "gap" ? (
          <li key={`gap-${row.fromTs}-${row.toTs}`} className={styles.gap}>
            ⋯ gap of {formatDuration(row.toTs - row.fromTs)}
          </li>
        ) : (
          <li key={row.id} className={styles.entry}>
            <span className={styles.time}>{new Date(row.ts).toLocaleTimeString()}</span>
            <span className={styles.metric}>{row.metric}</span>
            <span className={styles.value}>{row.value}</span>
          </li>
        ),
      )}
    </ul>
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  return `${minutes}m`;
}
