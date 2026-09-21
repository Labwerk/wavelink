"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../backend/_generated/api";
import type { Id } from "../../../backend/_generated/dataModel";
import { DeviceForm, fieldErrorsFrom, metadataToRecord, type DeviceFormValues } from "./DeviceForm";

const CONNECTIVITY_LABEL: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Unknown",
};

const CONNECTIVITY_COLOR: Record<string, string> = {
  online: "var(--color-success)",
  offline: "var(--color-danger)",
  unknown: "var(--color-neutral)",
};

function Badge({ children, color, muted }: { children: React.ReactNode; color: string; muted?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem var(--space-2)",
        borderRadius: "var(--radius-pill)",
        fontSize: "0.8rem",
        fontWeight: "var(--weight-semibold)",
        color: "var(--color-on-accent)",
        background: color,
        opacity: muted ? 0.55 : 1,
      }}
    >
      {children}
    </span>
  );
}

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
  const [showHistory, setShowHistory] = useState(false);
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
      <div>
        <h2>Edit {device.name}</h2>
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
    <div>
      <h2>{device.name}</h2>
      <p style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        {/* R28: lifecycle is rendered separately and more prominently than connectivity —
            a decommissioned device is never shown merely as "offline". */}
        <Badge color={isDecommissioned ? "var(--color-decommissioned)" : "var(--color-accent)"}>
          {isDecommissioned ? "Decommissioned" : "In service"}
        </Badge>
        <Badge color={CONNECTIVITY_COLOR[device.status]} muted={isDecommissioned}>
          {CONNECTIVITY_LABEL[device.status]}
        </Badge>
      </p>
      <p>
        External ID: <code>{device.externalId}</code> · Type: {device.type}
        {device.zone && <> · Zone: {device.zone}</>}
      </p>
      <p>Last seen: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "never"}</p>
      {device.metadata && Object.keys(device.metadata).length > 0 && (
        <ul>
          {Object.entries(device.metadata).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
      )}
      {(device.rejectedReadingCount ?? 0) > 0 && (
        <p style={{ color: "var(--color-warning)" }}>
          {device.rejectedReadingCount} reading(s) rejected while decommissioned
          {device.lastRejectedReadingAt
            ? ` (last at ${new Date(device.lastRejectedReadingAt).toLocaleString()})`
            : ""}
          .
        </p>
      )}

      {isAdmin && (
        <div style={{ display: "flex", gap: "var(--space-2)", margin: "var(--space-2) 0" }}>
          <button onClick={() => setEditing(true)} disabled={isDecommissioned}>
            Edit
          </button>
          <button onClick={handleLifecycleToggle}>
            {isDecommissioned ? "Reactivate" : "Decommission"}
          </button>
        </div>
      )}
      {actionError && <p style={{ color: "var(--color-danger)" }}>{actionError}</p>}

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

      {isAdmin && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <button onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide" : "Show"} change history
          </button>
          {showHistory && (
            <table style={{ marginTop: "var(--space-2)" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>When</th>
                  <th style={{ textAlign: "left" }}>Who</th>
                  <th style={{ textAlign: "left" }}>Action</th>
                  <th style={{ textAlign: "left" }}>Changes</th>
                </tr>
              </thead>
              <tbody>
                {history?.map((h) => (
                  <tr key={h._id}>
                    <td>{new Date(h.at).toLocaleString()}</td>
                    <td>{h.actorId ? (emailById.get(h.actorId) ?? h.actorId) : "deployment admin key"}</td>
                    <td>{h.action}</td>
                    <td>
                      {!h.changes || h.changes.length === 0
                        ? "—"
                        : h.changes
                            .map((c) => `${c.field}: ${c.before ?? "∅"} → ${c.after ?? "∅"}`)
                            .join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
