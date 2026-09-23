"use client";

import { Button as HeadlessButton, type ButtonProps as HeadlessButtonProps } from "@headlessui/react";
import { cx } from "../../lib/cx";

export type ButtonVariant = "primary" | "secondary";

const BASE =
  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors data-disabled:text-fg-muted";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent data-hover:bg-accent-hover data-active:bg-accent",
  secondary:
    "bg-surface-raised text-fg border border-border data-hover:bg-surface-hover data-active:bg-surface",
};

/**
 * The single button convention (design-system R17 #8): two variants,
 * primary (accent fill) and secondary (surface). Built on Headless UI's
 * `Button` (R16) so disabled/hover/active/focus state is handled correctly
 * and consistently. `buttonClasses` is exported for `as={Button}` use on
 * another Headless primitive (e.g. `DisclosureButton`).
 */
export function buttonClasses(variant: ButtonVariant = "secondary"): string {
  return cx(BASE, VARIANT[variant]);
}

export interface ButtonProps extends Omit<HeadlessButtonProps<"button">, "className"> {
  variant?: ButtonVariant;
  className?: string;
}

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  return <HeadlessButton className={cx(buttonClasses(variant), className)} {...props} />;
}
