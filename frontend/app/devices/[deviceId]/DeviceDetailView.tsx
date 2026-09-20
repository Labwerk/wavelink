"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../backend/_generated/api";
import type { Id } from "../../../../backend/_generated/dataModel";
import { useNow } from "../../../lib/useNow";
import { classifyFreshness, STALE_FACTOR } from "../../../lib/freshness";
import { MetricTable } from "../../../components/MetricTable";
import { EventLog } from "../../../components/EventLog";
import styles from "./DeviceDetailView.module.css";

/**
 * Device detail view (R3, R4): all of one device's current metrics plus its
 * recent event log, both reactive subscriptions (R5). A decommissioned
 * device reached by direct link still renders here, labelled, instead of
 * 404ing (plan.md's Data model note — R3 edge case).
 */
export function DeviceDetailView({ deviceId }: { deviceId: Id<"devices"> }) {
  const snapshot = useQuery(api.liveView.deviceSnapshot, { deviceId });
  const events = useQuery(api.liveView.recentEvents, { deviceId });
  const me = useQuery(api.users.me);
  const deactivate = useMutation(api.devices.deactivate);
  const now = useNow();

  if (snapshot === undefined) {
    return (
      <main className={styles.main}>
        <p>Loading…</p>
      </main>
    );
  }
  if (snapshot === null) {
    return (
      <main className={styles.main}>
        <Link href="/">← Back to overview</Link>
        <p>Device not found.</p>
      </main>
    );
  }

  const { device, metrics } = snapshot;
  const freshness = classifyFreshness({
    lastSeenAt: device.lastSeenAt,
    expectedIntervalMs: device.expectedIntervalMs,
    now,
  });

  return (
    <main className={styles.main}>
      <Link href="/">← Back to overview</Link>
      <h1>{device.name}</h1>
      {!device.isActive && <p className={styles.decommissioned}>Decommissioned</p>}
      <p>
        {device.type}
        {device.zone ? ` · ${device.zone}` : null}
      </p>
      <p>
        Status: <strong>{device.status}</strong> · Last seen:{" "}
        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "never"}
      </p>
      {freshness !== "live" && (
        <p className={styles.staleBadge}>
          ⚠ {freshness === "never" ? "Never reported" : "Stale"}
        </p>
      )}
      {/* Needs `device.manage` (admin) - the mutation re-checks server-side.
          Out of scope for this feature (device registry owns it), ported
          here from the pre-live-telemetry-view dashboard so deactivating a
          device isn't only reachable by editing the database directly. */}
      {device.isActive && me?.capabilities.includes("device.manage") && (
        <button onClick={() => void deactivate({ deviceId })}>Deactivate (admin)</button>
      )}

      <h2>Metrics</h2>
      <MetricTable metrics={metrics} />

      <h2>Recent activity</h2>
      <EventLog
        entries={events ?? []}
        gapThresholdMs={device.expectedIntervalMs * STALE_FACTOR}
      />
    </main>
  );
}
