# Design tokens

`tokens.css` is the single place visual values are defined. Everything else references them with
`var(--token)`. Do not write a hard-coded color, and do not repeat a value that already has a token. If a
value you need is missing, add it to `tokens.css` and to the tables below (`tokens.test.ts` fails if the two
disagree, and `literals.test.ts` fails on color literals or token-equal font sizes in `app/`, `components/`
and `lib/`).

`globals.css` holds the base element rules (dark `color-scheme`, body, links, focus ring, native form
controls, headings). It is imported once, in `app/layout.tsx`, after `tokens.css`.

Theme: dark only for v1. Layout: desktop only, 1024px minimum.

## Colors

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#0b1020` | page background |
| `--color-surface` | `#131a2e` | cards, sidebar, top bar |
| `--color-surface-raised` | `#1b2440` | inputs, hover, selected rows |
| `--color-border` | `#2a3556` | dividers, card borders |
| `--color-text` | `#e6eaf5` | primary text |
| `--color-text-muted` | `#9aa6c4` | secondary text |
| `--color-accent` | `#5b9dff` | links, active nav, focus ring, primary fill |
| `--color-on-accent` | `#0b1020` | text on an accent (or status) fill |
| `--color-success` | `#3dd68c` | online |
| `--color-warning` | `#f5b942` | stale, warning |
| `--color-danger` | `#ff6b6b` | offline, error |
| `--color-neutral` | `#9aa6c4` | unknown |
| `--color-decommissioned` | `#909bb9` | decommissioned |
| `--color-success-bg` | `rgba(61, 214, 140, 0.14)` | success badge tint |
| `--color-warning-bg` | `rgba(245, 185, 66, 0.14)` | warning / stale tint |
| `--color-danger-bg` | `rgba(255, 107, 107, 0.14)` | danger badge tint |
| `--color-neutral-bg` | `rgba(154, 166, 196, 0.14)` | unknown / decommissioned badge tint |

Status mapping: online = success, stale = warning, offline = danger, unknown = neutral,
decommissioned = decommissioned, error = danger, warning = warning.

Status rule (R2): a status color is never the only cue. Show status with `components/StatusBadge.tsx`
(glyph plus text label), or pair the color with visible text as the existing stale card does.

## Spacing (4px base)

| Token | Value |
|---|---|
| `--space-1` | `0.25rem` |
| `--space-2` | `0.5rem` |
| `--space-3` | `0.75rem` |
| `--space-4` | `1rem` |
| `--space-5` | `1.5rem` |
| `--space-6` | `2rem` |
| `--space-7` | `3rem` |

## Typography

| Token | Value |
|---|---|
| `--font-sans` | system UI stack |
| `--font-mono` | system monospace stack |
| `--text-xs` | `0.75rem` |
| `--text-sm` | `0.85rem` |
| `--text-md` | `1rem` |
| `--text-lg` | `1.25rem` |
| `--text-xl` | `1.5rem` |
| `--leading-tight` | `1.25` |
| `--leading-normal` | `1.5` |
| `--weight-regular` | `400` |
| `--weight-semibold` | `600` |

## Radius

| Token | Value |
|---|---|
| `--radius-sm` | `4px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `12px` |
| `--radius-pill` | `999px` |

## Layout

| Token | Value |
|---|---|
| `--sidebar-width` | `14.5rem` |
| `--topbar-height` | `3.5rem` |

## Legacy values (follow-on work)

Existing screens still contain some off-scale sizes and spacing (for example `0.8rem` and `0.9rem` font
sizes, `0.15rem` margins). They do not duplicate a token, so they are left as-is until each screen is
migrated. Do not copy them into new code.
