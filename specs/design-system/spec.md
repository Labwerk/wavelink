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
  internals to use them is follow-on work per screen.
- Introducing charts, gauges, or any data-visualization component.
- Any UI for `alerting` or `historical-playback` — those features have no
  plan/build yet; this feature only makes sure the shell and tokens they'll
  need already exist.
- Changing routing, authentication logic, or any Convex query/mutation.
- Deciding the CSS implementation approach (Tailwind, CSS Modules with
  tokens, CSS-in-JS, etc.) — a planner-level technical decision.
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
