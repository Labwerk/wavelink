"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "../../backend/_generated/api";
import type { Id } from "../../backend/_generated/dataModel";

// The proxy (frontend/proxy.ts) already sends signed-out visitors to /signin
// (R1). Everything below is gated on the capability list returned by
// `users.me` - cosmetic only (R8/R9); every query/mutation re-checks the
// caller's role on the server.
export default function DashboardPage() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const me = useQuery(api.users.me);

  async function handleSignOut() {
    await signOut();
    router.replace("/signin");
  }

  if (me === undefined) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <p>Loading…</p>
      </main>
    );
  }

  if (me === null) {
    // Signed out server-side, or the account was deactivated.
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <p>Your session is no longer valid.</p>
        <button onClick={() => void handleSignOut()}>Back to sign in</button>
      </main>
    );
  }

  return (
    <Dashboard
      me={me}
      capabilities={new Set<string>(me.capabilities)}
      onSignOut={() => void handleSignOut()}
    />
  );
}

function Dashboard({
  me,
  capabilities,
  onSignOut,
}: {
  me: { email: string; role: string };
  capabilities: Set<string>;
  onSignOut: () => void;
}) {
  const devices = useQuery(api.devices.listActive);
  const [selectedId, setSelectedId] = useState<Id<"devices"> | null>(null);
  const canManageDevices = capabilities.has("device.manage");
  const canManageUsers = capabilities.has("user.manage");

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Wavelink</h1>
          <p style={{ margin: 0, color: "#666" }}>
            Signed in as {me.email} ({me.role})
          </p>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          {canManageUsers && <Link href="/admin/users">Manage users</Link>}
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <div style={{ display: "flex", gap: "2rem" }}>
        <section style={{ flex: 1 }}>
          <h2>Devices</h2>
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
          {/* Needs `device.manage` (admin) - the mutation re-checks server-side. */}
          {canManageDevices && <RegisterDeviceForm />}
        </section>
        <section style={{ flex: 1 }}>
          <h2>Detail</h2>
          {selectedId ? (
            <DeviceDetail
              deviceId={selectedId}
              canManageDevices={canManageDevices}
              onDeactivated={() => setSelectedId(null)}
            />
          ) : (
            <p>Select a device.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function RegisterDeviceForm() {
  const register = useMutation(api.devices.register);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const zone = data.get("zone");
    try {
      await register({
        externalId: String(data.get("externalId") ?? ""),
        name: String(data.get("name") ?? ""),
        type: String(data.get("type") ?? ""),
        zone: zone ? String(zone) : undefined,
      });
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register device.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: "1.5rem", borderTop: "1px solid #ddd", paddingTop: "1rem" }}
    >
      <h3>Register device (admin)</h3>
      <div style={{ display: "grid", gap: "0.5rem", maxWidth: 320 }}>
        <input name="externalId" placeholder="External ID" required />
        <input name="name" placeholder="Display name" required />
        <input name="type" placeholder="Type (e.g. cnc-mill)" required />
        <input name="zone" placeholder="Zone (optional)" />
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <button type="submit">Register</button>
      </div>
    </form>
  );
}

function DeviceDetail({
  deviceId,
  canManageDevices,
  onDeactivated,
}: {
  deviceId: Id<"devices">;
  canManageDevices: boolean;
  onDeactivated: () => void;
}) {
  const device = useQuery(api.devices.get, { deviceId });
  const readings = useQuery(api.telemetry.latestForDevice, { deviceId });
  const deactivate = useMutation(api.devices.deactivate);

  if (device === undefined) return <p>Loading…</p>;
  if (device === null) return <p>Device not found.</p>;

  return (
    <div>
      <h2>{device.name}</h2>
      <p>
        Status: {device.status} · Last seen:{" "}
        {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleTimeString() : "never"}
      </p>
      {/* Needs `device.manage` (admin). */}
      {canManageDevices && device.isActive && (
        <button
          onClick={async () => {
            await deactivate({ deviceId });
            onDeactivated();
          }}
        >
          Deactivate (admin)
        </button>
      )}
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
