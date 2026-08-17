"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../backend/_generated/api";
import type { Id } from "../../backend/_generated/dataModel";

export default function DashboardPage() {
  const devices = useQuery(api.devices.listActive);
  const [selectedId, setSelectedId] = useState<Id<"devices"> | null>(null);

  return (
    <main style={{ display: "flex", gap: "2rem", padding: "2rem", fontFamily: "sans-serif" }}>
      <section style={{ flex: 1 }}>
        <h1>Devices</h1>
        {devices === undefined && <p>Loading…</p>}
        {devices?.length === 0 && <p>No active devices yet. Start the simulator to seed data.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {devices?.map((d) => (
            <li
              key={d._id}
              onClick={() => setSelectedId(d._id)}
              style={{
                padding: "0.5rem",
                cursor: "pointer",
                background: selectedId === d._id ? "#eef" : "transparent",
                borderBottom: "1px solid #ddd",
              }}
            >
              <strong>{d.name}</strong> ({d.type}) — {d.status}
              {d.zone && <span> · {d.zone}</span>}
            </li>
          ))}
        </ul>
      </section>
      <section style={{ flex: 1 }}>
        <h1>Detail</h1>
        {selectedId ? <DeviceDetail deviceId={selectedId} /> : <p>Select a device.</p>}
      </section>
    </main>
  );
}

function DeviceDetail({ deviceId }: { deviceId: Id<"devices"> }) {
  const device = useQuery(api.devices.get, { deviceId });
  const readings = useQuery(api.telemetry.latestForDevice, { deviceId });

  if (device === undefined) return <p>Loading…</p>;
  if (device === null) return <p>Device not found.</p>;

  return (
    <div>
      <h2>{device.name}</h2>
      <p>
        Status: {device.status} · Last seen:{" "}
        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleTimeString() : "never"}
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Metric</th>
            <th style={{ textAlign: "left" }}>Value</th>
            <th style={{ textAlign: "left" }}>At</th>
          </tr>
        </thead>
        <tbody>
          {readings?.map((r) => (
            <tr key={r._id}>
              <td>{r.metric}</td>
              <td>{r.value}</td>
              <td>{new Date(r.ts).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
