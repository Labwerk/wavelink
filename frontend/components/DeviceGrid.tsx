"use client";

import { DeviceCard, type DeviceCardDevice } from "./DeviceCard";
import styles from "./DeviceGrid.module.css";

export type GroupBy = "none" | "zone" | "type" | "status";

/**
 * Renders the (already filtered, client-side) device list, optionally
 * grouped by zone/type/status (R7). Each device renders through
 * `DeviceCard`, so R1/R2/R6 behavior is identical whether grouped or not.
 */
export function DeviceGrid({
  devices,
  now,
  groupBy,
}: {
  devices: readonly DeviceCardDevice[];
  now: number;
  groupBy: GroupBy;
}) {
  if (devices.length === 0) {
    return <p className={styles.empty}>No devices match the current filters.</p>;
  }

  if (groupBy === "none") {
    return <Grid devices={devices} now={now} />;
  }

  const groups = new Map<string, DeviceCardDevice[]>();
  for (const device of devices) {
    const key = groupKey(device, groupBy);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(device);
    } else {
      groups.set(key, [device]);
    }
  }

  return (
    <>
      {Array.from(groups.entries()).map(([key, groupDevices]) => (
        <section key={key} className={styles.group}>
          <h2 className={styles.groupHeading}>{key}</h2>
          <Grid devices={groupDevices} now={now} />
        </section>
      ))}
    </>
  );
}

function Grid({ devices, now }: { devices: readonly DeviceCardDevice[]; now: number }) {
  return (
    <div className={styles.grid}>
      {devices.map((device) => (
        <DeviceCard key={device.deviceId} device={device} now={now} />
      ))}
    </div>
  );
}

function groupKey(device: DeviceCardDevice, groupBy: GroupBy): string {
  switch (groupBy) {
    case "zone":
      return device.zone ?? "(no zone)";
    case "type":
      return device.type;
    case "status":
      return device.status;
    default:
      return "";
  }
}
