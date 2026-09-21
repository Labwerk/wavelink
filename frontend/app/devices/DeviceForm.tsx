"use client";

import { useState } from "react";
import { ConvexError } from "convex/values";

export type FieldErrors = Record<string, string>;

export type DeviceFormValues = {
  externalId: string;
  name: string;
  type: string;
  zone: string;
  metadata: { key: string; value: string }[];
};

const EMPTY_VALUES: DeviceFormValues = {
  externalId: "",
  name: "",
  type: "",
  zone: "",
  metadata: [],
};

function metadataToRecord(rows: { key: string; value: string }[]): Record<string, string> | undefined {
  const entries = rows
    .map((r) => [r.key.trim(), r.value] as const)
    .filter(([key]) => key.length > 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function recordToMetadataRows(metadata: Record<string, string> | undefined): { key: string; value: string }[] {
  if (!metadata) return [];
  return Object.entries(metadata).map(([key, value]) => ({ key, value }));
}

/** Extracts per-field messages from a `ConvexError({ fieldErrors })` thrown by a devices mutation (R15). */
export function fieldErrorsFrom(error: unknown): FieldErrors {
  if (error instanceof ConvexError) {
    const data = error.data as { fieldErrors?: { field: string; message: string }[] };
    if (Array.isArray(data?.fieldErrors)) {
      const out: FieldErrors = {};
      for (const { field, message } of data.fieldErrors) {
        out[field] = out[field] ? `${out[field]}; ${message}` : message;
      }
      return out;
    }
  }
  return { _form: error instanceof Error ? error.message : "Something went wrong." };
}

export function DeviceForm({
  mode,
  initial,
  zoneSuggestions,
  typeSuggestions,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: "register" | "edit";
  initial?: {
    externalId: string;
    name: string;
    type: string;
    zone?: string;
    metadata?: Record<string, string>;
  };
  zoneSuggestions: string[];
  typeSuggestions: string[];
  submitting: boolean;
  onSubmit: (values: DeviceFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<DeviceFormValues>(
    initial
      ? {
          externalId: initial.externalId,
          name: initial.name,
          type: initial.type,
          zone: initial.zone ?? "",
          metadata: recordToMetadataRows(initial.metadata),
        }
      : EMPTY_VALUES,
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    try {
      await onSubmit(values);
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
    }
  }

  function updateMetadataRow(index: number, patch: Partial<{ key: string; value: string }>) {
    setValues((v) => ({
      ...v,
      metadata: v.metadata.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {errors._form && <p style={{ color: "var(--color-danger)" }}>{errors._form}</p>}

      <label>
        External identifier
        <input
          value={values.externalId}
          disabled={mode === "edit"}
          onChange={(e) => setValues((v) => ({ ...v, externalId: e.target.value }))}
          style={{ display: "block", width: "100%" }}
        />
        {mode === "edit" && (
          <small style={{ color: "var(--color-text-muted)" }}>Immutable after registration — cannot be edited.</small>
        )}
        {errors.externalId && <small style={{ color: "var(--color-danger)" }}>{errors.externalId}</small>}
      </label>

      <label>
        Name
        <input
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          style={{ display: "block", width: "100%" }}
        />
        {errors.name && <small style={{ color: "var(--color-danger)" }}>{errors.name}</small>}
      </label>

      <label>
        Type
        <input
          list="device-type-suggestions"
          value={values.type}
          onChange={(e) => setValues((v) => ({ ...v, type: e.target.value }))}
          style={{ display: "block", width: "100%" }}
        />
        <datalist id="device-type-suggestions">
          {typeSuggestions.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {errors.type && <small style={{ color: "var(--color-danger)" }}>{errors.type}</small>}
      </label>

      <label>
        Zone (optional)
        <input
          list="device-zone-suggestions"
          value={values.zone}
          onChange={(e) => setValues((v) => ({ ...v, zone: e.target.value }))}
          style={{ display: "block", width: "100%" }}
        />
        <datalist id="device-zone-suggestions">
          {zoneSuggestions.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {errors.zone && <small style={{ color: "var(--color-danger)" }}>{errors.zone}</small>}
      </label>

      <fieldset style={{ border: "1px solid var(--color-border)", padding: "var(--space-2)" }}>
        <legend>Metadata (optional)</legend>
        {values.metadata.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-1)" }}>
            <input
              placeholder="key"
              value={row.key}
              onChange={(e) => updateMetadataRow(i, { key: e.target.value })}
            />
            <input
              placeholder="value"
              value={row.value}
              onChange={(e) => updateMetadataRow(i, { value: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setValues((v) => ({ ...v, metadata: v.metadata.filter((_, j) => j !== i) }))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setValues((v) => ({ ...v, metadata: [...v.metadata, { key: "", value: "" }] }))}
        >
          Add entry
        </button>
        {errors.metadata && <p style={{ color: "var(--color-danger)" }}>{errors.metadata}</p>}
      </fieldset>

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button type="submit" disabled={submitting}>
          {mode === "register" ? "Register device" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export { metadataToRecord };
