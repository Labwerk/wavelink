"use client";

import {
  Checkbox as HeadlessCheckbox,
  Description as HeadlessDescription,
  Field as HeadlessField,
  Input as HeadlessInput,
  Label as HeadlessLabel,
  Select as HeadlessSelect,
} from "@headlessui/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cx } from "../../lib/cx";

// Headless UI's `Input`/`Select`/`Checkbox` are generic "as"-polymorphic
// components; React's `ComponentProps<typeof X>` cannot infer their default
// tag's native props through that generic call signature, so these wrapper
// prop types are spelled out against the plain HTML element instead (the
// components render that element by default and forward these props to it).
type TextInputProps = ComponentPropsWithoutRef<"input"> & { invalid?: boolean };
type SelectInputProps = ComponentPropsWithoutRef<"select"> & { invalid?: boolean };
type CheckboxInputProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
  onChange?: (checked: boolean) => void;
  "aria-label"?: string;
};

const CONTROL =
  "block w-full rounded-md bg-surface-raised border border-border px-3 py-1.5 text-sm text-fg transition-colors data-hover:border-fg-muted -outline-offset-2";

/**
 * The single form-field convention (design-system R17 #7): label above
 * control, optional description and error text below, stacked with one gap
 * token. Built on Headless UI's `Field`/`Label`/`Description`/`Input`/
 * `Select`/`Checkbox` (R16) so label/description association, hover and
 * focus state are handled correctly.
 */
export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <HeadlessField className={cx("space-y-1", className)}>{children}</HeadlessField>;
}

export function Label({ children }: { children: ReactNode }) {
  return <HeadlessLabel className="block text-sm font-medium text-fg">{children}</HeadlessLabel>;
}

export function Description({ children }: { children: ReactNode }) {
  return <HeadlessDescription className="block text-sm text-fg-muted">{children}</HeadlessDescription>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-danger">{children}</p>;
}

export function FieldGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("space-y-4", className)}>{children}</div>;
}

export function TextInput(props: TextInputProps) {
  return <HeadlessInput {...props} className={cx(CONTROL, props.className)} />;
}

export function SelectInput(props: SelectInputProps) {
  return <HeadlessSelect {...props} className={cx(CONTROL, props.className)} />;
}

export function CheckboxInput(props: CheckboxInputProps) {
  return (
    <HeadlessCheckbox
      {...props}
      className={cx(
        "group inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-raised data-checked:bg-accent data-checked:border-accent transition-colors -outline-offset-2",
        props.className,
      )}
    >
      <svg viewBox="0 0 14 14" fill="none" className="size-3 opacity-0 group-data-checked:opacity-100">
        <path d="M3 7L6 10L11 4" stroke="var(--color-on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </HeadlessCheckbox>
  );
}
