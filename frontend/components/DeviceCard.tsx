"use client";

import Link from "next/link";
import { classifyFreshness } from "../lib/freshness";
import styles from "./DeviceCard.module.css";

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
 * One device's tile on the overview screen (R1, R2). Status and last-seen
 * are rendered verbatim from `device` (R1); staleness (R6) is a *separate*
 * affordance layered on top — a text badge plus muted metric values, never
 * colour alone, so it's still testable/visible without relying on colour.
 */
export function DeviceCard({ device, now }: { device: DeviceCardDevice; now: number }) {
  const freshness = classifyFreshness({
    lastSeenAt: device.lastSeenAt,
    expectedIntervalMs: device.expectedIntervalMs,
    now,
  });
  const isNotLive = freshness !== "live";

  return (
    <Link
      href={`/devices/${device.deviceId}`}
      className={styles.card}
      data-freshness={freshness}
    >
      <div className={styles.header}>
        <span className={styles.name}>{device.name}</span>
        {isNotLive && (
          <span className={styles.staleBadge}>
            ⚠ {freshness === "never" ? "Never reported" : `Stale · ${formatAge(now, device.lastSeenAt)}`}
          </span>
        )}
      </div>
      <p className={styles.meta}>
        {device.type}
        {device.zone ? ` · ${device.zone}` : null}
      </p>
      <p className={styles.status}>
        Status: <strong>{device.status}</strong> · Last seen: {formatLastSeen(device.lastSeenAt)}
      </p>
      <ul className={isNotLive ? `${styles.metrics} ${styles.metricsMuted}` : styles.metrics}>
        {device.keyMetrics.map((metric) => (
          <li key={metric.metric} className={styles.metric}>
            <span className={styles.metricName}>{metric.metric}</span>
            <span className={styles.metricValue}>
              {metric.value === null ? "—" : metric.value}
            </span>
          </li>
        ))}
      </ul>
    </Link>
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
