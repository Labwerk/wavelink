# Spec: Design system & app shell

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `design-system`. Foundational UI work — every feature screen
> (live-telemetry-view, device-registry, auth-roles, and the not-yet-built
> alerting/historical-playback) renders inside what this feature produces.

## Overview

Every screen today (`app/page.tsx`, `SiteHeader.tsx`, `devices/*`, `admin/users/*`,
`signin/*`) is styled independently — inline `style={{...}}` objects and
per-component CSS Modules with their own hard-coded colors, spacing and font
sizes. There is no shared visual language: two components picking a "border
gray" independently can and do disagree. As the product grows past the four
screens that exist today, this makes the UI inconsistent to look at and slow
to change — a single visual decision (e.g. what "stale" looks like) has to be
hunted down and repeated in every component that shows it. This feature
gives the product one visual foundation — a documented set of design tokens
and one shared application shell (navigation + top bar) — so every current
and future screen looks and behaves like part of the same product instead of
a collection of separately styled pages. Target look-and-feel: a dark,
card-based operations dashboard (reference moodboard supplied separately),
replacing today's unstyled light theme.

## Goals

- Establish one documented set of design tokens (color palette including a
  dark background/surface/text scale, semantic status colors, spacing scale,
  typography scale, corner radius) as the single source of truth for visual
  values across the app.
- Replace today's per-page header/layout with one shared application shell —
  persistent navigation plus a top bar — used by every authenticated screen.
- Make the shell's navigation reflect the signed-in user's role, showing only
  the sections that role can access.
- Establish a dark visual theme (background, surfaces, text, borders) applied
  consistently everywhere the shell is used.
- Ensure status/semantic meaning conveyed by color (online/offline/stale/
  error/etc.) is never conveyed by color alone.

## Non-goals

- Restyling the content of individual screens (device grid/cards, forms,
  admin tables, future alert feeds or history charts) — this feature covers
  only the tokens and the shell they will sit inside; migrating each screen's
  internals to use them is follow-on work per screen. *(Narrowed by amendments:
  R11/R13/R14 reach into existing screens for interaction states, status badges
  and spacing only; R17 further requires adoption of ten UI conventions
  (documented in styles/README.md) applied to existing screens' existing
  content without new fields, columns or features; the account menu (R17
  convention 2) and selectable list (R17 convention 10) are re-layouts of
  existing controls, not new features, applying R16 for keyboard/focus behavior.)*
- Introducing charts, gauges, or any data-visualization component.
- Any UI for `alerting` or `historical-playback` — those features have no
  plan/build yet; this feature only makes sure the shell and tokens they'll
  need already exist.
- Changing routing, authentication logic, or any Convex query/mutation.
- Deciding the CSS implementation approach (Tailwind, CSS Modules with
  tokens, CSS-in-JS, etc.) — a planner-level technical decision. *(Superseded
  by the 2026-09-23 third amendment: the user has mandated a specific stack
  and it is now a Constraint, not a planner decision.)*
- Light-mode or a user-facing theme switcher (see Open questions).
- Mobile/small-viewport support (see Open questions).

## User stories

- As a user, I want every screen to share the same navigation and visual
  style, so the product feels like one application instead of separately
  styled pages.
- As a developer, I want one documented source of truth for colors, spacing
  and type, so I never have to invent a new shade of gray for a new
  component.
- As a viewer/operator/maintenance/admin, I want the navigation to show only
  the sections my role can use, so I'm not confused by links that will just
  refuse me.
- As a user, I want status information to be readable without relying on
  color perception alone, so I can correctly tell states apart regardless of
  how I see color.

## Constraints

The user has mandated the following technical stack for this feature:
- **Styling** — Tailwind CSS with utility-first styling and a Tailwind theme
  configuration that captures all design tokens (colors, spacing, typography,
  radius, elevation, motion, layout).
- **Interactive primitives** — Headless UI library for accessible interactive
  components (dropdowns, dialogs, focus management, keyboard navigation, ARIA).
- **Conventions** — Tailwind UI (Tailwind Plus) patterns and best practices for
  layout, spacing, focus rings, and visual consistency.

These are non-negotiable constraints on the implementation; requirements below
specify WHAT outcomes must hold within this stack.

## Requirements

Each is a single, independently testable statement. IDs are stable — the
planner and reviewer reference them.

- **R1** — A documented set of design tokens exists (dark background/surface/
  text colors, semantic status colors, spacing scale, typography scale,
  corner radius) and is the single place these values are defined.
- **R2** — Every status or semantic color (e.g. online, offline, stale/
  unknown, decommissioned, error, warning) is paired with a non-color
  indicator — an icon, a text label, or a pattern — wherever it appears.
- **R3** — Every authenticated page renders inside one shared application
  shell consisting of a persistent navigation area and a top bar showing the
  signed-in user's identity.
- **R4** — The shell's navigation lists only the sections the current user's
  role is permitted to access, consistent with existing role-gating behavior
  (auth-roles R9); a section is not merely disabled if the role can't reach
  it at all.
- **R5** — Moving between routes updates the shell's active-section
  indication and page content without a full page reload.
- **R6** — The overall visual theme (background, surface, text, border
  colors) is dark and applied consistently across every page rendered inside
  the shell.
- **R7** — No page-level component defines a one-off color, spacing, or
  font-size value that duplicates an existing token; a value not yet covered
  is added to the token set rather than inlined locally.
- **R8** — The shell and tokens render correctly and legibly at a minimum
  desktop viewport width of 1024px and wider.
- **R9** — Introducing the shell and tokens does not change any existing
  behavior — role-based visibility, sign-out, and each existing navigation
  destination continue to work exactly as they do today.
- **R10** — The token set includes a documented elevation scale — a small,
  ordered set of depth levels (shadow or an equivalent visual depth cue),
  each with a stated intended use. Content and interactive surfaces (cards,
  the navigation area, the top bar) use a level from this scale so they read
  as raised off the page background, rather than being separated only by a
  flat border in the same color as their surroundings. *Why:* a flat,
  border-only layout gives no visual hierarchy between the page and the
  things on it.
- **R11** — Every interactive element (links, buttons, clickable cards,
  navigation items) has a visible hover state, a visible pressed/active
  state, and a visible keyboard-focus state, and the change between states
  is animated over a short, consistent duration defined once in the token
  set rather than snapping instantly. When the user's system requests
  reduced motion, state changes still occur but without spatial movement
  (no transform or translate animations); color, background, and shadow
  transitions may use the shared duration. *Why:* elements that don't respond
  to the pointer (e.g. a clickable device card with no hover state) don't
  read as clickable, and instant color snaps feel unfinished.
- **R12** — Status indicators use icons from a single, consistent icon set —
  matched in stroke weight, size and optical alignment — rather than text
  glyphs or Unicode characters. This applies to all status kinds, whether
  currently implemented (online, offline, stale, unknown, decommissioned,
  error, warning) or added in future. Each icon has an accessible text
  equivalent, so the R2 non-color cue also holds for assistive technology.
  *Why:* Unicode glyphs render inconsistently across fonts and platforms and
  look visibly mismatched next to each other.
- **R13** — Every status indicator in the app is rendered by the shared
  status badge built in this feature; no other component keeps its own
  status badge, pill, or glyph markup. A status indicator is a compact
  element that labels the state of an entity — including device connectivity
  (online/offline/unknown), freshness (stale/never reported), device lifecycle
  (in service/decommissioned), account state (Active/Deactivated), event log
  gaps, and group headings when grouped by status. Excluded: full-sentence
  messages (form/action errors like "Invalid email or password"), status
  options in filter controls, facet count summaries, and UI chrome like role
  badges. *Why:* a shared badge that nothing uses, alongside ad hoc copies,
  defeats the point of the design system and lets statuses drift out of sync
  visually.
- **R14** — The shell defines one consistent outer padding/spacing rhythm for
  the main content area, taken from the spacing tokens. No authenticated page
  sets its own outer padding via inline style (whether a raw literal or a
  token reference on the page root), and every authenticated page's content
  starts at the same inset from the shell edges. (Scope: pages rendered inside
  the shell; /signin and other unauthenticated pages render outside the shell
  and are excluded.) *Why:* per-page inline padding is exactly the one-off
  literal R7 exists to prevent, and it makes pages visibly misalign when
  switching between them.
- **R15** — All style values (colors, spacing, typography, corner radius,
  elevation, motion duration) are configured in a single utility theme source
  where they become the single source of truth for the design tokens (R1, R7,
  R10, R11, R14). No per-component stylesheets or inline styles define
  stand-alone values for these; a minimal documented global base layer may
  exist (e.g. reset styles, font rendering). *Why:* fragmented styling sources
  defeat the purpose of a design system and make changes expensive.
- **R16** — Interactive components requiring accessible keyboard behavior
  (focus navigation, dismissal, ARIA state announcement, label association)
  use a dedicated accessible primitive library rather than hand-rolled event
  handlers or ARIA. This applies to existing interactive elements (the top-bar
  identity menu if it includes dropdown/account controls, any dropdown/select
  filters that exist today, and any dialogs/confirmations) and future
  components Tailwind UI conventions require. New interactive features beyond
  the shell's scope are deferred. *Why:* keyboard and screen-reader behavior
  is easy to get wrong and expensive to retrofit; a primitive library handles
  it correctly and consistently.
- **R17** — The application shell and all content surfaces (cards, badges,
  forms, tables, buttons, page headings, account menu, selectable lists) are
  built using ten documented UI conventions. Each convention specifies a named
  component or pattern, its intended use, and its single shared implementation.
  The conventions are: (1) shell layout (fixed sidebar with brand and nav list,
  sticky top bar with page title and account menu, content area with one
  padding inset from R14); (2) account menu (dropdown in top bar showing
  signed-in identity, with sign-out action inside); (3) page heading (h1 on
  left, page actions right-aligned, first element on every authenticated
  page); (4) card (rounded-lg surface with elevation level 1, one padding
  token, no outer margin); (5) badge (StatusBadge only, from R13); (6) table
  (full-width, left-aligned small-text header, row dividers, one cell-padding
  token); (7) form field (label above control, optional description and error
  text below, stacked with one gap token, error in danger color); (8) button
  (two variants: primary [accent fill] and secondary [surface]); (9) focus ring
  (2px accent outline, outset by default, inset for form controls and nav
  rows); (10) selectable list (stacked full-width rows, each a button with
  aria-pressed, hover/pressed/selected surface states, row dividers, one
  padding token). Every instance uses its documented convention implementation,
  never a one-off variation. The dark-only, desktop ≥1024px scope (R6, R8)
  remains unchanged. *Why:* explicit, documented, shared conventions make the
  system maintainable and prevent visual drift as the product grows.
- **R18** — Migrating the UI to the new styling and primitive approach does
  not alter any existing behavior. Role-based navigation, authentication
  sign-out, route transitions, device filtering, status display, form
  validation, and all other app logic work identically to the previous
  implementation. Existing automated tests continue to pass or are equivalently
  rewritten to verify the same functional outcome. *Why:* visual and
  technical debt paydown must not introduce bugs or change user-facing
  behavior.

## Acceptance criteria

- **R1** — A single file/module of tokens exists; a sample of components
  (header, a card, a badge) reference it instead of local literals for the
  covered values.
- **R2** — For each status shown today (online/offline/stale/unknown/
  decommissioned) and any error/warning state, the rendered UI includes a
  non-color cue; a grayscale screenshot of the screen still distinguishes all
  states.
- **R3** — Loading any authenticated route shows the same navigation area and
  top bar, with only the route's main content differing.
- **R4** — Signing in as each of the four roles shows a navigation list
  matching that role's permitted sections, verified against the auth-roles
  capability table.
- **R5** — Clicking a navigation entry changes the active indicator and the
  displayed content without a full browser navigation/reload.
- **R6** — Every page reachable through the shell shows the same dark
  background/surface/text colors; no page reverts to the old light,
  unstyled treatment.
- **R7** — A review of component styles finds no new hard-coded color,
  spacing, or font-size value that duplicates a token that already exists.
- **R8** — The shell is exercised at 1024px width (and wider) without
  overlapping, clipped, or unreadable elements.
- **R9** — Before/after comparison of role-based visibility, sign-out, and
  navigation destinations shows no behavioral difference — only visual ones.
- **R10** — The token set documents an elevation scale of at least two
  levels, each with its intended use. Cards, the navigation area and the top
  bar each use a named level from it, and no component defines its own
  one-off depth value. In a side-by-side screenshot, each of those surfaces
  is visibly raised off the page background even when its border is
  disregarded.
- **R11** — For each kind of interactive element (navigation item, link,
  button, clickable device card), hovering, pressing and tabbing to it each
  produce a visible change. Screen-recording the hover shows an animated
  transition rather than a single-frame change, and every element uses the
  one shared duration token. With the OS "reduce motion" setting on, the same
  state changes are still visible, but without spatial movement animations
  (no transform or translate); color, background, and shadow transitions may
  use the shared duration.
- **R12** — All status kinds (starting with online, offline, stale,
  unknown, decommissioned, error, warning; extensible for future additions)
  render with an icon from the single chosen set, and the rendered output
  contains no Unicode symbol characters (e.g. ●○◐⊘⚠✕). Seen together at the
  same size, the icons share a consistent weight and size. A screen reader
  announces a text label for each status.
- **R13** — A search of the frontend source finds exactly one status badge
  implementation (the shared one). Every compact status indicator (device
  connectivity, freshness, lifecycle, account state, event gaps, grouped
  status labels) renders through that shared badge and looks identical
  everywhere it appears. Full-sentence error messages, filter control options,
  facet counts, and role chips are excluded and keep their own text/color
  treatment (R2 still applies to those).
- **R14** — A search of page-level source (pages inside the shell) finds no
  locally declared outer padding via inline style on any authenticated page
  (e.g. no `style={{padding: ...}}` on the page root, whether a raw literal
  or a token reference like `var(--space-6)`). Navigating between every
  authenticated page shows the content starting at the same inset from the
  navigation area and the top bar, and that inset matches a spacing token.
  (/signin and other unauthenticated pages outside the shell are not in scope.)
- **R15** — The theme configuration for the utility system includes mappings
  for every design token (colors, spacing scale, typography sizes and weights,
  radius values, elevation/shadow levels, transition durations). A code review
  finds no component with local stylesheet rules that define new color,
  spacing, type, or shadow values; all styling uses theme tokens via utilities
  or a documented minimal base layer.
- **R16** — Every interactive element requiring keyboard behavior (navigation
  focus, dropdown toggle, dialog dismissal on Escape, role/attribute
  announcement) is built from the accessible primitive library. A keyboard
  audit (Tab through every interactive element, test Escape/Enter/Space where
  applicable) confirms all expected keyboard interactions work. A screen
  reader (or automated accessibility test) confirms ARIA labels, roles, and
  state changes are announced correctly.
- **R17** — (a) A "UI conventions" section in frontend/styles/README.md
  documents all ten R17 conventions (shell layout, account menu, page heading,
  card, badge, table, form field, button, focus ring, selectable list) with
  name, intended use, and implementing component or class recipe. (b) A static
  test verifies each convention has exactly one implementation (e.g.,
  components/ui/{Button, Card, Table, PageHeading, SelectableList}, shell
  components, StatusBadge, base layer). Focus utilities appear only in those
  implementations and base layer. (c) Every authenticated page's primary render
  starts with a `PageHeading` (loading and error branches are exempt); every
  `<button>` in app code is either the shared Button component (primary/secondary)
  or rendered inside another documented convention's single implementation
  (account menu, selectable list); every `<table>` uses the Table convention.
  (d) A manual page-by-page review against the README finds no visual deviations
  (no unique card margins, no one-off focus styles, no spacing exceptions).
- **R18** — A before/after functional test matrix (role-based nav, sign-out,
  route changes, device filtering, status filtering, form validation, error
  display) shows no behavioral differences. The existing test suite passes with
  only visual/snapshot assertion updates, if any. A smoke test confirms all
  existing user workflows (sign in, navigate, filter, view device details, sign
  out) complete successfully.

## Open questions

- **Exact palette** — the reference moodboard fixes the general direction
  (dark, card-based, accent color on dark surfaces) but not exact hex values;
  final palette is a planner-level decision and will be decided before build.
- **Responsive/mobile support** — v1 targets desktop only; whether a mobile
  or narrow-viewport layout is needed is deferred.
- **Theme switching** — dark-only for v1; whether a light theme or user
  toggle is ever needed is deferred, not decided against.
- **Migration order** — this feature ships the shell and tokens; which
  existing screen gets migrated onto them first (and whether that's in the
  same pass or separate follow-on work) is left to the plan.

---

## Amendments

**2026-09-23 initial** — Added R10–R14 to close polish gaps found during
review of shipped code. The shipped result is mechanically correct but lacks
elevation (R10), transitions (R11), proper iconography (R12), StatusBadge
adoption (R13), and consistent content padding (R14). R1–R9 remain unchanged.

**2026-09-23 scope clarifications** — Planner review identified four ambiguities:
- **R11** — Clarified that `prefers-reduced-motion` means no spatial movement
  (transform/translate); color/background/shadow transitions remain acceptable.
- **R12** — Clarified that the listed 7 kinds (online, offline, stale, unknown,
  decommissioned, error, warning) are a starting point, not an exhaustive set;
  new kinds may be added following the same principle (icons, not Unicode).
- **R13** — Defined "status indicator" as compact elements labeling entity state
  (device connectivity, freshness, lifecycle, account state, event gaps, grouped
  status labels), explicitly excluding full-sentence error messages, filter
  options, facet counts, and role chips.
- **R14** — Clarified that "no page sets its own outer padding" covers both raw
  literals and token references via inline styles, and that /signin (outside the
  shell) is out of scope.

**2026-09-23 user technology constraint** — Added Constraints section and R15–R18
to record the user's mandate of Tailwind CSS (utility-first with theme as token
source), Headless UI (accessible primitives), and Tailwind UI conventions (layout
patterns). R1–R14 remain unchanged; these new requirements ensure the mandated
stack delivers the same WHAT outcomes. The Non-goals entry on CSS approach is
superseded and noted as such.
- **R15** — All style values (colors, spacing, type, radius, elevation, motion)
  must be configured in a single utility theme source, not fragmented across
  stylesheets.
- **R16** — Interactive components requiring keyboard/ARIA behavior use a
  dedicated accessible primitive library, not hand-rolled event handlers.
- **R17** — Shell and content surfaces follow established layout and styling
  conventions for visual consistency and predictability.
- **R18** — No behavioral changes; all existing tests pass or are equivalently
  rewritten; user workflows work identically.

**2026-09-23 R17 testability rewrite** — Planner feedback: R17's original
wording ("industry best practices", "documented conventions") was not testable.
Rewrote R17 to specify ten concrete UI conventions (shell layout, account menu,
page heading, card, badge, table, form field, button, focus ring, selectable
list) with implementing components and a single source of truth
(frontend/styles/README.md). Rewrote AC17 to verify: documentation exists,
each convention has one implementation, static tests pass, pages conform.
Clarified AC17(c) that buttons inside conventions (account menu, selectable
list) use their convention's styling, not the Button convention; PageHeading
required only for primary page render, not loading/error branches. Also
narrowed Non-goals to clarify R17 requires adoption of these ten conventions
with no new content/fields/features; account menu and selectable list are
re-layouts (not new features), applying R16 for keyboard behavior.
