"use client";

import { Suspense } from "react";
import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../backend/_generated/api";
import { useNow } from "../lib/useNow";
import { ALL, FilterBar, type FilterValue } from "../components/FilterBar";
import { DeviceGrid, type GroupBy } from "../components/DeviceGrid";

const GROUP_BY_OPTIONS: readonly GroupBy[] = ["none", "zone", "type", "status"];

// The proxy (frontend/proxy.ts) already sends signed-out visitors to /signin
// (R1); the signed-in header (email/role, sign-out, admin/devices links)
// lives in `SiteHeader` (frontend/app/SiteHeader.tsx), rendered from the
// root layout so it's shared with the device registry at /devices instead
// of duplicated here. Device registration/editing/decommissioning is that
// registry's job (explicit non-goal — specs/live-telemetry-view/spec.md);
// this page is read-only live status.
export default function LiveOverviewPage() {
  // useSearchParams requires a Suspense boundary above it so the rest of the
  // route can still be prerendered (see frontend/AGENTS.md — Next 16 docs).
  return (
    <Suspense fallback={<main style={{ padding: "2rem" }}>Loading…</main>}>
      <Overview />
    </Suspense>
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
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Devices</h1>
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
    </main>
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}
