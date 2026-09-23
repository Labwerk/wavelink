# Design tokens & UI conventions

`tokens.css` is a Tailwind v4 `@theme` block — the single place visual values are defined
(design-system R1, R15). Every token there becomes both a Tailwind utility (`--color-accent` ->
`bg-accent`/`text-accent`/`border-accent`) and a plain CSS custom property (`var(--color-accent)`).
Do not write a hard-coded color, spacing, shadow or duration value anywhere else — use the matching
utility class. If a value you need is missing, add it to `tokens.css` and to the tables below
(`tokens.test.ts` fails if the two disagree; `literals.test.ts` bans arbitrary values, raw palette
names, and numeric spacing/sizing steps outside the allowed set).

`globals.css` is `@import "tailwindcss"; @import "./tokens.css";` plus a minimal `@layer base` (dark
`color-scheme`, body defaults, the focus-ring convention, plain inline links, `h2`/`h3` sizes). It is
imported once, in `app/layout.tsx`.

Theme: dark only for v1 (no `dark:` variant anywhere). Layout: desktop only, `min-w-5xl` (1024px) minimum.

The default Tailwind namespaces this theme replaces (`--color-*`, `--text-*`, `--font-*`,
`--font-weight-*`, `--leading-*`, `--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`,
`--text-shadow-*`, `--ease-*`, `--animate-*`) are reset to `initial` in `tokens.css`, so only the tokens
below generate utilities — there is no `bg-gray-800` or `shadow-lg` to reach for by mistake.

## Colors

| Token | Value | Use |
|---|---|---|
| `--color-canvas` | `#0b1020` | page background (`bg-canvas`) |
| `--color-surface` | `#131a2e` | cards, sidebar, top bar (`bg-surface`) |
| `--color-surface-raised` | `#1b2440` | inputs, hover, selected rows (`bg-surface-raised`) |
| `--color-surface-hover` | `#253052` | pressed/active fill for buttons and nav rows |
| `--color-border` | `#2a3556` | dividers, card borders (`border-border`) |
| `--color-fg` | `#e6eaf5` | primary text (`text-fg`) |
| `--color-fg-muted` | `#9aa6c4` | secondary text (`text-fg-muted`) |
| `--color-accent` | `#5b9dff` | links, active nav, focus ring, primary button fill |
| `--color-accent-hover` | `#86b6ff` | link/button hover |
| `--color-accent-bg` | `rgba(91, 157, 255, 0.14)` | tint for the `active` status badge |
| `--color-on-accent` | `#0b1020` | text on an accent (or status) fill |
| `--color-success` | `#3dd68c` | online |
| `--color-warning` | `#f5b942` | stale, warning |
| `--color-danger` | `#ff6b6b` | offline, error |
| `--color-neutral` | `#9aa6c4` | unknown, inactive |
| `--color-decommissioned` | `#909bb9` | decommissioned |
| `--color-success-bg` | `rgba(61, 214, 140, 0.14)` | success badge tint |
| `--color-warning-bg` | `rgba(245, 185, 66, 0.14)` | warning / stale tint |
| `--color-danger-bg` | `rgba(255, 107, 107, 0.14)` | danger badge tint |
| `--color-neutral-bg` | `rgba(154, 166, 196, 0.14)` | unknown / decommissioned / inactive badge tint |

Status mapping: online/active = success/accent, stale/warning = warning, offline/error = danger,
unknown/inactive = neutral, decommissioned = decommissioned.

Status rule (R2): a status color is never the only cue. Every status renders through
`components/StatusBadge.tsx` (icon plus text label — see "Badge" below), the only place status-color
utilities may appear outside a documented allowlist (`ui/Card.tsx` stale tone, `ui/Field.tsx`
`ErrorText`, `DeviceDetail.tsx`'s rejected-readings notice — all full-sentence/non-badge text, per R13).

## Spacing

Only the steps below are used anywhere in this codebase (enforced by the static test) — an off-scale
numeric step is always a mistake, not a legitimate exception:

**Allowed numeric steps:** `0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12` (= `0rem` .. `3rem`).

| Token | Value | Use |
|---|---|---|
| `--spacing` | `0.25rem` | Tailwind's base multiplier; `p-4` = `4 * 0.25rem` = `1rem` |

**Named layout keys** (design-system R14):

| Token | Value | Use |
|---|---|---|
| `--spacing-sidebar` | `14.5rem` | `SideNav` width (`w-sidebar`) |
| `--spacing-topbar` | `3.5rem` | `TopBar` height (`h-topbar`) |
| `--spacing-content` | `2rem` | the shell's one outer content inset (`p-content`, `px-content`) — `AppShell`'s content wrapper and `TopBar`'s horizontal padding both use it; no page sets its own |
| `--spacing-icon` | `0.875rem` | `StatusBadge` icon width/height (`size-icon`) |

**Keywords** are always allowed regardless of the numeric set: `full`, `screen`, `auto`, `px`, `fit`,
`min`, `max`, and the container/max-width scale (`max-w-xs`/`sm`/`md`/`3xl`/…) for page max-widths.

## Typography

| Token | Value | Utility |
|---|---|---|
| `--font-sans` | system UI stack | `font-sans` |
| `--font-mono` | system monospace stack | `font-mono` |
| `--text-xs` | `0.75rem` | `text-xs` |
| `--text-sm` | `0.875rem` | `text-sm` |
| `--text-base` | `1rem` | `text-base` |
| `--text-xl` | `1.25rem` | `text-xl` |
| `--text-2xl` | `1.5rem` | `text-2xl` |
| `--leading-tight` | `1.25` | `leading-tight` |
| `--leading-normal` | `1.5` | `leading-normal` |
| `--font-weight-normal` | `400` | `font-normal` |
| `--font-weight-medium` | `500` | `font-medium` |
| `--font-weight-semibold` | `600` | `font-semibold` |

## Radius

| Token | Value | Utility | Use |
|---|---|---|---|
| `--radius-sm` | `0.25rem` | `rounded-sm` | small chrome |
| `--radius-md` | `0.375rem` | `rounded-md` | controls, buttons, badges |
| `--radius-lg` | `0.5rem` | `rounded-lg` | cards, tables |

Pill shapes use Tailwind's built-in `rounded-full` keyword (no token needed).

## Elevation

A small ordered scale of depth levels (design-system R10). Each level pairs a shadow with the tonal
surface step it belongs on — shadows alone barely read on this dark background, so the lighter surface
step (plus a faint 1px top highlight baked into the shadow value) carries most of the "raised" cue. No
component defines its own one-off shadow; every raised surface uses `shadow-1`/`shadow-2`/`shadow-none`.

| Token | Value | Paired surface | Use |
|---|---|---|---|
| `--shadow-1` | `0 1px 2px rgba(0,0,0,.5), 0 2px 6px 1px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.04)` | `--color-surface` | resting raised surfaces: cards, sidebar, top bar; pressed card |
| `--shadow-2` | `0 2px 4px rgba(0,0,0,.5), 0 8px 16px 2px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.06)` | `--color-surface-raised` | hovered interactive surfaces (card hover); the account-menu popover |

**Z-index scale** (not a theme token — the plain Tailwind `z-*` scale, closed to these three values by
the static test): `z-10` top bar, `z-20` sidebar, `z-30` account-menu popover.

## Motion

One shared duration and easing for every interactive state change (design-system R11), set as
Tailwind's *default transition* variables — so a plain `transition`/`transition-colors`/
`transition-shadow` class (with no `duration-*`/`ease-*` class) already uses them.

| Token | Value | Use |
|---|---|---|
| `--default-transition-duration` | `150ms` | every state transition (the one shared duration) |
| `--default-transition-timing-function` | `cubic-bezier(0.2, 0, 0, 1)` | Material 3 "standard" easing |

Movement (`-translate-y-0.5` card lift, `scale-95` menu enter/exit) is the only spatial animation in the
app, and it is only ever used behind the `motion-safe:` variant — Tailwind's built-in
`prefers-reduced-motion` mechanism. Under "reduce motion", color/background/shadow transitions still run
(R11); only the translate/scale utilities are skipped.

## UI conventions

design-system R17: every content surface is built from one of ten documented conventions, each with a
single implementation. A static test (`styles/conventions.test.ts`) verifies each has exactly one
implementation and that raw `<button>`/`<table>`/`<select>`/`<input>`/`<textarea>` and focus utilities
appear only inside these implementations, the shell, or this base layer.

| # | Convention | Use | Implementation |
|---|---|---|---|
| 1 | Shell layout | The persistent frame every authenticated page renders inside | `components/shell/{AppShell,SideNav,TopBar}.tsx` |
| 2 | Account menu | Signed-in identity + sign-out, in the top bar | `components/shell/AccountMenu.tsx` (Headless `Menu`) |
| 3 | Page heading | First element of every authenticated page's primary render (h1 left, actions right) | `components/ui/PageHeading.tsx` |
| 4 | Card | A rounded, elevated content surface (device tiles) | `components/ui/Card.tsx` |
| 5 | Badge | Any compact status indicator | `components/StatusBadge.tsx` (R13) |
| 6 | Table | Any tabular data | `components/ui/Table.tsx` (`Table`, `THead`, `TBody`, `Tr`, `Th`, `Td`) |
| 7 | Form field | Any labelled input/select/checkbox | `components/ui/Field.tsx` (`Field`, `Label`, `Description`, `ErrorText`, `TextInput`, `SelectInput`, `CheckboxInput`, `FieldGroup`) |
| 8 | Button | Any clickable action (not navigation) | `components/ui/Button.tsx` — `primary` (accent fill) / `secondary` (surface) |
| 9 | Focus ring | Keyboard focus indication | `styles/globals.css` `@layer base` — 2px `outline-accent`, offset 2px by default; `-outline-offset-2` (inset) in the nav row, selectable-list row and form-control recipes |
| 10 | Selectable list | A list of rows where one can be the current selection | `components/ui/SelectableList.tsx` (device list rows; Headless `Button`, `aria-pressed`) |

## Icons

Sizing for the single icon render site (`components/StatusBadge.tsx`, design-system R12). Stroke stays
`lucide-react`'s default (2) — no per-instance override. No other component renders a lucide icon.

| Token | Value | Utility | Use |
|---|---|---|---|
| `--spacing-icon` | `0.875rem` | `size-icon` | status badge icon width/height |

## Accessible primitives (R16)

Interactive elements that need keyboard/ARIA behavior are built on `@headlessui/react`, not hand-rolled
event handlers: `Menu`/`MenuButton`/`MenuItems`/`MenuItem` (account menu), `Button` (every button),
`Field`/`Label`/`Description`/`Input`/`Select`/`Checkbox` (every form control), `Fieldset`/`Legend`
(the device-form metadata group), `Disclosure`/`DisclosureButton`/`DisclosurePanel` (the change-history
toggle). `Select` and `Input` are light wrappers around the native elements, so native keyboard behavior
(and `userEvent.selectOptions`) is unchanged.

## Browser support

Tailwind v4 requires Chrome 111+, Safari 16.4+, Firefox 128+. Fine for a desktop-only internal
operations dashboard (R8's 1024px floor already assumes a modern browser).
