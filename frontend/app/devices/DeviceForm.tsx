"use client";

import { Fieldset, Legend } from "@headlessui/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { Button } from "../../components/ui/Button";
import { Description, ErrorText, Field, FieldGroup, Label, TextInput } from "../../components/ui/Field";

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
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        {errors._form && <ErrorText>{errors._form}</ErrorText>}

        <Field>
          <Label>External identifier</Label>
          <TextInput
            value={values.externalId}
            disabled={mode === "edit"}
            onChange={(e) => setValues((v) => ({ ...v, externalId: e.target.value }))}
          />
          {mode === "edit" && <Description>Immutable after registration — cannot be edited.</Description>}
          {errors.externalId && <ErrorText>{errors.externalId}</ErrorText>}
        </Field>

        <Field>
          <Label>Name</Label>
          <TextInput value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
          {errors.name && <ErrorText>{errors.name}</ErrorText>}
        </Field>

        <Field>
          <Label>Type</Label>
          <TextInput
            list="device-type-suggestions"
            value={values.type}
            onChange={(e) => setValues((v) => ({ ...v, type: e.target.value }))}
          />
          <datalist id="device-type-suggestions">
            {typeSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {errors.type && <ErrorText>{errors.type}</ErrorText>}
        </Field>

        <Field>
          <Label>Zone (optional)</Label>
          <TextInput
            list="device-zone-suggestions"
            value={values.zone}
            onChange={(e) => setValues((v) => ({ ...v, zone: e.target.value }))}
          />
          <datalist id="device-zone-suggestions">
            {zoneSuggestions.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          {errors.zone && <ErrorText>{errors.zone}</ErrorText>}
        </Field>

        <Fieldset className="rounded-md border border-border p-2 space-y-2">
          <Legend className="text-sm font-medium text-fg">Metadata (optional)</Legend>
          {values.metadata.map((row, i) => (
            <div key={i} className="flex gap-2">
              <Field className="flex-1">
                <Label>Key</Label>
                <TextInput value={row.key} onChange={(e) => updateMetadataRow(i, { key: e.target.value })} />
              </Field>
              <Field className="flex-1">
                <Label>Value</Label>
                <TextInput value={row.value} onChange={(e) => updateMetadataRow(i, { value: e.target.value })} />
              </Field>
              <Button
                type="button"
                variant="secondary"
                className="self-end"
                onClick={() => setValues((v) => ({ ...v, metadata: v.metadata.filter((_, j) => j !== i) }))}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => setValues((v) => ({ ...v, metadata: [...v.metadata, { key: "", value: "" }] }))}
          >
            Add entry
          </Button>
          {errors.metadata && <ErrorText>{errors.metadata}</ErrorText>}
        </Fieldset>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "register" ? "Register device" : "Save changes"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

export { metadataToRecord };
