"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../backend/_generated/api";
import type { Id } from "../../../backend/_generated/dataModel";
import { DeviceDetail } from "./DeviceDetail";
import { DeviceForm, metadataToRecord, type DeviceFormValues } from "./DeviceForm";

type Status = "online" | "offline" | "unknown";
type GroupBy = "none" | "zone" | "type" | "status";

// Matches the documented default of DEVICE_HEARTBEAT_WINDOW_MS's sibling,
// DEVICE_LIST_PAGE_SIZE (backend/lib/config.ts) — kept in sync manually since
// this is a client bundle and cannot read Convex deployment env vars directly.
const PAGE_SIZE = 50;

function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const zone = searchParams.get("zone") ?? undefined;
  const type = searchParams.get("type") ?? undefined;
  const status = (searchParams.get("status") as Status | null) ?? undefined;
  const includeDecommissioned = searchParams.get("includeDecommissioned") === "true";
  const groupBy = (searchParams.get("group") as GroupBy | null) ?? "none";

  const setParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return { zone, type, status, includeDecommissioned, groupBy, setParams };
}

export function DevicesView() {
  const { zone, type, status, includeDecommissioned, groupBy, setParams } = useUrlState();
  const actor = useQuery(api.lib.access.currentActor, {});
  const isAdmin = actor?.role === "admin";

  const [selectedId, setSelectedId] = useState<Id<"devices"> | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const filterArgs = useMemo(
    () => ({ zone, type, status, includeDecommissioned: isAdmin ? includeDecommissioned : undefined }),
    [zone, type, status, includeDecommissioned, isAdmin],
  );

  const { results, status: pageStatus, loadMore } = usePaginatedQuery(
    api.devices.list,
    filterArgs,
    { initialNumItems: PAGE_SIZE },
  );
  const facets = useQuery(api.devices.facets, filterArgs);
  const registerDevice = useMutation(api.devices.register);

  const zoneChoices = facets?.zones.map((z) => z.value) ?? [];
  const typeChoices = facets?.types.map((t) => t.value) ?? [];

  async function handleRegister(values: DeviceFormValues) {
    await registerDevice({
      externalId: values.externalId,
      name: values.name,
      type: values.type,
      zone: values.zone || undefined,
      metadata: metadataToRecord(values.metadata),
    });
    setShowRegister(false);
  }

  const groupedEntries: [string, typeof results][] | null = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, typeof results>();
    for (const device of results) {
      const key =
        groupBy === "zone" ? device.zone ?? "(no zone)" : groupBy === "type" ? device.type : device.status;
      const bucket = groups.get(key) ?? [];
      bucket.push(device);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [groupBy, results]);

  const groupCounts = groupBy === "zone" ? facets?.zones : groupBy === "type" ? facets?.types : facets?.statuses;

  return (
    <main style={{ display: "flex", gap: "2rem", padding: "2rem", fontFamily: "sans-serif" }}>
      <section style={{ flex: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>Devices</h1>
          {isAdmin && <button onClick={() => setShowRegister(true)}>Register device</button>}
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
          <label>
            Zone{" "}
            <select value={zone ?? ""} onChange={(e) => setParams({ zone: e.target.value || undefined })}>
              <option value="">All</option>
              {zoneChoices.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type{" "}
            <select value={type ?? ""} onChange={(e) => setParams({ type: e.target.value || undefined })}>
              <option value="">All</option>
              {typeChoices.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status{" "}
            <select
              value={status ?? ""}
              onChange={(e) => setParams({ status: e.target.value || undefined })}
            >
              <option value="">All</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            Group by{" "}
            <select value={groupBy} onChange={(e) => setParams({ group: e.target.value })}>
              <option value="none">None</option>
              <option value="zone">Zone</option>
              <option value="type">Type</option>
              <option value="status">Status</option>
            </select>
          </label>
          {isAdmin && (
            <label>
              <input
                type="checkbox"
                checked={includeDecommissioned}
                onChange={(e) =>
                  setParams({ includeDecommissioned: e.target.checked ? "true" : undefined })
                }
              />{" "}
              Include decommissioned
            </label>
          )}
        </div>

        {groupBy !== "none" && groupCounts && (
          <p style={{ color: "#666" }}>
            {groupCounts.map((g) => `${g.value} (${g.count})`).join(" · ")}
            {facets?.truncated && " — counts truncated at scan cap"}
          </p>
        )}

        {results.length === 0 && pageStatus !== "LoadingFirstPage" && <p>No devices match these filters.</p>}

        {groupedEntries
          ? groupedEntries.map(([groupValue, devices]) => (
              <div key={groupValue} style={{ marginBottom: "1rem" }}>
                <h3>
                  {groupValue} ({devices.length})
                </h3>
                <DeviceList devices={devices} selectedId={selectedId} onSelect={setSelectedId} />
              </div>
            ))
          : <DeviceList devices={results} selectedId={selectedId} onSelect={setSelectedId} />}

        {pageStatus === "CanLoadMore" && (
          <button onClick={() => loadMore(PAGE_SIZE)}>Load more</button>
        )}
        {pageStatus === "LoadingMore" && <p>Loading more…</p>}
      </section>

      <section style={{ flex: 1 }}>
        {showRegister ? (
          <div>
            <h2>Register device</h2>
            <DeviceForm
              mode="register"
              zoneSuggestions={zoneChoices}
              typeSuggestions={typeChoices}
              submitting={false}
              onSubmit={handleRegister}
              onCancel={() => setShowRegister(false)}
            />
          </div>
        ) : selectedId ? (
          <DeviceDetail
            deviceId={selectedId}
            isAdmin={isAdmin}
            zoneSuggestions={zoneChoices}
            typeSuggestions={typeChoices}
          />
        ) : (
          <p>Select a device.</p>
        )}
      </section>
    </main>
  );
}

function DeviceList({
  devices,
  selectedId,
  onSelect,
}: {
  devices: { _id: Id<"devices">; name: string; type: string; zone?: string; status: Status; lifecycle: string }[];
  selectedId: Id<"devices"> | null;
  onSelect: (id: Id<"devices">) => void;
}) {
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {devices.map((d) => (
        <li
          key={d._id}
          onClick={() => onSelect(d._id)}
          style={{
            padding: "0.5rem",
            cursor: "pointer",
            background: selectedId === d._id ? "#eef" : "transparent",
            borderBottom: "1px solid #ddd",
          }}
        >
          <strong>{d.name}</strong> ({d.type}) — {d.lifecycle === "decommissioned" ? "decommissioned" : d.status}
          {d.zone && <span> · {d.zone}</span>}
        </li>
      ))}
    </ul>
  );
}
