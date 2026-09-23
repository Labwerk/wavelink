"use client";

import { TBody, Td, Th, THead, Table, Tr } from "./ui/Table";

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
    <Table>
      <THead>
        <Tr>
          <Th>Metric</Th>
          <Th>Value</Th>
          <Th>At</Th>
        </Tr>
      </THead>
      <TBody>
        {metrics.map((metric) => (
          <Tr key={metric.metric}>
            <Td>{metric.metric}</Td>
            <Td>{metric.value === null ? "—" : metric.value}</Td>
            <Td>{metric.ts === null ? "—" : new Date(metric.ts).toLocaleTimeString()}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
