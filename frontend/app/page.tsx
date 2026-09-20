"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../backend/_generated/api";
import { useNow } from "../lib/useNow";
import { ALL, FilterBar, type FilterValue } from "../components/FilterBar";
import { DeviceGrid, type GroupBy } from "../components/DeviceGrid";

const GROUP_BY_OPTIONS: readonly GroupBy[] = ["none", "zone", "type", "status"];

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

      {/* useSearchParams requires a Suspense boundary above it so the rest of
          the route can still be prerendered (see frontend/AGENTS.md — Next 16
          docs). */}
      <Suspense fallback={<p>Loading…</p>}>
        <Overview />
      </Suspense>

      {/* Needs `device.manage` (admin) - the mutation re-checks server-side. */}
      {canManageDevices && <RegisterDeviceForm />}
    </main>
  );
}

function Overview() {
  // Reactive subscription (R5): Convex pushes a new result over the open
  // WebSocket whenever a device/telemetry document this query read changes —
  // no polling, no manual refresh anywhere in this file.
  const devices = useQuery(api.liveView.overview);
  const now = useNow();
  const searchParams = useSearchParams();
  const router = useRouter();

  const filterValue: FilterValue = {
    zone: searchParams.get("zone") ?? ALL,
    type: searchParams.get("type") ?? ALL,
    status: searchParams.get("status") ?? ALL,
  };
  const groupByParam = searchParams.get("groupBy");
  const groupBy: GroupBy = GROUP_BY_OPTIONS.includes(groupByParam as GroupBy)
    ? (groupByParam as GroupBy)
    : "none";

  function updateParams(next: Partial<FilterValue> & { groupBy?: GroupBy }) {
    const params = new URLSearchParams(searchParams.toString());
    const merged = { ...filterValue, groupBy, ...next };
    for (const [key, val] of Object.entries(merged)) {
      if (!val || val === ALL || val === "none") {
        params.delete(key);
      } else {
        params.set(key, val);
      }
    }
    router.replace(params.size > 0 ? `?${params.toString()}` : "?", { scroll: false });
  }

  const zones = uniqueSorted(devices?.flatMap((d) => (d.zone ? [d.zone] : [])) ?? []);
  const types = uniqueSorted(devices?.map((d) => d.type) ?? []);
  const statuses = uniqueSorted(devices?.map((d) => d.status) ?? []);

  const filtered = (devices ?? []).filter((device) => {
    if (filterValue.zone !== ALL && device.zone !== filterValue.zone) return false;
    if (filterValue.type !== ALL && device.type !== filterValue.type) return false;
    if (filterValue.status !== ALL && device.status !== filterValue.status) return false;
    return true;
  });

  return (
    <>
      <h2>Devices</h2>
      {devices === undefined && <p>Loading…</p>}
      {devices?.length === 0 && <p>No active devices yet. Start the simulator to seed data.</p>}
      {devices !== undefined && devices.length > 0 && (
        <>
          <FilterBar
            zones={zones}
            types={types}
            statuses={statuses}
            value={filterValue}
            onChange={(next) => updateParams(next)}
          />
          <div style={{ marginBottom: "1rem", fontSize: "0.85rem" }}>
            <label>
              Group by:{" "}
              <select
                aria-label="Group by"
                value={groupBy}
                onChange={(event) => updateParams({ groupBy: event.target.value as GroupBy })}
              >
                <option value="none">None</option>
                <option value="zone">Zone</option>
                <option value="type">Type</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>
          <DeviceGrid devices={filtered} now={now} groupBy={groupBy} />
        </>
      )}
    </>
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
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
