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
  online: "#1a7f37",
  offline: "#b42318",
  unknown: "#666",
};

function Badge({ children, color, muted }: { children: React.ReactNode; color: string; muted?: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: "999px",
        fontSize: "0.8rem",
        fontWeight: 600,
        color: "#fff",
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
    await updateDevice({
      deviceId,
      name: values.name,
      type: values.type,
      zone: values.zone,
      metadata: metadataToRecord(values.metadata),
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
      <p style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {/* R28: lifecycle is rendered separately and more prominently than connectivity —
            a decommissioned device is never shown merely as "offline". */}
        <Badge color={isDecommissioned ? "#555" : "#0b5fff"}>
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
        <p style={{ color: "#b45309" }}>
          {device.rejectedReadingCount} reading(s) rejected while decommissioned
          {device.lastRejectedReadingAt
            ? ` (last at ${new Date(device.lastRejectedReadingAt).toLocaleString()})`
            : ""}
          .
        </p>
      )}

      {isAdmin && (
        <div style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0" }}>
          <button onClick={() => setEditing(true)} disabled={isDecommissioned}>
            Edit
          </button>
          <button onClick={handleLifecycleToggle}>
            {isDecommissioned ? "Reactivate" : "Decommission"}
          </button>
        </div>
      )}
      {actionError && <p style={{ color: "crimson" }}>{actionError}</p>}

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
        <div style={{ marginTop: "1rem" }}>
          <button onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide" : "Show"} change history
          </button>
          {showHistory && (
            <table style={{ marginTop: "0.5rem" }}>
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
                    <td>{h.actorLabel}</td>
                    <td>{h.action}</td>
                    <td>
                      {h.changes.length === 0
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
