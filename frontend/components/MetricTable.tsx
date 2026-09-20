"use client";

import styles from "./MetricTable.module.css";

export interface MetricRow {
  metric: string;
  value: number | string | null;
  ts: number | null;
}

/**
 * All of a device's current metric values (R3) — every entry
 * `liveView.deviceSnapshot` resolves, including a configured metric that has
 * never reported (`value: null` → rendered "—", distinguishable from `0`).
 */
export function MetricTable({ metrics }: { metrics: readonly MetricRow[] }) {
  if (metrics.length === 0) {
    return <p>No metrics reported yet.</p>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Metric</th>
          <th>Value</th>
          <th>At</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((metric) => (
          <tr key={metric.metric}>
            <td>{metric.metric}</td>
            <td>{metric.value === null ? "—" : metric.value}</td>
            <td>{metric.ts === null ? "—" : new Date(metric.ts).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
