"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../backend/_generated/api";
import type { Id } from "../../../backend/_generated/dataModel";
import { StatusBadge, type StatusKind } from "../../components/StatusBadge";
import { Button } from "../../components/ui/Button";
import { CheckboxInput, Field, Label, SelectInput } from "../../components/ui/Field";
import { PageHeading } from "../../components/ui/PageHeading";
import { SelectableList, SelectableListItem } from "../../components/ui/SelectableList";
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
  const me = useQuery(api.users.me);
  const isAdmin = me?.capabilities.includes("device.manage") ?? false;

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
  // Unfiltered, for the register/edit form's zone/type suggestions — a new or
  // edited device isn't constrained by whatever the list happens to be
  // filtered to right now, so its suggestions shouldn't be either (unlike
  // zoneChoices/typeChoices below, which intentionally reflect the active
  // filter so the dropdowns never offer a combination with zero results).
  const allFacets = useQuery(api.devices.facets, {});
  const registerDevice = useMutation(api.devices.register);

  const zoneChoices = facets?.zones.map((z) => z.value) ?? [];
  const typeChoices = facets?.types.map((t) => t.value) ?? [];
  const allZoneChoices = allFacets?.zones.map((z) => z.value) ?? [];
  const allTypeChoices = allFacets?.types.map((t) => t.value) ?? [];

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
    <main className="space-y-6">
      <PageHeading actions={isAdmin && <Button variant="primary" onClick={() => setShowRegister(true)}>Register device</Button>}>
        Devices
      </PageHeading>

      <div className="flex gap-8">
        <section className="flex-1 space-y-4">
          <div className="flex flex-wrap gap-4">
            <Field>
              <Label>Zone</Label>
              <SelectInput value={zone ?? ""} onChange={(e) => setParams({ zone: e.target.value || undefined })}>
                <option value="">All</option>
                {zoneChoices.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field>
              <Label>Type</Label>
              <SelectInput value={type ?? ""} onChange={(e) => setParams({ type: e.target.value || undefined })}>
                <option value="">All</option>
                {typeChoices.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field>
              <Label>Status</Label>
              <SelectInput value={status ?? ""} onChange={(e) => setParams({ status: e.target.value || undefined })}>
                <option value="">All</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="unknown">Unknown</option>
              </SelectInput>
            </Field>
            <Field>
              <Label>Group by</Label>
              <SelectInput value={groupBy} onChange={(e) => setParams({ group: e.target.value })}>
                <option value="none">None</option>
                <option value="zone">Zone</option>
                <option value="type">Type</option>
                <option value="status">Status</option>
              </SelectInput>
            </Field>
            {isAdmin && (
              <Field className="flex-row items-center gap-2 self-end">
                <CheckboxInput
                  checked={includeDecommissioned}
                  onChange={(checked) => setParams({ includeDecommissioned: checked ? "true" : undefined })}
                />
                <Label>Include decommissioned</Label>
              </Field>
            )}
          </div>

          {groupBy !== "none" && groupCounts && (
            <p className="text-fg-muted">
              {groupCounts.map((g) => `${g.value} (${g.count})`).join(" · ")}
              {facets?.truncated && " — counts truncated at scan cap"}
            </p>
          )}

          {/* Some filters are applied residually after the server-side page fetch
              (facets(), backend/devices.ts), so an empty page doesn't mean no
              matches exist elsewhere — only "Exhausted" (no more pages left) does. */}
          {results.length === 0 && pageStatus === "Exhausted" && <p>No devices match these filters.</p>}

          {groupedEntries
            ? groupedEntries.map(([groupValue, devices]) => (
                <div key={groupValue} className="mb-4">
                  <h3 className="mb-2 text-base font-semibold text-fg">
                    {groupBy === "status" ? (
                      <StatusBadge kind={groupValue as StatusKind} />
                    ) : (
                      groupValue
                    )}{" "}
                    ({devices.length})
                  </h3>
                  <DeviceList devices={devices} selectedId={selectedId} onSelect={setSelectedId} />
                </div>
              ))
            : <DeviceList devices={results} selectedId={selectedId} onSelect={setSelectedId} />}

          {pageStatus === "CanLoadMore" && (
            <Button variant="secondary" onClick={() => loadMore(PAGE_SIZE)}>
              Load more
            </Button>
          )}
          {pageStatus === "LoadingMore" && <p>Loading more…</p>}
        </section>

        <section className="flex-1">
          {showRegister ? (
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-fg">Register device</h2>
              <DeviceForm
                mode="register"
                zoneSuggestions={allZoneChoices}
                typeSuggestions={allTypeChoices}
                submitting={false}
                onSubmit={handleRegister}
                onCancel={() => setShowRegister(false)}
              />
            </div>
          ) : selectedId ? (
            <DeviceDetail
              deviceId={selectedId}
              isAdmin={isAdmin}
              zoneSuggestions={allZoneChoices}
              typeSuggestions={allTypeChoices}
            />
          ) : (
            <p>Select a device.</p>
          )}
        </section>
      </div>
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
    <SelectableList>
      {devices.map((d) => (
        <SelectableListItem key={d._id} selected={selectedId === d._id} onClick={() => onSelect(d._id)}>
          <strong>{d.name}</strong> ({d.type}) —{" "}
          <StatusBadge kind={d.lifecycle === "decommissioned" ? "decommissioned" : (d.status as StatusKind)} />
          {d.zone && <span> · {d.zone}</span>}
        </SelectableListItem>
      ))}
    </SelectableList>
  );
}
