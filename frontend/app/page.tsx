"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { FormEvent, useState } from "react";
import { api } from "../../backend/_generated/api";
import type { Id } from "../../backend/_generated/dataModel";

export default function DashboardPage() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  if (isLoading) {
    return (
      <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <p>Loading…</p>
      </main>
    );
  }

  return isAuthenticated ? <Dashboard /> : <SignInScreen />;
}

// Spec `specs/auth-roles/spec.md` R10/R1: unauthenticated visitors see a
// sign-in screen instead of the dashboard. Server-side checks (every
// query/mutation) remain the real enforcement point regardless of this UI.
function SignInScreen() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    formData.set("flow", flow);
    try {
      await signIn("password", formData);
    } catch {
      setError(
        flow === "signIn"
          ? "Invalid email or password."
          : "Could not create an account with those details.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 360,
        margin: "4rem auto",
        padding: "2rem",
        fontFamily: "sans-serif",
      }}
    >
      <h1>Wavelink</h1>
      <p>{flow === "signIn" ? "Sign in" : "Create an account"} to view the dashboard.</p>
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={flow === "signIn" ? "current-password" : "new-password"}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {flow === "signIn" ? "Sign in" : "Sign up"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
        style={{
          marginTop: "1rem",
          background: "none",
          border: "none",
          color: "#2454a6",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {flow === "signIn" ? "Need an account? Sign up" : "Already have an account? Sign in"}
      </button>
      <p style={{ marginTop: "1.5rem", fontSize: "0.85rem", color: "#666" }}>
        The first account ever created on a fresh deployment becomes an admin
        automatically. Every account after that starts as a viewer until an
        admin promotes it.
      </p>
    </main>
  );
}

function Dashboard() {
  const { signOut } = useAuthActions();
  // Own profile + role, for client-side UI gating only (spec R6) — every
  // admin-only mutation below is still re-checked server-side (R2).
  const me = useQuery(api.users.me);
  const devices = useQuery(api.devices.listActive);
  const [selectedId, setSelectedId] = useState<Id<"devices"> | null>(null);
  const isAdmin = me?.role === "admin";

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
          {me && (
            <p style={{ margin: 0, color: "#666" }}>
              Signed in as {me.email} ({me.role})
            </p>
          )}
        </div>
        <button onClick={() => void signOut()}>Sign out</button>
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
          {/* Admin-only per spec §4 Role Matrix (devices.register) — the
              mutation itself re-checks the role server-side regardless. */}
          {isAdmin && <RegisterDeviceForm />}
        </section>
        <section style={{ flex: 1 }}>
          <h2>Detail</h2>
          {selectedId ? (
            <DeviceDetail
              deviceId={selectedId}
              isAdmin={isAdmin}
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
  isAdmin,
  onDeactivated,
}: {
  deviceId: Id<"devices">;
  isAdmin: boolean;
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
      {/* Admin-only per spec §4 Role Matrix (devices.deactivate). */}
      {isAdmin && device.isActive && (
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
