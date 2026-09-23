"use client";

import { DeviceCard, type DeviceCardDevice } from "./DeviceCard";
import { StatusBadge, type StatusKind } from "./StatusBadge";

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
    return <p className="text-fg-muted">No devices match the current filters.</p>;
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
    <div className="space-y-6">
      {Array.from(groups.entries()).map(([key, groupDevices]) => (
        <section key={key}>
          <h2 className="mb-2 text-base font-semibold text-fg">
            {groupBy === "status" ? <StatusBadge kind={key as StatusKind} /> : key}
          </h2>
          <Grid devices={groupDevices} now={now} />
        </section>
      ))}
    </div>
  );
}

function Grid({ devices, now }: { devices: readonly DeviceCardDevice[]; now: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
