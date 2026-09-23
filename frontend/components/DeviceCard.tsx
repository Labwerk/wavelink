"use client";

import { classifyFreshness } from "../lib/freshness";
import { StatusBadge } from "./StatusBadge";
import { Card } from "./ui/Card";

export interface DeviceCardMetric {
  metric: string;
  value: number | string | null;
  ts: number | null;
}

export interface DeviceCardDevice {
  deviceId: string;
  externalId: string;
  name: string;
  type: string;
  zone?: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt?: number;
  expectedIntervalMs: number;
  keyMetrics: DeviceCardMetric[];
}

/**
 * One device's tile on the overview screen (R1, R2, R17 #4 card). Status
 * and last-seen are rendered verbatim from `device` (R1); staleness (R6) is
 * a *separate* affordance layered on top — a status badge plus muted metric
 * values, never colour alone, so it's still testable/visible without
 * relying on colour.
 */
export function DeviceCard({ device, now }: { device: DeviceCardDevice; now: number }) {
  const freshness = classifyFreshness({
    lastSeenAt: device.lastSeenAt,
    expectedIntervalMs: device.expectedIntervalMs,
    now,
  });
  const isNotLive = freshness !== "live";

  return (
    <Card
      href={`/devices/${device.deviceId}`}
      interactive
      tone={freshness === "stale" ? "warning" : undefined}
      data-freshness={freshness}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-fg">{device.name}</span>
        {isNotLive &&
          (freshness === "never" ? (
            <StatusBadge kind="unknown" label="Never reported" />
          ) : (
            <StatusBadge kind="stale" label={`Stale · ${formatAge(now, device.lastSeenAt)}`} />
          ))}
      </div>
      <p className="my-1 text-sm text-fg-muted">
        {device.type}
        {device.zone ? ` · ${device.zone}` : null}
      </p>
      <p className="my-1 text-sm text-fg-muted">
        Status: <StatusBadge kind={device.status} /> · Last seen: {formatLastSeen(device.lastSeenAt)}
      </p>
      <ul className={`mt-2 flex flex-wrap gap-x-4 gap-y-2 ${isNotLive ? "opacity-60" : ""}`}>
        {device.keyMetrics.map((metric) => (
          <li key={metric.metric} className="flex flex-col text-sm">
            <span className="text-fg-muted">{metric.metric}</span>
            <span className="font-semibold text-fg">{metric.value === null ? "—" : metric.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function formatLastSeen(lastSeenAt: number | undefined): string {
  if (lastSeenAt === undefined) return "never";
  return new Date(lastSeenAt).toLocaleTimeString();
}

function formatAge(now: number, lastSeenAt: number | undefined): string {
  if (lastSeenAt === undefined) return "never";
  const ms = Math.max(0, now - lastSeenAt);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.floor(ms / 1000)}s ago`;
  return `${minutes}m ago`;
}
