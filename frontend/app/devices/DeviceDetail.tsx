"use client";

import { useMutation, useQuery } from "convex/react";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { api } from "../../../backend/_generated/api";
import type { Id } from "../../../backend/_generated/dataModel";
import { StatusBadge } from "../../components/StatusBadge";
import { Button, buttonClasses } from "../../components/ui/Button";
import { TBody, Td, Th, THead, Table, Tr } from "../../components/ui/Table";
import { useState } from "react";
import { DeviceForm, fieldErrorsFrom, metadataToRecord, type DeviceFormValues } from "./DeviceForm";

export function DeviceDetail({
  deviceId,
  isAdmin,
  zoneSuggestions,
  typeSuggestions,
}: {
  deviceId: Id<"devices">;
  isAdmin: boolean;
  zoneSuggestions: string[];
  typeSuggestions: string[];
}) {
  const device = useQuery(api.devices.get, { deviceId });
  const readings = useQuery(api.telemetry.latestForDevice, { deviceId });
  const history = useQuery(api.devices.changeHistory, isAdmin ? { deviceId } : "skip");
  const users = useQuery(api.users.list, isAdmin ? {} : "skip");
  const emailById = new Map(users?.map((u) => [u._id, u.email]));

  const updateDevice = useMutation(api.devices.update);
  const decommission = useMutation(api.devices.decommission);
  const reactivate = useMutation(api.devices.reactivate);

  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (device === undefined) return <p>Loading…</p>;
  if (device === null) return <p>Device not found.</p>;

  const isDecommissioned = device.lifecycle === "decommissioned";

  async function handleEditSubmit(values: DeviceFormValues) {
    const hadMetadata = Object.keys(device?.metadata ?? {}).length > 0;
    await updateDevice({
      deviceId,
      name: values.name,
      type: values.type,
      zone: values.zone,
      // The edit form always represents the full metadata set, so an empty
      // list means "clear it" — send {} rather than metadataToRecord's
      // undefined (which `devices.update` reads as "leave unchanged").
      // Only do that when the device actually had metadata to clear;
      // otherwise omit the field so an untouched, always-empty metadata
      // section doesn't log a spurious "metadata changed" audit entry.
      metadata: metadataToRecord(values.metadata) ?? (hadMetadata ? {} : undefined),
    });
    setEditing(false);
  }

  async function handleLifecycleToggle() {
    setActionError(null);
    try {
      if (isDecommissioned) {
        await reactivate({ deviceId });
      } else {
        await decommission({ deviceId });
      }
    } catch (error) {
      setActionError(fieldErrorsFrom(error)._form ?? "Action failed.");
    }
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-fg">Edit {device.name}</h2>
        <DeviceForm
          mode="edit"
          initial={{
            externalId: device.externalId,
            name: device.name,
            type: device.type,
            zone: device.zone,
            metadata: device.metadata,
          }}
          zoneSuggestions={zoneSuggestions}
          typeSuggestions={typeSuggestions}
          submitting={false}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-fg">{device.name}</h2>
      <p className="flex items-center gap-2">
        {/* R28: lifecycle is rendered separately and more prominently than connectivity —
            a decommissioned device is never shown merely as "offline". */}
        <StatusBadge kind={isDecommissioned ? "decommissioned" : "active"} label={isDecommissioned ? undefined : "In service"} />
        <StatusBadge kind={device.status} />
      </p>
      <p>
        External ID: <code>{device.externalId}</code> · Type: {device.type}
        {device.zone && <> · Zone: {device.zone}</>}
      </p>
      <p>Last seen: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "never"}</p>
      {device.metadata && Object.keys(device.metadata).length > 0 && (
        <ul className="space-y-1">
          {Object.entries(device.metadata).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
      )}
      {(device.rejectedReadingCount ?? 0) > 0 && (
        <p className="text-warning">
          {device.rejectedReadingCount} reading(s) rejected while decommissioned
          {device.lastRejectedReadingAt
            ? ` (last at ${new Date(device.lastRejectedReadingAt).toLocaleString()})`
            : ""}
          .
        </p>
      )}

      {isAdmin && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={isDecommissioned}>
            Edit
          </Button>
          <Button variant="secondary" onClick={handleLifecycleToggle}>
            {isDecommissioned ? "Reactivate" : "Decommission"}
          </Button>
        </div>
      )}
      {actionError && <p className="text-danger">{actionError}</p>}

      <Table>
        <THead>
          <Tr>
            <Th>Metric</Th>
            <Th>Value</Th>
            <Th>At</Th>
          </Tr>
        </THead>
        <TBody>
          {readings?.map((r) => (
            <Tr key={r._id}>
              <Td>{r.metric}</Td>
              <Td>{r.value}</Td>
              <Td>{new Date(r.ts).toLocaleTimeString()}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {isAdmin && (
        <Disclosure>
          {({ open }) => (
            <>
              <DisclosureButton className={buttonClasses("secondary")}>
                {open ? "Hide" : "Show"} change history
              </DisclosureButton>
              <DisclosurePanel className="mt-2">
                <Table>
                  <THead>
                    <Tr>
                      <Th>When</Th>
                      <Th>Who</Th>
                      <Th>Action</Th>
                      <Th>Changes</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {history?.map((h) => (
                      <Tr key={h._id}>
                        <Td>{new Date(h.at).toLocaleString()}</Td>
                        <Td>{h.actorId ? (emailById.get(h.actorId) ?? h.actorId) : "deployment admin key"}</Td>
                        <Td>{h.action}</Td>
                        <Td>
                          {!h.changes || h.changes.length === 0
                            ? "—"
                            : h.changes
                                .map((c) => `${c.field}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`)
                                .join("; ")}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
    </div>
  );
}
