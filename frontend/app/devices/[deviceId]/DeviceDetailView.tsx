"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../backend/_generated/api";
import type { Id } from "../../../../backend/_generated/dataModel";
import { useNow } from "../../../lib/useNow";
import { classifyFreshness, STALE_FACTOR } from "../../../lib/freshness";
import { MetricTable } from "../../../components/MetricTable";
import { EventLog } from "../../../components/EventLog";
import { StatusBadge } from "../../../components/StatusBadge";
import { PageHeading } from "../../../components/ui/PageHeading";

/**
 * Device detail view (R3, R4): all of one device's current metrics plus its
 * recent event log, both reactive subscriptions (R5). A decommissioned
 * device reached by direct link still renders here, labelled, instead of
 * 404ing (plan.md's Data model note — R3 edge case). Read-only: editing or
 * decommissioning a device is the device registry's job (explicit non-goal —
 * see /devices for that management UI).
 */
export function DeviceDetailView({ deviceId }: { deviceId: Id<"devices"> }) {
  const snapshot = useQuery(api.liveView.deviceSnapshot, { deviceId });
  const events = useQuery(api.liveView.recentEvents, { deviceId });
  const now = useNow();

  if (snapshot === undefined) {
    return (
      <main className="max-w-3xl">
        <p>Loading…</p>
      </main>
    );
  }
  if (snapshot === null) {
    return (
      <main className="max-w-3xl">
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
    <main className="max-w-3xl space-y-4">
      <PageHeading actions={<Link href="/">← Back to overview</Link>}>{device.name}</PageHeading>
      {device.lifecycle === "decommissioned" && <StatusBadge kind="decommissioned" />}
      <p>
        {device.type}
        {device.zone ? ` · ${device.zone}` : null}
      </p>
      <p>
        Status: <StatusBadge kind={device.status} /> · Last seen:{" "}
        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "never"}
      </p>
      {freshness !== "live" && (
        <p className="w-fit m-0">
          <StatusBadge kind={freshness === "never" ? "unknown" : "stale"} label={freshness === "never" ? "Never reported" : "Stale"} />
        </p>
      )}

      <h2 className="text-xl font-semibold text-fg">Metrics</h2>
      <MetricTable metrics={metrics} />

      <h2 className="text-xl font-semibold text-fg">Recent activity</h2>
      <EventLog
        entries={events ?? []}
        gapThresholdMs={device.expectedIntervalMs * STALE_FACTOR}
      />
    </main>
  );
}
