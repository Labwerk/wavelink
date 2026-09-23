"use client";

import { Button } from "./ui/Button";
import { Field, Label, SelectInput } from "./ui/Field";

/** Sentinel for "no filter selected on this field" — kept out of the URL param. */
export const ALL = "";

export interface FilterValue {
  zone: string;
  type: string;
  status: string;
}

/**
 * Filter the overview by zone/type/status (R7), matching the three fields
 * foundation §6.1 req. 4 names for the device list — this feature treats the
 * overview screen *as* the device list (no separate filter/grouping
 * capability exists yet to be consistent with, per plan.md's "Risks &
 * unknowns"). Selections live in the caller's state, mirrored to URL search
 * params by `app/page.tsx` so a filtered view is shareable/reload-safe.
 */
export function FilterBar({
  zones,
  types,
  statuses,
  value,
  onChange,
}: {
  zones: readonly string[];
  types: readonly string[];
  statuses: readonly string[];
  value: FilterValue;
  onChange: (next: FilterValue) => void;
}) {
  const isFiltered = value.zone !== ALL || value.type !== ALL || value.status !== ALL;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <Field>
        <Label>Zone</Label>
        <SelectInput
          aria-label="Filter by zone"
          value={value.zone}
          onChange={(event) => onChange({ ...value, zone: event.target.value })}
        >
          <option value={ALL}>All zones</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field>
        <Label>Type</Label>
        <SelectInput
          aria-label="Filter by type"
          value={value.type}
          onChange={(event) => onChange({ ...value, type: event.target.value })}
        >
          <option value={ALL}>All types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field>
        <Label>Status</Label>
        <SelectInput
          aria-label="Filter by status"
          value={value.status}
          onChange={(event) => onChange({ ...value, status: event.target.value })}
        >
          <option value={ALL}>All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </SelectInput>
      </Field>
      {isFiltered && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange({ zone: ALL, type: ALL, status: ALL })}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}
