# Plan: Design system & app shell

> Written by planner. HOW, based on the existing codebase. No implementation code, no task list.
> Per the lead's instruction there was NO web research for this plan. Every stack fact below
> comes from files in this repo (`frontend/package.json`, `frontend/app/*`, `backend/lib/permissions.ts`).
> No new dependency is introduced, so no external version claim is made.

## Spec requirements to cover

R1 tokens exist and are the single source; R2 status colors always have a non-color cue;
R3 one shared shell (nav + top bar with identity) on every authenticated page; R4 nav lists
only role-permitted sections (omitted, not disabled); R5 client-side route change updates the
active indicator and content; R6 dark theme applied consistently; R7 no page-level literal that
duplicates a token; R8 correct at 1024px and wider; R9 no behavior change (role visibility,
sign-out, nav destinations).

## Existing stack (observed)

- Next.js `^16.3.1` App Router, React `^18.3.0`, TypeScript, Convex auth (`@convex-dev/auth` 0.0.95).
  `frontend/AGENTS.md` warns this Next has breaking changes; builder must read
  `node_modules/next/dist/docs/` (the CSS / global styles guide) before wiring the global CSS import.
- Styling today: CSS Modules for `components/*` and `app/devices/[deviceId]`, inline `style={{}}`
  in pages, `SiteHeader.tsx` with inline styles. There is no global stylesheet and no Tailwind.
  About 70 hard-coded color occurrences across 19 files.
- `app/layout.tsx` renders `<SiteHeader />` above `{children}` inside `Providers`. `SiteHeader` is a
  client component that reads `api.users.me`, returns `null` on `/signin` or when `me` is falsy,
  and shows the "Wavelink" home link, "Signed in as {email} ({role})", a Devices link, a
  "Manage users" link when `capabilities` includes `user.manage`, and a Sign out button
  (`signOut()` then `router.replace("/signin")`).
- Pages render their own `<main>` with inline padding and `fontFamily: "sans-serif"`.
- Tests: Vitest 5 + jsdom + Testing Library, `include: **/*.test.{ts,tsx}`, existing tests mock
  `convex/react`. CSS Modules already load under Vitest.

## Architecture

```
app/layout.tsx  (server; keeps ConvexAuthNextjsServerProvider + Providers)
  imports styles/tokens.css  -> :root custom properties (the ONLY place values are defined)
  imports styles/globals.css -> color-scheme: dark, body/base element rules, link/focus/form-control defaults
  <Providers>
    <AppShell>                       (client; replaces SiteHeader)
      pathname == "/signin"  or me == null -> renders {children} bare (no shell)
      me undefined (loading)             -> shell frame, empty nav, no identity (avoids layout shift)
      me loaded:
        +----------------+--------------------------------------------+
        | SideNav        | TopBar: section title | email, role | Sign out |
        | brand "Wavelink"+--------------------------------------------+
        | NavItem(s)     | <div id="content"> {children} </div>        |
        +----------------+--------------------------------------------+
    </AppShell>
  </Providers>

lib/nav.ts           NAV_ITEMS[{label, href, capability, match}] + visibleNavItems(capabilities) + isActive(pathname, item)
components/StatusBadge.tsx   icon glyph + text label + status tint (the only sanctioned way to color a status)
```

The shell is mounted once in the root layout, so it persists across client-side route
transitions (R5). Nav uses `next/link`; there is no full page load.
The shell content wrapper is a `<div>`, not `<main>`, because every existing page already renders its own
`<main>`. This avoids nested main landmarks. The shell does not touch page padding or internals.

## Tech decisions

| Decision | Choice | Rationale | Rejected alternative |
|---|---|---|---|
| Token mechanism | CSS custom properties in one file `frontend/styles/tokens.css` (`:root`) | Zero dependencies, works with the existing CSS Modules and with inline `var(--x)`. One file is the single source (R1). Theme is dark-only for v1, so no theme-switching logic is needed. | Tailwind (new dependency plus build config plus retrofitting 19 files); CSS-in-JS (runtime cost, conflicts with RSC layout); a TS tokens object (values would not be usable from `.module.css`) |
| Shell styling | CSS Modules per shell component, referencing `var(--token)` only | Matches the existing convention (`DeviceCard.module.css`). | Inline styles (they are what we are getting rid of) |
| Shell location | Replace `SiteHeader` in the root layout with a client `AppShell` | Reuses the existing role-gating source (`users.me` capabilities) and the existing sign-out path unchanged (R9). One mount point means every route gets it (R3). | Route-group `(app)/layout.tsx`. It would require moving pages and changes `/signin` handling for little benefit. |
| Role gating input | `me.capabilities` (from `users.me`), one capability per nav item | This is exactly what `SiteHeader` and `DevicesView` do today. `capabilitiesFor()` in `backend/lib/permissions.ts` is the single source of role -> capability. No parallel role table to drift. | Hard-coding role names in nav config (drifts from `CAPABILITY_MIN_ROLE`) |
| Status cues | `StatusBadge` = glyph (aria-hidden) + visible text label, colored via `--color-*` tokens | Meaning survives grayscale: distinct glyph shape plus the word (R2). | Color-only dot; pattern fills (overkill for v1) |
| Theme | Dark only; `color-scheme: dark` on `:root`; no `prefers-color-scheme` branching, no toggle | Spec non-goal. `color-scheme: dark` makes native selects/inputs/scrollbars render dark so unstyled forms stay legible. | Light/dark switcher (deferred by spec) |
| Font | System font stack token, no web font | No network fetch or `next/font` config; zero risk in the Docker/Netlify builds. | Google font via `next/font` |
| Responsive | Desktop only; shell `min-width: 1024px` (horizontal scroll below) | Spec R8 and non-goal. Sidebar is fixed width, content is fluid. | Collapsing sidebar / mobile nav (deferred) |
| Migration order (spec open question) | Same pass, mechanical only: swap color literals (and inline `fontFamily`) for `var(--token)` in existing files; swap font-size / spacing only when the value exactly equals a token; no layout or markup changes | Without this the dark body would render existing light cards (`#fff`) and `#444` text illegibly, failing R6 and R8. R7 forbids duplicates, so exact-match swaps are all it requires. | Deferring migration entirely (the app would be unreadable); redesigning each screen (spec non-goal) |
| Token doc | `frontend/styles/README.md` table, kept honest by a parity test | Satisfies "documented" (R1). The test fails if a token exists in CSS but not in the doc. | Storybook (heavy) |
| Tests for tokens | Vitest tests that read `tokens.css`: contrast check, doc parity, literal scan | Cheap, runs in existing `npm test`, catches regressions in R1/R2/R7. | Manual review only |

## Token values (`frontend/styles/tokens.css`)

Contrast ratios below were hand-calculated using the WCAG relative-luminance formula. The contrast test
(see Test approach) is authoritative. If it fails, the builder adjusts the hex, not the threshold (>= 4.5:1
for text, on bg/surface/surface-raised).

Colors

| Token | Value | Use | Contrast on `--color-surface` |
|---|---|---|---|
| `--color-bg` | `#0B1020` | page background | (base) |
| `--color-surface` | `#131A2E` | cards, sidebar, top bar | (base) |
| `--color-surface-raised` | `#1B2440` | inputs, hover, popovers | |
| `--color-border` | `#2A3556` | dividers, card borders | decorative |
| `--color-text` | `#E6EAF5` | primary text | ~14.4:1 |
| `--color-text-muted` | `#9AA6C4` | secondary text | ~7.1:1 (6.3 on raised) |
| `--color-accent` | `#5B9DFF` | links, active nav, focus ring, primary button | ~6.4:1 |
| `--color-on-accent` | `#0B1020` | text on accent fill | ~7.0:1 on accent |
| `--color-success` | `#3DD68C` | online | ~9.2:1 |
| `--color-warning` | `#F5B942` | stale, warning | ~9.8:1 |
| `--color-danger` | `#FF6B6B` | offline, error | ~6.2:1 |
| `--color-neutral` | `#9AA6C4` | unknown | ~7.1:1 |
| `--color-decommissioned` | `#909BB9` | decommissioned | (revised from `#8792B0` during build: it measured 4.37:1 on the neutral tint, below the 4.5 gate) |
| `--color-success-bg` / `-warning-bg` / `-danger-bg` | `rgba(61,214,140,.14)` / `rgba(245,185,66,.14)` / `rgba(255,107,107,.14)` | badge tint, stale card tint | text on tint >= ~5.2:1 (danger is the lowest) |
| `--color-neutral-bg` | `rgba(154,166,196,.14)` | unknown/decommissioned badge tint | test-verified |

Status mapping: online -> success; stale -> warning; offline -> danger; unknown -> neutral;
decommissioned -> decommissioned; error -> danger; warning -> warning.

Spacing (4px base): `--space-1` 0.25rem, `--space-2` 0.5rem, `--space-3` 0.75rem, `--space-4` 1rem,
`--space-5` 1.5rem, `--space-6` 2rem, `--space-7` 3rem.

Typography: `--font-sans` (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`), `--font-mono`
(`ui-monospace, SFMono-Regular, Menlo, monospace`); sizes `--text-xs` 0.75rem, `--text-sm` 0.85rem,
`--text-md` 1rem, `--text-lg` 1.25rem, `--text-xl` 1.5rem; `--leading-tight` 1.25, `--leading-normal` 1.5;
`--weight-regular` 400, `--weight-semibold` 600.

Radius: `--radius-sm` 4px, `--radius-md` 8px (equals today's card radius), `--radius-lg` 12px,
`--radius-pill` 999px.

Layout: `--sidebar-width` 14.5rem, `--topbar-height` 3.5rem.

Existing off-scale values (e.g. `0.8rem`, `0.15rem` margins) are left as-is and listed in the doc as
"legacy, follow-on". They are not duplicates of a token, so R7 is not violated.

## Component list

| Component | File | Notes |
|---|---|---|
| `AppShell` | `frontend/components/shell/AppShell.tsx` + `.module.css` | Owns `useQuery(api.users.me)`, `usePathname`; picks bare vs shell vs loading frame; lays out sidebar/topbar/content. Replaces `app/SiteHeader.tsx` (delete). |
| `SideNav` | `frontend/components/shell/SideNav.tsx` + css | Brand link "Wavelink" -> `/`; `<nav aria-label="Primary">`; list of `Link`s; active item gets `aria-current="page"` plus accent left bar and bolder weight (not color alone). |
| `TopBar` | `frontend/components/shell/TopBar.tsx` + css | `<header>`: current section title, "email" + role chip (text), Sign out button. Sign-out handler is moved verbatim from `SiteHeader` (`signOut()` then `router.replace("/signin")`). |
| `StatusBadge` | `frontend/components/StatusBadge.tsx` + css | Props: `kind` in `online / offline / stale / unknown / decommissioned / error / warning`, optional `label` override. Always renders glyph + text. Glyphs (distinct shapes): online `●`, offline `○`, stale `◐`, unknown `?`, decommissioned `⊘`, warning `⚠`, error `✕`. |
| `nav.ts` | `frontend/lib/nav.ts` | Pure: `NAV_ITEMS`, `visibleNavItems(capabilities)`, `isActive(pathname, item)`. |

`StatusBadge` is not force-inserted into existing screens: they already show status as text
(`Status: online`, `Decommissioned`, `⚠ Stale · 3m ago`), and existing tests assert on that markup. After the token
swap, the stale card keeps its amber border/tint plus the text badge. `StatusBadge` is the required primitive for any
new status display and for follow-on screen migration.

## Role -> nav mapping (from current behavior)

Today: the brand link goes to `/`, "Devices" is shown to everyone, and "Manage users" is shown when
`capabilities` includes `user.manage`. `backend/lib/permissions.ts`: `data.read` = viewer+, `device.manage`/`user.manage`
= admin. The nav items below encode that, one capability each.

| Nav item | href | Required capability | viewer | operator | maintenance | admin |
|---|---|---|---|---|---|---|
| Overview (live view) | `/` | `data.read` | yes | yes | yes | yes |
| Devices (registry) | `/devices` | `data.read` | yes | yes | yes | yes |
| Users | `/admin/users` | `user.manage` | no | no | no | yes |

Active match: `/` is exact match; other items match the prefix (`/devices/[id]` highlights Devices).
Items the role cannot reach are omitted from the DOM, never rendered disabled (R4).
Routes for alerting and historical-playback do not exist yet, so no entries are added. Adding a section later is one
`NAV_ITEMS` entry with its capability (e.g. `alert.acknowledge`, `history.export` in `CAPABILITY_MIN_ROLE`).
Note operator and maintenance currently see the same nav as viewer; that is correct for the sections that exist.

## Data model

No persisted entities, no Convex schema or function changes (spec non-goal, R9).

UI-level types only:
- `NavItem { label, href, capability: Capability, match: "exact" | "prefix" }` with `Capability` reused from `backend/lib/permissions.ts`.
- `StatusKind = "online" | "offline" | "stale" | "unknown" | "decommissioned" | "error" | "warning"`.
- Consumed shape of `users.me`: `{ _id, email, role, capabilities: Capability[] }` (already used by `SiteHeader`).
- Token set: the `--*` custom properties above; `tokens.css` is the schema, `styles/README.md` its documentation.

## File list

New:
- `frontend/styles/tokens.css`, `frontend/styles/globals.css`, `frontend/styles/README.md`
- `frontend/components/shell/{AppShell,SideNav,TopBar}.tsx` and matching `.module.css`
- `frontend/components/StatusBadge.tsx`, `StatusBadge.module.css`
- `frontend/lib/nav.ts`
- Tests: `frontend/lib/nav.test.ts`, `frontend/components/shell/AppShell.test.tsx`,
  `frontend/components/StatusBadge.test.tsx`, `frontend/styles/tokens.test.ts`

Modified:
- `frontend/app/layout.tsx`: import the two stylesheets, swap `SiteHeader` for `AppShell`.
- Mechanical literal -> token swap, no markup or layout changes: `components/DeviceCard.module.css`, `DeviceCard.tsx`,
  `MetricTable.module.css`/`.tsx`, `DeviceGrid.module.css`/`.tsx`, `EventLog.module.css`, `FilterBar.module.css`/`.tsx`,
  `app/page.tsx`, `app/signin/page.tsx`, `app/admin/users/page.tsx`, `app/devices/DevicesView.tsx`, `DeviceDetail.tsx`,
  `DeviceForm.tsx`, `app/devices/[deviceId]/DeviceDetailView.module.css`.
  Inline `fontFamily: "sans-serif"` is removed (the body inherits `--font-sans`).

Deleted: `frontend/app/SiteHeader.tsx`.

`globals.css` scope, kept small: `:root { color-scheme: dark }`; `body` (bg, text, `--font-sans`, `--leading-normal`, margin 0);
default link color = accent; `:focus-visible` ring = accent; `input/select/textarea/button` default bg =
surface-raised, text color, border, radius-md (so unstyled native forms in existing screens stay legible); `h1..h3` sizes from the type scale.

## Test approach

Automated (Vitest, in the existing `npm test`):
1. `styles/tokens.test.ts`
   - Parses `tokens.css`; asserts WCAG contrast >= 4.5 for text/muted/accent/status colors against bg, surface and
     surface-raised, for `on-accent` on accent, and for status colors on their `-bg` tints (rgba blended over
     surface). Covers R6 and R2 legibility.
   - Doc parity: every `--token` in `tokens.css` appears in `styles/README.md`, and vice versa (R1).
   - Literal scan (R7): walk `app/`, `components/`, `lib/` (excluding `*.test.*`, `tokens.css`) and fail on hex colors,
     `rgb(`/`rgba(`/`hsl(`, named colors (`crimson`, `red`, `white`, ...), and a `font-size` / `fontSize` value that exactly equals a token value.
     Spacing exact-duplicates are checked in review (regex noise too high).
2. `lib/nav.test.ts`: for each of the four roles, `visibleNavItems(capabilitiesFor(role))` equals the table
   above. It imports `capabilitiesFor` from `backend/lib/permissions.ts`, so it verifies against the real role table (R4).
   Also `isActive` for `/`, `/devices`, `/devices/abc`, `/admin/users`, `/signin` (R5).
3. `components/shell/AppShell.test.tsx` (mock `convex/react`, `next/navigation`, `@convex-dev/auth/react`, as existing tests do):
   - viewer: no "Users" link in the DOM; admin: present (R4).
   - `/signin` and `me === null`: children only, no nav/top bar. Loading: frame without identity or links (R3).
   - Identity (email + role) shown in the top bar; changing the mocked pathname moves `aria-current="page"` (R5).
   - Sign out click calls `signOut` then `router.replace("/signin")` (R9). Nav links are `<a href>` produced by `next/link` (R9 destinations).
4. `components/StatusBadge.test.tsx`: each `kind` renders both a glyph and a non-empty text label; glyphs are unique per kind (R2 grayscale).
5. Existing suites (`DeviceCard`, `DeviceGrid`, `FilterBar`, `DeviceDetailView`, ...) must keep passing unmodified, which is the
   automated proxy for "no behavior change" (R9).

Manual (short checklist, run once by builder/reviewer):
- Sign in as each of the four roles; compare the nav to the table (R4). Click through Overview/Devices/Users and confirm no
  full reload (network tab shows no document request) and that the active item follows (R5).
- Visit `/`, `/devices`, `/devices/[id]`, `/admin/users`, `/signin`: dark everywhere, text readable (R6).
- Browser window at 1024px and 1440px: no overlap/clipping; below 1024 a horizontal scroll is acceptable (R8).
- Grayscale (DevTools "emulate vision deficiency: achromatopsia" or a grayscale filter): stale card and StatusBadge samples still distinguishable (R2).
- Sign-out returns to `/signin`; a viewer visiting `/admin/users` still gets "Not available." (R9).

## Requirement coverage

| Req | Addressed by |
|---|---|
| R1 | `styles/tokens.css` (sole definition site for color, spacing, type, radius, layout) + `styles/README.md` doc; parity test in `tokens.test.ts`. Shell, `StatusBadge` and migrated `DeviceCard` reference tokens, not literals. |
| R2 | `StatusBadge` (glyph + text label + tint), status -> token mapping above; the stale card keeps its `⚠` text badge alongside the amber tint; `StatusBadge.test.tsx`; tokens contrast test; manual grayscale check. |
| R3 | `AppShell` mounted once in `app/layout.tsx`; `SideNav` + `TopBar` (identity: email + role) on every route except `/signin` and signed-out; `AppShell.test.tsx`. |
| R4 | `lib/nav.ts` capability-per-item, `visibleNavItems(me.capabilities)`; unavailable items are not rendered; role -> nav table; `nav.test.ts` using `capabilitiesFor`. |
| R5 | Shell lives in the root layout (does not remount); `next/link` navigation; `aria-current` from `usePathname` + `isActive`; `AppShell.test.tsx` and manual network-tab check. |
| R6 | `color-scheme: dark`, `globals.css` body/base rules from tokens, mechanical color swap of existing components; contrast test; manual page sweep. |
| R7 | Mechanical migration of the 19 files + literal-scan test (colors and exact-match font-size); spacing duplicates checked in review; off-scale legacy values listed in the doc. Interpretation: "duplicates an existing token" means an exact-value duplicate or a hard-coded color. |
| R8 | Shell `min-width: 1024px`, fixed `--sidebar-width`, fluid content, no wrapping in the top bar; manual check at 1024/1440. Not testable in jsdom. |
| R9 | Sign-out handler, `users.me` query and capability check moved verbatim from `SiteHeader`; no routing/proxy/Convex changes; existing test suites unchanged and green; `AppShell.test.tsx` sign-out and link-destination cases. |

## Risks & unknowns

- Global CSS import behavior in this Next 16 build differs from memory. Mitigation: builder reads the CSS guide under
  `frontend/node_modules/next/dist/docs/` first (per `frontend/AGENTS.md`). Fallback: import the CSS in `layout.tsx` only, as is standard for App Router.
- Existing inline styles win over global rules (e.g. `style={{ maxWidth: 360 }}`, `fontFamily`). Mitigation: mechanical swap covers
  colors and font family. Non-color inline layout is intentionally left.
- Hard-coded light values in existing CSS (`#fff`, `#fef3c7`, `#444`) would be unreadable on dark. Mitigation: mechanical swap is in
  this pass (see decision), and the literal scan prevents leftovers. Some remaining screens may look plain (borders/sizing legacy) until per-screen follow-on work.
- Nested landmarks: pages render `<main>`. Mitigation: shell content wrapper is a `<div>`.
- Loading flash: `users.me` is `undefined` briefly. Mitigation: render the shell frame without links or identity, not `null`.
  On sign-out, `me` becomes null before `router.replace("/signin")`, so the shell disappears for an instant, same as the old header.
- Hand-computed contrast could be slightly off. Mitigation: the test is the gate; adjust hex values within the same hue.
- `StatusBadge` not yet used on screens, so R2 "wherever it appears" relies on today's screens already being text-labelled. Mitigation: documented
  rule in `styles/README.md` (status colors only via `StatusBadge`); reviewer should check for any new color-only status.
- Spec wording: R7 says "duplicates an existing token" while the non-goal says screen internals migrate later. Interpreted as above; no spec revision requested.
- Alerting/historical-playback routes and their required capabilities are unknown, so nav entries for them are deferred to those features.

## Decisions recorded (spec open questions)

- Palette: fixed above (dark navy surfaces, blue accent `#5B9DFF`, semantic green/amber/red).
- Responsive: desktop only, 1024px minimum, deferred as the spec says.
- Theme: dark only, no toggle; `color-scheme: dark`.
- Migration order: same pass as the shell, mechanical token swap only.

## Sources

None fetched (web research was disallowed for this plan). Codebase files relied on:
- `d:\Self\wavelink\frontend\package.json`, `frontend\app\layout.tsx`, `frontend\app\SiteHeader.tsx`, `frontend\app\providers.tsx`,
  `frontend\proxy.ts`, `frontend\vitest.config.mts`, `frontend\components\DeviceCard.module.css`
- `d:\Self\wavelink\backend\lib\permissions.ts` (role -> capability table), `specs\auth-roles\spec.md` (R8/R9)

---
---

# Amendment 2026-09-23: R10–R14 (polish pass)

> Planner addendum for spec amendment 2026-09-23. Everything above this line (R1–R9) is built and reviewed (PASS)
> and stays as it is. This section only adds work. Unlike the original plan, this addendum **did** use web research,
> because it adds a dependency. Sources are listed at the end of this section. File:line references are from the
> tree at commit `20d5ff7`.

## Requirements covered by this addendum

- R10: a documented elevation scale. Cards, nav and top bar use named levels. No one-off depth values.
- R11: hover, pressed and focus states on every interactive element, animated with one shared duration token, and reduced-motion safe.
- R12: status icons come from one icon set, replacing Unicode glyphs, and each has an accessible text label.
- R13: every status indicator renders through `StatusBadge`. There is exactly one badge implementation.
- R14: the shell owns the content inset. No page sets its own outer padding.

## Scope interpretations (confirmed by spec-writer 2026-09-23 and folded into spec.md R11–R14 and AC11–AC14)

Note: spec R14 says "via inline style". This plan also removes the page-root padding that `DeviceDetailView.module.css`
applies (P5), because it is the same page-owned inset in a different syntax. Leaving it in would break "same inset on every page".

1. **"Status indicator" (R13)** means a compact element that labels the state of an entity:
   - device connectivity
   - freshness (stale / never reported)
   - device lifecycle (in service / decommissioned)
   - user account state (Active / Deactivated)
   - the EventLog gap marker
   - group headings when grouping by status

   These are **excluded**: full-sentence messages (form and action errors, the "reading(s) rejected" notice), status
   `<option>`s in filter selects, the facet count summary line, and the top-bar role chip. They keep text plus color, so R2 still holds.
2. **Badge kinds (R12)**: the 7 kinds R12 lists are a minimum. Two kinds are added so that lifecycle and account state can go
   through the one badge: `active` (shown as "In service" or "Active") and `inactive` (shown as "Deactivated").
3. **R14 scope**: `/signin` is outside the shell (unauthenticated), so it keeps its own centered layout. "No page sets its own
   outer padding" covers token references on the page root (`padding: var(--space-6)`), not only raw literals, because the
   shell owns the inset.
4. **Reduced motion (R11)**: "no animated movement" means no `transform`/translate animation. Color, background, border and
   shadow cross-fades may still run, because MDN treats these as acceptable non-motion alternatives.

All four were confirmed without change.

## Architecture delta

```
styles/tokens.css   + elevation (--elevation-0/1/2, --layer-*), motion (--motion-*), icon (--icon-*),
                    + --content-inset, + 3 interaction colors; @media (prefers-reduced-motion: reduce) override block
styles/globals.css  + :where(a, button, input, select, textarea, summary) transition + hover/active/focus defaults
                    + h1 margin-block reset (so first line of every page sits exactly at the inset)
AppShell .content   owns padding: var(--content-inset)   <-- only place the page inset is defined
TopBar .bar         horizontal padding var(--content-inset) (title aligns with content edge)
SideNav / TopBar / DeviceCard   box-shadow: var(--elevation-N), z-index: var(--layer-*)
StatusBadge         kind -> { lucide icon, default label, tone }; the ONLY badge; used by
                    DeviceCard, DeviceDetailView, DeviceDetail, DevicesView, DeviceGrid, EventLog, admin/users
```

No routing, Convex, or auth changes (R9 still holds).

## Tech decisions (addendum)

| Decision | Choice | Rationale | Rejected alternative |
|---|---|---|---|
| Icon set (R12) | **`lucide-react` `^1.47.0`** (latest on npm, ISC). Peer range `react ^16.5.1 \|\| ^17 \|\| ^18 \|\| ^19`, so React 18.3 is supported. `sideEffects: false`, ESM build. | All icons are drawn on one 24px grid with a uniform 2px stroke, so weight and size match by construction. Tree-shakeable. Next 16.3 lists `lucide-react` in its default `optimizePackageImports`, so no `next.config` change is needed. v1 renders `aria-hidden="true"` by default. It has every shape needed (wifi, wifi-off, clock-alert, circle-question-mark, ban, triangle-alert, circle-x, circle-check, circle-minus). | `@heroicons/react` 2.2.0: only about 300 icons, with no wifi-off or clock-alert equivalents. `@phosphor-icons/react` 2.1.10: context-based weights, and needs its separate `/ssr` entry for RSC. `@tabler/icons-react` 3.48.0: comparable, but lucide has the larger ecosystem and is on Next's default optimize list alongside it. Tabler is the fallback if lucide is blocked. |
| Icon sizing/stroke | The icon is rendered at one site only (inside `StatusBadge`) with no per-kind props. CSS `.icon { width/height: var(--icon-size-sm); stroke-width: var(--icon-stroke); flex-shrink: 0 }`, and the badge uses `inline-flex; align-items: center` | One render site means sizes cannot drift. CSS overrides the SVG presentation attributes. Optical alignment comes from centering on the flex axis. | Per-call `size`/`strokeWidth` props (they drift); `absoluteStrokeWidth` (not needed at a single size) |
| Accessible text (R12) | The icon is `aria-hidden` (lucide default, also passed explicitly). The visible text label is the accessible name. The badge root is a plain `<span>`. | The label is already visible, so screen readers read it once. A `<title>` or `aria-label` on the icon would be announced twice. | `role="status"` (that is a live region, which is wrong for static badges); `role="img"` + `aria-label` on the SVG |
| Elevation on dark (R10) | Each level = a shadow **plus** a tonal surface step (level 0 bg, level 1 surface, level 2 surface-raised) plus a faint 1px top inner highlight | Material's dark-theme guidance says shadows lose contrast on dark backgrounds, and that lighter surfaces are what signal height. The existing bg/surface/surface-raised steps already provide the tonal part. The inner highlight adds a lit top edge that stays visible when the border is ignored. | Shadows only (almost invisible on `#0B1020`); lighter surface overlays only (no depth at the edges) |
| Motion (R11) | A single duration token plus a single easing token, and a lift token that becomes `0px` under `prefers-reduced-motion: reduce` | The spec asks for "one shared duration". Only the lift causes movement, so zeroing that one token removes all movement everywhere at once. Color and shadow fades stay (MDN: non-motion transitions are acceptable). | Multiple durations (breaks "one shared token"); `transition: none` under reduce (not needed, and it makes state changes snap) |
| Default transitions | Put them in `globals.css` under `:where(...)` (zero specificity) | Every link, button and control gets the transition and state rules once. `:where` makes sure CSS Module classes (`.card`, `.item`) always win, so the plain `a:hover` color does not override them. | Per-module transition declarations (duplication); plain `a:hover` (its specificity 0,1,1 beats `.card` 0,1,0) |
| Content inset (R14) | `--content-inset: var(--space-6)` (an alias of a spacing token). `AppShell .content` padding and `TopBar .bar` horizontal padding both use it. Pages set none. | One knob. The top-bar title and the page content line up on the same left edge. Its value is the `--space-6` that every page already used, so nothing visibly moves except the removed double padding on `/devices/[id]`. | A padding prop on each page; a route-group layout (a structural change the R1–R9 plan already rejected) |
| Clickable device rows | Rows in `DevicesView`'s `DeviceList` become a `<button type="button" aria-pressed>` inside the `<li>`, styled from a new `DevicesView.module.css` | Today they are `<li onClick>`, which cannot take keyboard focus, so R11's focus state is impossible. Inline styles also cannot express `:hover`/`:active`. Click behavior stays the same (R9). | Adding `tabIndex` + a key handler to the `<li>` (reinvents a button) |

## Token additions (`frontend/styles/tokens.css` + `styles/README.md`)

Colors (these join the contrast test):

| Token | Value | Use |
|---|---|---|
| `--color-surface-hover` | `#253052` | hover fill for buttons and pressed nav items (text about 12:1, muted about 5.3:1, hand-computed; the test is the gate) |
| `--color-accent-hover` | `#86b6ff` | link hover (lighter than accent, so contrast only goes up) |
| `--color-accent-bg` | `rgba(91, 157, 255, 0.14)` | tint for the `active` badge ("In service" / "Active") |

Elevation (README gets a new "Elevation" table with a **Use** column, as R10 requires):

| Token | Value | Paired surface | Intended use |
|---|---|---|---|
| `--elevation-0` | `none` | `--color-bg` | flat: page background and inline content inside a surface |
| `--elevation-1` | `0 1px 2px rgba(0, 0, 0, 0.5), 0 2px 6px 1px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.04)` | `--color-surface` | resting raised surfaces: cards, sidebar, top bar; pressed card |
| `--elevation-2` | `0 2px 4px rgba(0, 0, 0, 0.5), 0 8px 16px 2px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)` | `--color-surface-raised` | hovered interactive surfaces (card hover); future menus and popovers |
| `--layer-topbar` | `1` | n/a | stacking so the top-bar shadow falls on the content |
| `--layer-sidebar` | `2` | n/a | stacking so the sidebar shadow falls over the top bar and content |

The shadow alphas are a starting point. The manual R10 screenshot check is the gate. If surfaces don't read as raised, the
builder may raise the shadow and highlight alphas only. The palette stays as it is.

Motion:

| Token | Default | Under `prefers-reduced-motion: reduce` | Use |
|---|---|---|---|
| `--motion-duration` | `150ms` | unchanged | every state transition (the one shared duration) |
| `--motion-ease` | `cubic-bezier(0.2, 0, 0, 1)` | unchanged | Material 3 "standard" easing |
| `--motion-lift` | `-2px` | `0px` | card hover `translateY`, which is the only movement in the app |

Icon: `--icon-size-sm` `0.875rem`, `--icon-stroke` `2`. Layout: `--content-inset` `var(--space-6)`.

The override block is a second `:root` inside `@media (prefers-reduced-motion: reduce)` in `tokens.css`. That keeps the
"tokens only in tokens.css" rule. **Pitfall:** `tokens.test.ts`'s `parseTokens` is last-wins across the file. The new motion
tests must parse the default `:root` block and the media block separately.

## Interaction states (R11)

| Element | Hover | Pressed (`:active`) | Keyboard focus |
|---|---|---|---|
| Link (global `:where(a)`) | `--color-accent-hover` | `--color-text` | accent outline (see below) |
| Button (global `:where(button:not(:disabled))`) | bg `--color-surface-hover` | bg `--color-surface` | accent outline |
| Native input/select/textarea | border `--color-text-muted` | none (not in the R11 list) | accent outline |
| Nav item (`SideNav .item`) | bg surface-raised, text color (already exists) | bg `--color-surface-hover` | accent outline, `outline-offset: -2px` (inside the item) |
| Brand link (`SideNav .brand`) | `--color-accent-hover` | `--color-text-muted` | accent outline |
| Device card (`DeviceCard .card`) | `--elevation-2`, bg surface-raised (stale: tint over raised), `translateY(var(--motion-lift))` | `--elevation-1`, `translateY(0)` | accent outline |
| Device list row button (`DevicesView`) | bg surface-raised | bg `--color-surface-hover` | accent outline, inset |

Focus is animated too: at rest, interactive elements carry `outline: 2px solid transparent; outline-offset: 2px`, and
`:focus-visible` changes only `outline-color`. That transitions smoothly and still shows in Windows forced-colors mode.
The transition property list is explicit: `color, background-color, border-color, box-shadow, outline-color, transform`.
`transition: all` is banned.

## Status icon mapping (R12)

| Kind | lucide component | Tone (color / tint) | Default label |
|---|---|---|---|
| `online` | `Wifi` | success / success-bg | Online |
| `offline` | `WifiOff` | danger / danger-bg | Offline |
| `stale` | `ClockAlert` | warning / warning-bg | Stale |
| `unknown` | `CircleQuestionMark` | neutral / neutral-bg | Unknown |
| `decommissioned` | `Ban` | decommissioned / neutral-bg | Decommissioned |
| `warning` | `TriangleAlert` | warning / warning-bg | Warning |
| `error` | `CircleX` | danger / danger-bg | Error |
| `active` (new) | `CircleCheck` | accent / accent-bg | Active |
| `inactive` (new) | `CircleMinus` | neutral / neutral-bg | Inactive |

All 9 shapes are distinct, so R2 grayscale still holds. `STATUS_GLYPH` (Unicode) is removed and replaced by a
`STATUS_ICON` map. The optional `label` override stays. The old `DeviceDetail` `muted` variant is dropped: R13 says the badge
"looks identical everywhere". Device-registry R28, which asks for lifecycle to be distinct from connectivity, is still met
because there are two separate badges with lifecycle first.

## Inventory: ad hoc status indicators to migrate (R12, R13)

| # | Location | Today | Becomes |
|---|---|---|---|
| S1 | `frontend/components/StatusBadge.tsx:15-23` | `STATUS_GLYPH` Unicode map `● ○ ◐ ? ⊘ ⚠ ✕` | `STATUS_ICON` lucide map (above) |
| S2 | `frontend/components/DeviceCard.tsx:47-51` + `DeviceCard.module.css:27-38` (`.staleBadge`) | `⚠ Stale · 3m ago` / `⚠ Never reported` span | `StatusBadge kind="stale" label="Stale · {age}"`; never reported becomes `kind="unknown" label="Never reported"`. Delete `.staleBadge`. |
| S3 | `frontend/components/DeviceCard.tsx:57-59` | `Status: <strong>{status}</strong>` | `Status: <StatusBadge kind={status} />` in the same `<p>` (keeps `DeviceCard.test.tsx:26` valid) |
| S4 | `frontend/app/devices/[deviceId]/DeviceDetailView.tsx:53-55` + `DeviceDetailView.module.css:6-14` (`.decommissioned`) | pill `<p>Decommissioned</p>` | `StatusBadge kind="decommissioned"`; delete the CSS rule |
| S5 | `DeviceDetailView.tsx:60-63` | `Status: <strong>{status}</strong>` | `Status: <StatusBadge kind={status} />` |
| S6 | `DeviceDetailView.tsx:64-68` + `DeviceDetailView.module.css:16-27` (`.staleBadge`) | `⚠ Stale` / `⚠ Never reported` | `StatusBadge` stale / unknown as in S2; delete the CSS rule |
| S7 | `frontend/app/devices/DeviceDetail.tsx:9-19` (`CONNECTIVITY_LABEL`/`_COLOR`), `:21-38` (local `Badge`), `:130-135` (usage) | second badge implementation (inline styles, `on-accent` text on a solid fill, muted opacity) | delete the maps and `Badge`. Lifecycle: `StatusBadge kind={decommissioned ? "decommissioned" : "active"} label={... "In service"}`. Connectivity: `StatusBadge kind={device.status}` |
| S8 | `frontend/app/devices/DevicesView.tsx:251` | `— decommissioned` / `— {status}` plain text in the row | `StatusBadge kind={lifecycle === "decommissioned" ? "decommissioned" : status}` |
| S9 | `frontend/app/devices/DevicesView.tsx:187-189` | `<h3>{groupValue} (n)</h3>` (a status word when `group=status`) | when `groupBy === "status"`: `<h3><StatusBadge kind={groupValue} /> (n)</h3>`; other groupings unchanged |
| S10 | `frontend/components/DeviceGrid.tsx:45` | `<h2>{key}</h2>` (a status word when grouping by status) | same rule as S9; zone/type headings unchanged (keeps `DeviceGrid.test.tsx:35-36`) |
| S11 | `frontend/app/admin/users/page.tsx:102` | `Active` / `Deactivated` text | `StatusBadge kind="active"` / `kind="inactive" label="Deactivated"` |
| S12 | `frontend/components/EventLog.tsx:50-52` + `EventLog.module.css:24-28` (`.gap` warning color) | `⋯ gap of 5m` in warning color | `<li className={styles.gap}><StatusBadge kind="warning" label="Gap of 5m" /></li>`; `.gap` keeps its padding only (keeps the `/gap of/i` tests) |

Reviewed and **excluded** (interpretation 1): `DeviceDetail.tsx:152-158` (rejected-readings notice), `DeviceDetail.tsx:171`,
`admin/users/page.tsx:71`, `:194`, and `signin/page.tsx:66` (error messages); `DevicesView.tsx:139-147` and `FilterBar.tsx`
(status `<select>` options); `DevicesView.tsx:172-177` (facet count line); `TopBar.tsx:30` (role chip). Non-status
Unicode stays: `←` back links, `→`/`∅` in change history, `—` empty metric, `·` separators, `…`.

## Inventory: per-page outer padding to remove (R14)

| # | Location | Today | Becomes |
|---|---|---|---|
| P1 | `frontend/app/page.tsx:24` | Suspense fallback `<main style={{ padding: "var(--space-6)" }}>` | `<main>` with no style |
| P2 | `frontend/app/page.tsx:74` | `<main style={{ padding: "var(--space-6)" }}>` | `<main>` |
| P3 | `frontend/app/devices/page.tsx:9` | fallback `<p style={{ padding: "var(--space-6)" }}>` | `<p>` |
| P4 | `frontend/app/devices/DevicesView.tsx:107` | `<main style={{ display: "flex", gap, padding }}>` | `<main className={styles.layout}>` (flex + gap in the new module, no padding) |
| P5 | `frontend/app/devices/[deviceId]/DeviceDetailView.module.css:2` (applied at `DeviceDetailView.tsx:28, 35, 50`) | `.main { padding: var(--space-6); max-width: 720px }` | keep `max-width`, drop `padding` |
| P6 | `frontend/app/admin/users/page.tsx:21` | `<main style={{ padding }}>` (loading) | `<main>` |
| P7 | `frontend/app/admin/users/page.tsx:28` | `<main style={{ padding }}>` (not available) | `<main>` |
| P8 | `frontend/app/admin/users/page.tsx:65` | `<main style={{ padding }}>` | `<main>` |

The shell owns the padding:
- `AppShell.module.css .content { padding: var(--content-inset); min-width: 0 }`.
- `TopBar.module.css .bar` padding becomes `0 var(--content-inset)`, so its title aligns with the content's left edge.
- `globals.css` gets `h1 { margin-block: 0 var(--space-4) }` so the first line of every page sits exactly at the inset. Today
  some pages start with a default-margin `<h1>` and admin's `<h1>` has `margin: 0`, so the visible inset differs by about 1em.
  The inline `margin: 0` at `admin/users/page.tsx:67` becomes redundant and is removed.

`/signin` (`app/signin/page.tsx:33-38`) is exempt: it renders bare, outside the shell.

## Elevation applied (R10)

- `SideNav.module.css .sidebar`: `box-shadow: var(--elevation-1)`, `z-index: var(--layer-sidebar)`. It is already `position: sticky`.
- `TopBar.module.css .bar`: `box-shadow: var(--elevation-1)`, `position: relative`, `z-index: var(--layer-topbar)`.
- `DeviceCard.module.css .card`: `var(--elevation-1)` at rest and `var(--elevation-2)` on hover.
- Borders stay as a secondary edge. The depth cue has to work without them (R10 acceptance).

## Test strategy

Automated (Vitest/jsdom, all within `npm test`):

| Req | Test | What it asserts |
|---|---|---|
| R10 | `styles/tokens.test.ts` (extend) | At least 2 `--elevation-*` tokens. The README Elevation table has a non-empty **Use** cell for each. Parity already covers documentation. |
| R10 | `styles/literals.test.ts` (extend) | In `app/`, `components/` and `styles/globals.css`, every `box-shadow`/`boxShadow` value is `var(--elevation-N)` or `none`, and every `z-index`/`zIndex` is `var(--layer-*)`. `SideNav .sidebar`, `TopBar .bar` and `DeviceCard .card` each declare `box-shadow: var(--elevation-`. Scanner self-checks are added for both patterns. |
| R11 | `styles/tokens.test.ts` (extend) | `--motion-duration`, `--motion-ease` and `--motion-lift` exist in the default `:root`. A `@media (prefers-reduced-motion: reduce)` block exists and sets `--motion-lift` to `0px`/`0`. The default lift is non-zero. Contrast: text and muted on `--color-surface-hover`; accent-hover on bg, surface and raised; accent on `--color-accent-bg` over surface and bg. |
| R11 | `styles/literals.test.ts` (extend) | No `transition`/`transition-duration`/`animation` declaration outside `tokens.css` contains a time literal (`\d+m?s`) or `all`. Every `transform` in `app/` and `components/` references `var(--motion-lift)` or is `none`/`translateY(0)`, so reduced motion covers every movement. |
| R11 | `styles/interaction.test.ts` (new) | A static table of (file, selector). For `globals.css` the selectors are `a`, `button` and `input`-group. For `SideNav.module.css` they are `.item` and `.brand`. Then `DeviceCard.module.css .card` and `DevicesView.module.css` row. Each must have `:hover` and `:active` rules. `globals.css` must have the `:focus-visible` outline-color rule and the transparent resting outline. The global transition rule must use `var(--motion-duration)` and `var(--motion-ease)`. |
| R11 | `DevicesView` row | Covered by the interaction test above. Rows are real `<button>`s (a static check that `DevicesView.tsx` has no `<li ... onClick`). |
| R12 | `components/StatusBadge.test.tsx` (rewrite) | For each of the 9 kinds: exactly one `svg` with `aria-hidden="true"` and class `lucide`; `badge.textContent` equals the label exactly (no hidden glyph characters); `getByText(label)` finds it. `STATUS_ICON` components are unique across kinds (grayscale). All rendered SVGs share the same `width`/`height`/`stroke-width` attributes (one render site). The label override keeps the icon. |
| R12 | `styles/literals.test.ts` (extend) | Bans status-symbol code points in `app/`, `components/` and `lib/` source outside tests: U+25A0–25FF (geometric shapes), U+2600–27BF (misc symbols and dingbats, including ⚠ ✓ ✕), U+2295–229B (circled operators, including ⊘), U+2B00–2BFF, and U+1F300–1FAFF (emoji). Allowed on purpose: arrows U+2190–21FF, `∅`, `⋯`, `—`, `·`, `…`. Self-check: `⚠` is flagged and `←` is not. |
| R13 | `styles/literals.test.ts` (extend) | (a) Exactly one badge implementation: no `function \w*Badge` / `const \w*Badge =` definition outside `components/StatusBadge.tsx`, and no CSS Module class matching `/badge\|pill/i` outside `StatusBadge.module.css`. (b) Status colors (`--color-success\|warning\|danger\|neutral\|decommissioned` and their `-bg`) appear only in `StatusBadge.module.css`, plus an explicit allowlist with reasons: `DeviceCard.module.css` stale-card border and tint, and the error/notice text colors in the excluded list above. (c) `lucide-react` is imported only by `components/StatusBadge.tsx`. |
| R13 | component tests (add cases, existing ones unmodified) | `DeviceCard`: live, stale and never render `[data-kind="online"]`, `[data-kind="stale"]` and `[data-kind="unknown"]`. `DeviceDetailView`: decommissioned renders `[data-kind="decommissioned"]`. `EventLog`: the gap renders `[data-kind="warning"]`. `DeviceGrid` with `groupBy="status"`: the heading contains a badge. |
| R14 | `styles/literals.test.ts` (extend) | In `app/**` except `app/signin/**`: no `<main` with a `style` containing `padding`, no Suspense `fallback={<… style={{ padding …` and no padding in a module rule whose class is applied to `<main>` (`.main`, `.layout`). `AppShell.module.css .content` declares `padding: var(--content-inset)`. `TopBar.module.css .bar` uses `var(--content-inset)`. `--content-inset` resolves to a `--space-*` token. |
| R9 | existing suites | `DeviceCard`, `DeviceGrid`, `DeviceDetailView`, `EventLog`, `AppShell`, `nav`, `FilterBar` and `MetricTable` tests must pass **unmodified**. The inventory above was chosen so they do. `StatusBadge.test.tsx` is the one suite that gets rewritten, because the glyph API it asserted is removed. |

Manual checks (builder, then reviewer, in a browser at 1440px and 1024px):
- R10: screenshot `/` and `/devices/[id]` with DevTools overriding `border-color: transparent`. Cards, sidebar and top bar must still read as raised.
- R11: for nav item, link, button, device card and device list row, hover, press and Tab to each. Each state must be visible. A screen recording (or the DevTools Animations panel) shows a roughly 150ms transition. Then turn on DevTools "Emulate CSS prefers-reduced-motion: reduce" (and the macOS Reduce motion setting once): card hover has no lift, and the color and shadow changes still happen.
- R12: view all badge kinds side by side (the device detail and devices list cover most of them; the admin page covers active/inactive). Weight, size and baseline should match. VoiceOver reads the label once, e.g. "Stale · 3m ago".
- R13: the badge looks the same on card, detail, list, grouped headings, event log and admin.
- R14: click through Overview, Devices, a device detail page and Users. The first content line and left edge don't move between routes, and they line up with the top-bar title.
- R2 again: grayscale emulation. All 9 icon shapes and labels are distinguishable.

## Requirement coverage (addendum)

| Req | Addressed by |
|---|---|
| R10 | `--elevation-0/1/2` + `--layer-*` tokens, each with a documented use and paired surface; applied to `.sidebar`, `.bar`, `.card`; box-shadow/z-index literal ban; manual border-less screenshot |
| R11 | `--motion-duration`/`--motion-ease`/`--motion-lift` + reduced-motion override; global `:where()` state + transition rules; per-component hover/active for nav, brand, card, device rows (rows become buttons); `interaction.test.ts`, transition/transform literal ban; manual recording and reduced-motion check |
| R12 | `lucide-react` 1.x as the single set; one icon render site in `StatusBadge` sized and stroked by tokens; `aria-hidden` icon + visible label; Unicode status glyph ban; rewritten `StatusBadge.test.tsx`; manual VoiceOver check |
| R13 | inventory S1–S12 migrated; local `Badge`, `.staleBadge`, `.decommissioned` and `.gap` color removed; single-implementation, status-color-location and lucide-import scans; `data-kind` assertions in component tests |
| R14 | `--content-inset` owned by `AppShell .content` and shared with `TopBar`; inventory P1–P8 removed; `h1` margin reset; page-padding scan; manual route click-through |

## Risks & unknowns (addendum)

- **Shadows barely visible on `#0B1020`.** Mitigation: the tonal surface step and the inset highlight carry the cue. The manual check gates it, and only shadow and highlight alphas may be tuned.
- **lucide v1 and React Server Components.** Upstream issue #4230 (open) reports that v1 icon exports are treated as client references when *called as functions* from server code. All `StatusBadge` callers here are client components (`"use client"` files), and normal JSX use is unaffected. Mitigation: `next build` in the builder's checklist. If it fails, add `"use client"` to `StatusBadge.tsx`.
- **Icon export names.** lucide renamed several icons over time (for example `HelpCircle` became `CircleHelp` and then `CircleQuestionMark`). The names above were checked against lucide.dev today. The builder confirms them against the installed version with `tsc`. If one is missing, pick the nearest same-meaning icon and update the mapping table.
- **Local Next docs not available.** `frontend/node_modules` is not installed in this checkout, so the `AGENTS.md` instruction to read `node_modules/next/dist/docs` could not be followed at planning time. The `optimizePackageImports` default comes from nextjs.org docs for 16.3.6 instead. The builder should re-check it after `npm install`.
- **Lockfile / CI.** The new dependency needs the updated `package-lock.json` committed. The Docker and Netlify builds run `npm ci`/`npm install` from it.
- **`:where()` specificity.** If the builder writes the global state rules without `:where`, `a:hover` overrides `.card`'s `color: inherit`. This is called out in the decisions table and caught by manual R11 checks.
- **Heuristic scans.** The page-padding and badge-duplication scans are regex heuristics. They catch the known patterns but not every possible spelling. The reviewer still does a grep pass, as for R7.
- **Visual change on the device detail (registry) page:** the connectivity badge is no longer dimmed for decommissioned devices. Lifecycle stays first and separate, so device-registry R28 holds.

## Sources (addendum)

- lucide-react npm metadata (version 1.47.0, peer deps, sideEffects, license): https://registry.npmjs.org/lucide-react/latest
- lucide-react guide (tree-shaking, `aria-hidden` default, `lucide lucide-<name>` classes): https://lucide.dev/guide/packages/lucide-react
- Lucide v1 migration notes (aria-hidden default, ESM/CJS only, context providers): https://lucide.dev/guide/version-1
- Lucide releases (1.47.0 latest): https://github.com/lucide-icons/lucide/releases
- Lucide v1 RSC issue: https://github.com/lucide-icons/lucide/issues/4230
- Icon pages checked: https://lucide.dev/icons/circle-question-mark, https://lucide.dev/icons/clock-alert,
  https://lucide.dev/icons/triangle-alert, https://lucide.dev/icons/wifi-off, https://lucide.dev/icons/circle-x,
  https://lucide.dev/icons/circle-minus, https://lucide.dev/icons/ban, https://lucide.dev/icons/circle-check
- Alternatives: https://registry.npmjs.org/@heroicons/react/latest (2.2.0), https://registry.npmjs.org/@phosphor-icons/react/latest (2.1.10),
  https://registry.npmjs.org/@tabler/icons-react/latest (3.48.0)
- Next.js `optimizePackageImports` defaults (docs version 16.3.6): https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports
- `prefers-reduced-motion` guidance: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- Dark-theme elevation (overlays over shadows): https://m2.material.io/design/color/dark-theme.html,
  https://medium.com/androiddevelopers/dark-theme-with-mdc-4c6fc357d956
- Motion easing/duration reference (M3 standard easing `cubic-bezier(0.2, 0, 0, 1)`, short durations): https://m3.material.io/styles/motion/easing-and-duration/tokens-specs

---
---

# Tailwind + Headless UI migration (R15–R18)

> Planner addendum for the 2026-09-23 technology constraint (spec "Constraints" section, R15–R18) and the R17
> testability rewrite. R1–R14 are built and PASS. Their *outcomes* must keep holding. This section changes *how* they
> are implemented. Earlier sections stay as the record of what was built. Where a decision below contradicts them, this
> section wins (see "Superseded decisions"). File:line references are from the current working tree (R10–R14 built,
> uncommitted).

## Requirements covered

- R15: one utility theme source holds every token, with no per-component stylesheets or inline values.
- R16: interactive elements that need keyboard/ARIA behavior use Headless UI.
- R17: ten documented UI conventions, each with one implementation.
- R18: no behavior change, and existing tests pass or are equivalently rewritten.

**R17 as agreed with spec-writer (final, in spec.md):** ten named conventions, each documented in
`frontend/styles/README.md` ("UI conventions") with its intended use and single implementation:
(1) shell layout, (2) account menu, (3) page heading, (4) card, (5) badge = StatusBadge, (6) table, (7) form field,
(8) button (primary/secondary), (9) focus ring (outset by default, inset for form controls and nav rows),
(10) selectable list (the DevicesView device rows). AC17 has four parts:
- (a) README entries for all ten.
- (b) A static test that each convention has exactly one implementation, and that focus utilities appear only there and in the base layer.
- (c) The primary render of each authenticated page starts with `PageHeading` (loading and error branches exempt). Every
  `<button>` is the shared Button or sits inside another convention's single implementation (account menu, selectable
  list). Every `<table>` uses Table.
- (d) A manual page-by-page review against the README.

## Superseded decisions from earlier sections

| Earlier decision (section) | Superseded by |
|---|---|
| CSS custom properties in `:root` of `tokens.css` are the token mechanism (R1–R9 "Tech decisions") | Tailwind v4 `@theme` block in `tokens.css`. Tokens become theme variables, which Tailwind still emits as CSS variables. |
| CSS Modules per component, `var(--token)` only (R1–R9 "Shell styling") | Utility classes only. All 11 `*.module.css` files are deleted. |
| `globals.css` element rules plus `:where()` interaction defaults (R10–R14 "Default transitions") | Tailwind Preflight plus a minimal `@layer base`. Interaction states live in the convention recipes. |
| `--motion-lift` token zeroed under reduced motion (R10–R14 "Motion") | Movement utilities only behind the `motion-safe:` variant. The token is removed. |
| `--layer-topbar` / `--layer-sidebar` tokens (R10–R14) | A documented z-index scale `z-10` / `z-20` / `z-30`, enforced by test |
| `--content-inset` token (R10–R14 R14) | `--spacing-content` theme key (`p-content`, `px-content`) |
| Token names `--color-bg`, `--color-text`, `--color-text-muted`, `--space-N`, `--text-md`, `--text-lg/xl`, `--weight-*`, `--radius-pill`, `--elevation-N` | Renamed to Tailwind namespaces (table below) |
| `literals.test.ts` / `interaction.test.ts` CSS scanning | Rewritten to scan class strings (see "Static tests") |
| `lucide-react` 1.x for status icons (R10–R14) | **Kept**, not superseded (see decisions) |

## Architecture

```
postcss.config.mjs  -> @tailwindcss/postcss
app/layout.tsx      -> imports styles/globals.css only
styles/globals.css  = @import "tailwindcss";  @import "./tokens.css";  @layer base { ...minimal base... }
styles/tokens.css   = @theme { namespace resets + every design token }   <-- single source (R1, R15)
styles/README.md    = token tables + "UI conventions" (R17 a)

components/ui/      one implementation per convention (R17), Headless UI underneath where keyboard/ARIA matters (R16)
  Button.tsx        Headless Button; variant: primary | secondary; exports recipe strings for Headless "as" use
  Card.tsx          div or next/link; interactive flag adds hover/pressed/lift
  PageHeading.tsx   h1 left, actions slot right
  Table.tsx         Table/THead/TBody/Th/Td wrappers (inside a Card surface)
  Field.tsx         Headless Field/Label/Description + Input/Select/Checkbox wrappers + ErrorText
  SelectableList.tsx  convention 10: rows = Headless Button with aria-pressed
components/shell/   AppShell (layout + content inset), SideNav (nav rows), TopBar (title + AccountMenu via Headless Menu)
components/StatusBadge.tsx  unchanged API; classes via a static kind -> class map
lib/cx.ts           tiny class-join helper (no clsx/tailwind-merge dependency)
```

Class strings are always complete static literals. Recipes are maps of whole class strings, never interpolated
fragments, because Tailwind detects classes by plain-text scanning.

## Tech decisions

| Decision | Choice | Rationale | Rejected alternative |
|---|---|---|---|
| Styling engine | **`tailwindcss` 4.3.x** (npm latest 4.3.3) + **`@tailwindcss/postcss`** + `postcss`, configured in `postcss.config.mjs` with the single plugin `"@tailwindcss/postcss"`, and `@import "tailwindcss"` in the CSS entry | Mandated. This is exactly the official Next.js guide (it references v4.3). CSS-first config means no `tailwind.config.js`. | Tailwind v3 + JS config (legacy); Tailwind alongside CSS Modules (Tailwind docs advise against it: each module is processed separately and slows builds) |
| Theme config | One `@theme` block in `styles/tokens.css`, **resetting** the default namespaces we replace (`--color-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`, `--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--text-shadow-*`, `--ease-*`, `--animate-*` all `: initial`), then defining ours | Resetting removes `bg-gray-800`, `shadow-lg` and similar, so only token utilities generate CSS. That is R7/R15 enforced by the build. The static test catches classes that silently generate nothing. `@theme` (not `inline`) because values are literals. | Keeping the default palette alongside ours (invites raw palette use); `--*: initial` full reset (also kills container/breakpoint scales we use, such as `min-w-5xl`) |
| Spacing | Keep Tailwind's documented `--spacing: 0.25rem` multiplier. The **allowed steps** are 0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12 (= the old `--space-1..7` values plus 0.125rem and 0.375rem half-steps from Tailwind UI badge/input recipes). Named layout keys: `--spacing-sidebar: 14.5rem`, `--spacing-topbar: 3.5rem`, `--spacing-content: 2rem`, `--spacing-icon: 0.875rem` | Class names keep their standard Tailwind meaning (`p-4` = 1rem), which is what Tailwind UI recipes assume. The closed step set is enforced by the static test and documented in the README table. Named keys give R14 its single knob (`p-content`). | Named-only spacing keys with no multiplier (padding docs only document the multiplier, so it is uncertain whether `p-4` would still resolve) |
| Type scale | Tailwind names by value: `--text-xs` 0.75rem, `--text-sm` **0.875rem** (was 0.85), `--text-base` 1rem (was `md`), `--text-xl` 1.25rem (was `lg`), `--text-2xl` 1.5rem (was `xl`), each with a `--text-*--line-height`. `--leading-tight` 1.25, `--leading-normal` 1.5. Weights `--font-weight-normal` 400, **`--font-weight-medium` 500 (new)**, `--font-weight-semibold` 600 | With these names, Tailwind UI recipes (`text-sm font-medium`, page heading `text-2xl`) map one-to-one. 0.85 to 0.875 is a sub-pixel change. Medium is used by badges and labels in the R17 conventions. | Keeping old names (`text-md` does not exist in Tailwind vocabulary, which confuses anyone following Tailwind UI) |
| Colors | Theme names: `canvas` (was bg), `surface`, `surface-raised`, `surface-hover`, `border`, `fg` (was text), `fg-muted`, `accent`, `accent-hover`, `accent-bg`, `on-accent`, `success`, `warning`, `danger`, `neutral`, `decommissioned`, `success-bg`, `warning-bg`, `danger-bg`, `neutral-bg`. **Hex/rgba values unchanged.** | This avoids `bg-bg` / `text-text`. The values are the contrast-tested R6/R10/R11 values, so no re-tuning is needed. | Keeping names |
| Radius | `--radius-sm` 0.25rem, `--radius-md` 0.375rem, `--radius-lg` 0.5rem. Pill = `rounded-full` (built-in keyword) | Tailwind UI convention: cards `rounded-lg` (8px, same as today's cards), controls/buttons/badges `rounded-md`. The old 12px `lg` is unused. | Old 4/8/12 names (they would shift every Tailwind UI recipe by one step) |
| Elevation (R10) | `--shadow-1` / `--shadow-2` = today's `--elevation-1/2` values, used as `shadow-1` / `shadow-2` / `shadow-none`. Z-scale is `z-10` top bar, `z-20` sidebar, `z-30` account-menu popover, documented and enforced by test. | Same values that passed R10. The menu popover uses level 2 as the R10 table already reserved. | New shadow values; Tailwind default shadows (tuned for light UIs) |
| Motion (R11) | In `@theme`: `--default-transition-duration: 150ms`, `--default-transition-timing-function: cubic-bezier(0.2, 0, 0, 1)`. Elements use `transition` / `transition-colors` / `transition-shadow` with **no** `duration-*` or `ease-*` class. Movement (`-translate-y-0.5` card lift, `scale-95` menu enter) is only allowed behind `motion-safe:`. | Tailwind's documented defaults variables make the one shared duration a theme token. `motion-safe:` is the built-in reduced-motion mechanism, and under `reduce` color, background and shadow still transition, exactly as clarified in R11. | Custom `--motion-duration` + `duration-(--x)` (arbitrary syntax, which is banned); `motion-reduce:transition-none` (it would also kill the allowed color fades) |
| Dark-only (R6) | No `dark:` variant anywhere (banned by test). The palette *is* dark. `color-scheme: dark` on `:root` in the base layer, so native controls and scrollbars render dark. | One theme means no variant. Tailwind's default `dark:` is `prefers-color-scheme`, which would make styling depend on OS settings. | `@custom-variant dark` + `class="dark"` (a toggle mechanism the spec defers) |
| Headless UI (R16) | **`@headlessui/react` 2.2.x** (npm latest 2.2.10; peer `react ^18 \|\| ^19`, so React 18.3 is supported). Components used: `Menu`, `Button`, `Field`, `Label`, `Description`, `Fieldset`, `Legend`, `Input`, `Select`, `Checkbox`, `Disclosure`. **Not** `Listbox` or `Dialog`. | `Select` and `Input` are light wrappers around the **native** elements. They add label/description association and `data-hover`/`data-focus`/`data-invalid`, and keep native keyboard behavior and `userEvent.selectOptions`, so filter behavior and tests are unchanged (R18). `Menu` gives the account menu full keyboard/ARIA handling. `Disclosure` adds `aria-expanded` to the existing history toggle. No confirmation dialogs exist today, so `Dialog` is not introduced (no new features). | `Listbox` custom dropdowns for filters (it changes the keyboard model and every select test, which is an R18 risk, for no requirement); Radix (not mandated) |
| Icons | **Keep `lucide-react` 1.x.** Sized with `size-icon`; stroke stays lucide's default 2. | R12 is built, reviewed and passing. Tailwind UI's use of Heroicons is not part of the R17 conventions. Heroicons lacks wifi-off and clock-alert equivalents (see R10–R14 decision). | Switching to `@heroicons/react` (churn, and a worse fit) |
| Class merging | Local `lib/cx.ts` (join truthy strings). Recipes are designed not to conflict, so no `tailwind-merge` is needed. | Zero dependencies. Tailwind UI and Catalyst use plain `clsx`-style joins. | `clsx` + `tailwind-merge` (two dependencies for a 3-line need) |
| Conditional state styling | Active nav item, selected row and stale card choose between whole class strings in TSX. Headless UI's boolean `data-*` variants (`data-hover:`, `data-active:`, `data-focus:`, `data-open:`, `data-closed:`) are used where the element is a Headless component. | `aria-[current=page]:` and `data-[freshness=stale]:` are arbitrary variants, which the ban on `[`…`]` forbids. Whole-string switching is the Tailwind UI pattern anyway. | Arbitrary variants |

## Token mapping (`styles/tokens.css` → `@theme`)

| Old token (R1–R14) | New theme variable | Utility examples | Requirement kept |
|---|---|---|---|
| `--color-bg` / `-surface` / `-surface-raised` / `-surface-hover` / `-border` | `--color-canvas` / `-surface` / `-surface-raised` / `-surface-hover` / `-border` | `bg-canvas`, `bg-surface`, `border-border` | R1, R6 |
| `--color-text` / `-text-muted` | `--color-fg` / `-fg-muted` | `text-fg`, `text-fg-muted` | R6 |
| `--color-accent*`, `--color-on-accent` | same names | `text-accent`, `outline-accent`, `bg-accent`, `text-on-accent` | R11 |
| status colors + `-bg` tints | same names | used **only** in StatusBadge's static map plus the allowlist (see static tests) | R2, R13 |
| `--space-1..7` | `--spacing: 0.25rem` + allowed steps 1,2,3,4,6,8,12 (+0, 0.5, 1.5) | `p-4`, `gap-3`, `px-8` | R7 |
| `--content-inset` | `--spacing-content: 2rem` | `p-content`, `px-content` | R14 |
| `--sidebar-width` / `--topbar-height` | `--spacing-sidebar` / `--spacing-topbar` | `w-sidebar`, `h-topbar` | R8 |
| `--icon-size-sm` / `--icon-stroke` | `--spacing-icon` / lucide default | `size-icon` | R12 |
| `--font-sans` / `--font-mono` | same | `font-sans`, `font-mono` | R1 |
| `--text-xs/sm/md/lg/xl` | `--text-xs/sm/base/xl/2xl` | `text-sm` | R7 |
| `--weight-regular/semibold` | `--font-weight-normal/medium/semibold` | `font-semibold` | R7 |
| `--leading-*` | same | `leading-tight` | R1 |
| `--radius-sm/md/lg/pill` | `--radius-sm/md/lg` + `rounded-full` | `rounded-lg` | R1 |
| `--elevation-0/1/2` | `shadow-none` / `--shadow-1` / `--shadow-2` | `shadow-1` | R10 |
| `--layer-topbar/sidebar` | z-scale 10/20/30 (README + test) | `z-10` | R10 |
| `--motion-duration` / `--motion-ease` | `--default-transition-duration` / `--default-transition-timing-function` | `transition-colors` | R11 |
| `--motion-lift` + reduced-motion block | `motion-safe:hover:-translate-y-0.5` | (variant) | R11 |

The shell's minimum width (R8) is `min-w-5xl` (= 64rem = 1024px, from Tailwind's default `--container-*` scale, which is kept).
The same scale is used for page max-widths that exist today: `max-w-3xl` for device detail (was 720px), `max-w-xs` for
the admin create form (was 320px), and `max-w-sm` for signin (was 360px). These are small, documented rounding changes.

## Minimal documented base layer (`@layer base` in `globals.css`)

This is the only non-utility CSS. README lists each rule and why it exists (R15 allows a minimal documented base layer):
1. `:root { color-scheme: dark }` (R6).
2. `body`: canvas background, fg text, `font-sans`, `leading-normal`, via `var(--color-canvas)` and so on (theme variables).
3. Focus-ring convention (9): focusable elements (`a, button, input, select, textarea, summary, [tabindex]`) rest with a
   2px transparent outline at offset 2px, and `:focus-visible` sets `outline-color: var(--color-accent)`. That animates
   through the default transition, and a transparent outline still shows in forced-colors mode. The inset variant is the
   single class `-outline-offset-2`, used only by the Field control recipe and the nav-row recipe.
4. Plain inline links (`a` without a recipe, such as "Back to dashboard"): accent color, hover `accent-hover`, active `fg`,
   color transition. These are wrapped in `:where()` so recipes win.
5. `h2`, `h3` sizes and weights (Preflight unstyles headings, and content sections still use them). `h1` is styled only by PageHeading.

Nothing else: no control styling (that lives in the Field and Button recipes) and no margins.

## UI conventions (R17): implementation recipes

These are recipes, not code. Classes are indicative; the builder may adjust within the allowed tokens.

| # | Convention | Implementation | Recipe summary |
|---|---|---|---|
| 1 | Shell layout | `shell/AppShell`, `SideNav`, `TopBar` | `min-w-5xl` grid: `w-sidebar` sticky `h-screen` `bg-surface shadow-1 z-20` sidebar; `sticky top-0 z-10 h-topbar bg-surface shadow-1 px-content` top bar (title left, AccountMenu right); content `p-content *:space-y-6` (the shell also owns the vertical rhythm between page sections). Nav row: `flex rounded-md px-3 py-2 text-sm font-semibold transition-colors`; active `bg-surface-raised text-fg` + `aria-current` + semibold; inactive `text-fg-muted font-medium hover:bg-surface-raised hover:text-fg active:bg-surface-hover`; inset focus. |
| 2 | Account menu | `shell/AccountMenu` (Headless `Menu`) | `MenuButton` shows email + role chip (secondary-button look, but its own recipe). `MenuItems` `anchor="bottom end"` `bg-surface-raised shadow-2 z-30 rounded-md` with `transition data-closed:opacity-0 motion-safe:data-closed:scale-95`. One `MenuItem` renders a `button` "Sign out" (`data-focus:bg-surface-hover`) that runs the unchanged handler. |
| 3 | Page heading | `ui/PageHeading` | `flex items-center justify-between gap-4`; `h1 text-2xl font-semibold leading-tight text-fg`; `actions` slot right-aligned. |
| 4 | Card | `ui/Card` | `rounded-lg bg-surface border border-border shadow-1 p-4`, no margin. `interactive` (for next/link): `transition hover:bg-surface-raised hover:shadow-2 motion-safe:hover:-translate-y-0.5 active:shadow-1 motion-safe:active:translate-y-0`. `tone="warning"` swaps in whole warning border/tint classes (stale card, allowlisted). |
| 5 | Badge | `StatusBadge` | `inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium` + static per-kind tone class map; icon `size-icon shrink-0`. |
| 6 | Table | `ui/Table` | Wrapped in a Card surface. `min-w-full divide-y divide-border`; `th py-3 px-3 text-left text-sm font-semibold text-fg`; `td py-2 px-3 text-sm text-fg-muted`. |
| 7 | Form field | `ui/Field` (`Field`, `Label`, `Description`, `ErrorText`, `TextInput`, `SelectInput`, `CheckboxInput`, `FieldGroup`) | Label `block text-sm font-medium text-fg` above; control `block w-full rounded-md bg-surface-raised border border-border px-3 py-1.5 text-sm text-fg transition-colors data-hover:border-fg-muted -outline-offset-2`; description `text-sm text-fg-muted`; `ErrorText` `text-sm text-danger` (text, so R2 holds); `FieldGroup` = `space-y-4` stack. Form-level error messages also use `ErrorText`. |
| 8 | Button | `ui/Button` (Headless `Button`) + exported `buttonClasses(variant)` for `as` use (e.g. `DisclosureButton`) | Base `inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors`. Primary `bg-accent text-on-accent data-hover:bg-accent-hover data-active:bg-accent`. Secondary `bg-surface-raised text-fg border border-border data-hover:bg-surface-hover data-active:bg-surface`. `data-disabled:` muted text. |
| 9 | Focus ring | base layer rule 3 | 2px `outline-accent` at offset 2px; `-outline-offset-2` inset only in recipes 1 (nav row) and 7 (controls). |
| 10 | Selectable list | `ui/SelectableList` | `divide-y divide-border` list; row = Headless `Button` `w-full text-left px-3 py-2 transition-colors data-hover:bg-surface-raised data-active:bg-surface-hover`, selected `bg-surface-raised`, `aria-pressed`, inset focus. |

README "UI conventions" gets one entry per row: name, when to use, implementation (AC17 a).

## Inventory: interactive elements moving to Headless UI (R16)

| # | Location | Today | Becomes |
|---|---|---|---|
| H1 | `components/shell/TopBar.tsx:27-33` | inline email, role chip, `<button>Sign out` | `AccountMenu`: `MenuButton` (email + role) and `MenuItem` "Sign out" (same `handleSignOut`) |
| H2 | `components/FilterBar.tsx:39-53`, `:54-68`, `:69-83` | 3 native `<select>` with `aria-label="Filter by …"` | `Field` + `Label` + Headless `Select`. **The existing `aria-label`s are kept verbatim** (tests query them). |
| H3 | `components/FilterBar.tsx:85-91` | "Clear filters" `<button>` | `Button variant="secondary"` |
| H4 | `app/page.tsx:87-101` | "Group by" label + `<select aria-label="Group by">` | `Field`/`Label`/`Select` (aria-label kept) |
| H5 | `app/devices/DevicesView.tsx:113` | "Register device" `<button>` | `Button primary` in the PageHeading actions |
| H6 | `app/devices/DevicesView.tsx:117-127`, `:128-138`, `:139-150`, `:151-159` | Zone / Type / Status / Group by native selects | `Field`/`Label`/`Select`; option values and `setParams` calls unchanged |
| H7 | `app/devices/DevicesView.tsx:160-170` | "Include decommissioned" native checkbox | `Field` + Headless `Checkbox` + `Label`; `onChange(checked)` maps to the same `setParams` |
| H8 | `app/devices/DevicesView.tsx:203` | "Load more" | `Button secondary` |
| H9 | `app/devices/DevicesView.tsx:249-258` | row `<button aria-pressed>` | `SelectableList` row (Headless `Button`, `aria-pressed` kept) |
| H10 | `app/devices/DeviceDetail.tsx:129`, `:132` | Edit / Decommission-Reactivate | `Button secondary` (disabled state kept). **No confirmation added.** It executes immediately today, and a confirm step would be a new feature. |
| H11 | `app/devices/DeviceDetail.tsx:159-164` | "Show/Hide change history" toggle button + conditional table | Headless `Disclosure`; `DisclosureButton as={Button}` secondary keeps the label text "Show/Hide change history" and gains `aria-expanded` |
| H12 | `app/devices/DeviceForm.tsx:109-163` | 4 labelled `<input>`s (+ datalists), `<small>` notes and errors | `Field`/`Label`/`Input`/`Description` (immutable note)/`ErrorText`. `list=` datalist attributes pass through. |
| H13 | `app/devices/DeviceForm.tsx:165-194` | metadata `<fieldset>`, key/value inputs (placeholder only), Remove / Add entry | Headless `Fieldset`/`Legend`; each row gets visible "Key" / "Value" `Label`s (the placeholder text becomes the label; no new data); Remove/Add use `Button secondary` |
| H14 | `app/devices/DeviceForm.tsx:196-203` | Submit / Cancel | `Button primary` / `Button secondary` |
| H15 | `app/admin/users/page.tsx:89-99` | role `<select aria-label="Role for …">` in table cell | Headless `Select` via `SelectInput` (aria-label kept, no visible label inside a table cell) |
| H16 | `app/admin/users/page.tsx:105` | Deactivate / Reactivate | `Button secondary` |
| H17 | `app/admin/users/page.tsx:179-203` | create-user form, 3 placeholder-only inputs, submit | `Field`/`Label`/`Input` (labels = the placeholder texts "Email", "Display name (optional)", "Temporary password (min 8 chars)"; placeholders kept); `Button primary` |
| H18 | `app/signin/page.tsx:42-69` | email/password labelled inputs, submit | `Field`/`Label`/`Input`, `Button primary`; `required`, `autoComplete`, `name` unchanged |

Not moved: `next/link` navigation (nav rows, cards, back links) stays as links. They are not widgets. The focus ring
and hover states come from recipes and base rule 4.

## Inventory: file-by-file migration order

Every `*.module.css` (11) and every inline `style={{…}}` in the current tree:

| Phase | Files | What happens |
|---|---|---|
| 0: characterization tests | new tests (see R18) | Written and **green on the current CSS Modules code** before anything changes |
| 1: toolchain + theme | `package.json` (+`tailwindcss`, `@tailwindcss/postcss`, `postcss`, `@headlessui/react`), new `postcss.config.mjs`, `styles/tokens.css` (→ `@theme`), `styles/globals.css` (→ import + base layer), `app/layout.tsx` (import only `globals.css`) | A temporary `:root` block of the **old** variable names, aliased to the new theme variables, lets unmigrated modules keep rendering. The new static tests land here with a **shrinking allowlist** of not-yet-migrated files. The old `literals.test.ts` / `interaction.test.ts` are replaced now. |
| 2: primitives | new `components/ui/{Button,Card,PageHeading,Table,Field,SelectableList}.tsx`, `lib/cx.ts`, `vitest.setup.ts` (jsdom shims, see risks) | Primitive unit tests |
| 3: shell | `components/shell/AppShell.module.css`, `SideNav.module.css`, `TopBar.module.css` (delete) + their `.tsx`; new `shell/AccountMenu.tsx` | H1 |
| 4: badge | `components/StatusBadge.module.css` (delete) | static tone map |
| 5: components | `components/DeviceCard.module.css` → `Card interactive`; `DeviceGrid.module.css`; `FilterBar.module.css` (H2, H3); `MetricTable.module.css` → `Table`; `EventLog.module.css` | delete each module |
| 6: pages | `app/page.tsx` (inline `:87`; H4; PageHeading), `app/devices/DevicesView.tsx` (inline `:110, :111, :116, :175, :188, :208`; H5–H9; PageHeading; restructure `<main>` to PageHeading + a two-column `flex gap-8` row so the shell's `space-y` rhythm applies) + `DevicesView.module.css` (delete), `app/devices/DeviceDetail.tsx` (inline `:97, :118, :128, :137, :142-144, :159, :164, :167-170`; H10, H11; tables → `Table`), `app/devices/DeviceForm.tsx` (inline `:106, :107, :115, :118, :120, :128, :130, :139, :146, :155, :162, :165, :168, :193, :196`; H12–H14), `app/devices/[deviceId]/DeviceDetailView.tsx` + `.module.css` (delete; `max-w-3xl`; PageHeading with the back link as its action), `app/admin/users/page.tsx` (inline `:67, :72, :77-80, :117, :121-124, :181, :184, :195`; H15–H17; PageHeading replaces the `:66-69` header; tables → `Table`), `app/signin/page.tsx` (inline `:34-39, :44, :53, :63, :66, :71`; H18; outside the shell, but conventions 7, 8 and 9 apply) | |
| 7: close-out | `tokens.css` (delete the legacy alias block), `styles/README.md` (token tables rewritten + "UI conventions"), static-test allowlist **must be empty**, `next build` | |

Preflight zeroes all margins. Wherever content relied on default `<p>`, `<h2>` or `<ul>` margins, the containing element
gets a `space-y-*` from the allowed steps. The DeviceDetail metadata `<ul>` loses its bullets, which is acceptable
(same content). This is the main source of visual deltas and is checked in the AC17(d) review.

## Static tests (rewritten to enforce the same rules on class usage)

A shared helper extracts **class tokens** from every non-test `.ts/.tsx` under `app/`, `components/` and `lib/`. It takes
string literals and template-literal static parts, splits them on whitespace, and strips variant prefixes (`hover:`,
`data-hover:`, `motion-safe:` …) for value checks while keeping them for variant checks. The allowed names are parsed
from the `@theme` block in `tokens.css`, so the tests and the theme cannot drift.

| File | Rule | Requirement |
|---|---|---|
| `styles/literals.test.ts` (rewrite) | No `*.module.css` anywhere. The only CSS files are `styles/globals.css` and `styles/tokens.css`. No `style={{` / `style=` in TSX. Hex, `rgb()`, `hsl()` and `oklch()` only inside `tokens.css`. | R1, R7, R15 |
| same | **No arbitrary values or properties**: no class token containing `[` or `](`, and no `-(--` var shorthand. This bans `p-[13px]`, `bg-[#fff]`, `shadow-[…]`, `duration-[…]`, `[mask-type:…]`, `aria-[…]:`, `w-(--x)`. No `/` in class tokens (bans opacity modifiers like `bg-accent/10` and `text-sm/6` line-height shorthands). | R7, R15 |
| same | **Color utilities** (`bg-`, `text-`, `border-`, `outline-`, `divide-`, `fill-`, `stroke-`, `placeholder-`, `caret-`, `decoration-`, `accent-`, `ring-`) must use a theme color name or `transparent`/`current`/`inherit`. Raw palette names (`gray-800`, `indigo-500`, `white`, `black`) fail, even though they would not compile after the reset. | R6, R7, R15 |
| same | **Scales**: numeric spacing/sizing steps (`p*`, `m*`, `gap*`, `space-*`, `inset*`, `top/left/right/bottom`, `w/h/size/min-*/max-*` numeric, `translate-*`) ∈ {0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12} or named (`sidebar`, `topbar`, `content`, `icon`) or keywords (`full`, `screen`, `auto`, `px`, `fit`, `min`, `max`, container sizes for `min-w`/`max-w`). `text-<size>`, `font-<weight>`, `leading-*`, `rounded-*` ∈ theme ∪ {`full`, `none`}. | R7, R15 |
| same | **Depth (R10)**: `shadow-*` ∈ {`1`, `2`, `none`}; `z-*` ∈ {10, 20, 30}; `ring-*`, `inset-shadow-*`, `drop-shadow-*` banned. SideNav root, TopBar root and the Card recipe contain `shadow-1`. | R10 |
| same | **Motion (R11)**: no `duration-*`, `ease-*`, `delay-*`, `animate-*`, `transition-all`. Every token matching `translate-`, `scale-`, `rotate-` or `skew-` carries the `motion-safe:` variant. | R11 |
| same | **Theme**: no `dark:` variant. | R6 |
| same (kept) | Unicode status-glyph ban (unchanged ranges); lucide imported only by `StatusBadge.tsx`; one badge implementation (no `function \w*Badge` outside StatusBadge). Status color utilities (`*-success`, `*-warning`, `*-danger`, `*-neutral`, `*-decommissioned` and their `-bg`) appear only in `StatusBadge.tsx`, plus an allowlist: `ui/Card.tsx` warning tone (stale card), `ui/Field.tsx` `ErrorText` (danger), and `DeviceDetail.tsx` rejected-readings notice (warning). | R12, R13 |
| same | **R14**: no padding utility (`p-`, `px-`, `py-`, `pt-` …) on any `<main` in `app/**` except `app/signin/**`. `AppShell` content uses `p-content`, TopBar uses `px-content`, and `--spacing-content` is one of the allowed spacing values (2rem = step 8). | R14 |
| `styles/interaction.test.ts` (rewrite) | Imports the recipe constants from `ui/Button`, `ui/Card`, `ui/Field`, `ui/SelectableList`, `shell/SideNav` and `shell/AccountMenu`. Each interactive recipe has a hover class (`hover:` or `data-hover:`/`data-focus:` for menu items), a pressed class (`active:` / `data-active:`), and a `transition*` class with no duration class. The base layer has the transparent resting outline and the `:focus-visible` `outline-color: var(--color-accent)` rule. `DevicesView` has no `<li … onClick>`. | R11 |
| `styles/tokens.test.ts` (rewrite) | Parses `@theme`. Contrast checks as today, with renamed colors. Namespace resets present (`--color-*: initial` …). `--shadow-1`/`--shadow-2` present, with README uses. `--default-transition-duration` and `--default-transition-timing-function` present. README ↔ theme parity. Required namespaces present. | R1, R2, R6, R10, R11 |
| `styles/conventions.test.ts` (new) | README "UI conventions" has entries 1–10. Each implementation file exists. No raw `<button`, `<table`, `<select`, `<input`, `<textarea` in `app/**` / `components/**` outside `ui/*`, `shell/AccountMenu.tsx` and `ui/SelectableList.tsx`. Headless `Button`, `Select`, `Input` and `Checkbox` are imported only in `ui/*`; `Menu` only in `AccountMenu`; `Disclosure` only in `DeviceDetail.tsx`, with `as={Button}`. Focus utilities (`focus:`, `focus-visible:`, `focus-within:`, `outline-offset`, `-outline-offset`) appear only in `ui/*`, `shell/*` and `globals.css`. `<main[^>]*>\s*<PageHeading` holds in the primary render of `app/page.tsx`, `DevicesView.tsx`, `DeviceDetailView.tsx` and `admin/users/page.tsx`. | R16, R17 b/c |

The static tests are regex/token heuristics. The reviewer still greps (as for R7) and does the AC17(d) manual review.

## R18: behavior-preservation strategy

1. **Characterization first (phase 0, before any styling change).** Add behavior tests on the current code and commit them green:
   - `app/devices/DevicesView.test.tsx`: changing Zone/Type/Status/Group by calls `router.replace` with the same query strings; the admin sees and toggles "Include decommissioned" (→ `includeDecommissioned=true`), a viewer doesn't see it; clicking a row sets `aria-pressed` and shows the detail panel; "Register device" only for admin.
   - `app/admin/users/page.test.tsx`: role select calls `setRole`, Deactivate calls `setActive`, create form submits `createUser` with trimmed name, errors render; non-admin sees "Not available.".
   - `app/devices/DeviceForm.test.tsx`: a `ConvexError` with `fieldErrors` shows each message next to its field; the edit mode external ID is disabled.
   - `app/devices/DeviceDetail.test.tsx`: Decommission/Reactivate call their mutations with no confirm; the history toggle shows and hides the table; action errors render.
   - `app/signin/page.test.tsx`: bad credentials show "Invalid email or password."; success replaces to `/`.

   These query **by role, label text, placeholder and visible text only**, never by class names or DOM shape, so they survive the migration unmodified.
2. **Existing suites pass unmodified**, except for these sanctioned, equivalent rewrites:
   - `AppShell.test.tsx` sign-out opens the account menu (click `MenuButton`) before clicking "Sign out". Same assertions: `signOut` then `replace("/signin")`.
   - `StatusBadge.test.tsx` only if it asserted module class names (it asserts `lucide` class, `aria-hidden`, attributes and label, so it is expected to be unchanged).

   `FilterBar.test.tsx` keeps `selectOptions` + `getByLabelText(/filter by zone/i)` because Headless `Select` is native.
3. **Keyboard/ARIA tests for R16** (new, in the same suites): the account menu opens with Enter, items are `role="menuitem"`, Escape closes and returns focus to the button. The history `DisclosureButton` toggles `aria-expanded`. The checkbox toggles with Space. Field labels are associated (`getByLabelText("Email")` resolves to the input).
4. **Matrix**: role-based nav (AppShell + nav tests), sign-out (AppShell), route changes/active item (AppShell), device filtering (FilterBar + DevicesView), status display (StatusBadge, DeviceCard, DeviceDetailView), form validation (DeviceForm, admin, signin), error display (same). Each row maps to a named test, recorded in `tasks.md`.
5. **Build + smoke**: `next build` passes, then run the manual workflow smoke test as each role: sign in → navigate Overview/Devices/Users → filter and group → open a device detail → (admin) register/edit/decommission → open the account menu → sign out.
6. **Visual baseline**: capture before-screenshots of `/`, `/devices` (with a selection), `/devices/[id]`, `/admin/users` and `/signin` at 1440 and 1024 before phase 1. These are used for the AC17(d) review and the R10 border-less check.

## Requirement coverage (R15–R18, plus R1–R14 re-verification under the new stack)

| Req | Addressed by |
|---|---|
| R15 | `@theme` in `tokens.css` as the single source with namespace resets; all 11 modules and all inline styles removed; minimal base layer documented; literals test (no modules or inline styles, no arbitrary values, theme-only names and scales) |
| R16 | Headless `Menu` (account), `Select`/`Input`/`Checkbox`/`Field`/`Label`/`Description`/`Fieldset` (every form control), `Button` (every button), `Disclosure` (history toggle); inventory H1–H18; keyboard/ARIA tests; manual keyboard + VoiceOver audit |
| R17 | Conventions 1–10 implemented once each in `components/ui`, `components/shell`, StatusBadge and the base layer; README "UI conventions"; `conventions.test.ts`; manual AC17(d) review against before-screenshots |
| R18 | Phase-0 characterization tests; existing suites unmodified except the two sanctioned rewrites; R16 keyboard tests; `next build` + role smoke test |
| R1, R7 | tokens only in `@theme`, enforced by literals test and build-time namespace reset |
| R2, R12, R13 | StatusBadge API unchanged, lucide kept, glyph/badge/status-color scans kept |
| R6 | dark palette only, `color-scheme: dark`, no `dark:` variant |
| R8 | `min-w-5xl` shell, `w-sidebar`; manual 1024/1440 check |
| R10 | `shadow-1`/`shadow-2` from theme, z-scale; depth test |
| R11 | recipes with hover/active + `transition*`; theme default duration/easing; movement behind `motion-safe:`; focus-ring base rule |
| R14 | `p-content` owned by AppShell, no padding on `<main>`; test |
| R3, R4, R5, R9 | Shell logic (`AppShell` query/pathname, `nav.ts`, sign-out handler) unchanged; only markup and classes change; existing AppShell/nav tests |

## Risks & unknowns

- **Named spacing keys** (`w-sidebar`, `p-content`, `size-icon`) rely on Tailwind resolving `--spacing-<name>`. The theme docs list the `--spacing-*` namespace, but the padding docs only show the multiplier. Mitigation: phase 1 includes a build smoke test that these classes appear in the output CSS. Fallback: numeric steps (`w-58`, `h-14`, `p-8`, `size-3.5`), with the inset declared once in AppShell and imported by TopBar as a shared constant. R14 still holds either way.
- **jsdom and Headless UI 2.x.** Headless UI's anchoring (Floating UI) and transitions expect `ResizeObserver`, and in some versions `Element.prototype.getAnimations`. jsdom lacks both. Mitigation: shims in `vitest.setup.ts` (no-op `ResizeObserver`, `getAnimations = () => []`). The builder confirms by running the menu tests first in phase 2.
- **Preflight side effects.** Margins, list bullets, heading sizes and button/input chrome are reset. Unmigrated screens look broken between phases 1 and 6. Mitigation: do the migration on one branch and ship only after phase 7. The alias block keeps colors legible in the meantime.
- **Silent no-op classes.** After the namespace reset, a typo or raw palette class generates no CSS and no build error. Mitigation: the literals test validates every token against the parsed theme.
- **Browser floor rises.** Tailwind v4 requires Chrome 111, Safari 16.4, Firefox 128. This is fine for a desktop ops dashboard. Record it in the README.
- **Turbopack + PostCSS.** Next 16 builds with Turbopack by default. The official Tailwind/Next guide uses exactly this PostCSS setup. `frontend/node_modules` is still not installed here, so the builder re-reads the local `node_modules/next/dist/docs` CSS guide per `AGENTS.md` after `npm install`.
- **Visual deltas the reviewer should expect:** text-sm 0.85 → 0.875rem, control radius 8 → 6px, page max-widths rounded to container sizes, metadata list bullets gone, and the active nav indicator changes from a left accent bar to a raised fill + weight (still not color-only). All are convention-driven, not behavior changes.
- **Irreversible decisions:** none. The migration runs on a branch. Tokens keep their values, only renamed. Every step can be reverted with git. The one lasting cost is the rename of token names, which touches every file anyway.

## Sources (R15–R18)

- Tailwind CSS latest version (4.3.3, MIT): https://registry.npmjs.org/tailwindcss/latest
- Tailwind + Next.js install guide (v4.3; `@tailwindcss/postcss`, `postcss.config.mjs`, `@import "tailwindcss"`): https://tailwindcss.com/docs/installation/framework-guides/nextjs
- Theme variables (`@theme`, namespaces, `--color-*: initial` resets, `inline`/`static`, emitted CSS vars): https://tailwindcss.com/docs/theme
- Padding / spacing multiplier: https://tailwindcss.com/docs/padding
- Transition defaults (`--default-transition-duration` 150ms, timing function) and `motion-safe`/`motion-reduce`: https://tailwindcss.com/docs/transition-property
- Arbitrary values, var shorthand, `@layer base`, `@utility`: https://tailwindcss.com/docs/adding-custom-styles
- Class detection (no dynamic class names, `@source`): https://tailwindcss.com/docs/detecting-classes-in-source-files
- Dark mode variant behavior: https://tailwindcss.com/docs/dark-mode
- Preflight resets: https://tailwindcss.com/docs/preflight
- Box shadow theme, ring colors: https://tailwindcss.com/docs/box-shadow
- Browser support; CSS Modules not recommended alongside Tailwind: https://tailwindcss.com/docs/compatibility
- Headless UI latest version (2.2.10; peers react ^18 || ^19): https://registry.npmjs.org/@headlessui/react/latest
- Headless UI Select (native wrapper, data attributes, Field/Label/Description): https://headlessui.com/react/select
- Headless UI Menu (keyboard table, anchor, transition, data attributes): https://headlessui.com/react/menu
- Headless UI Button (data-hover/active/focus/disabled): https://headlessui.com/react/button
- lucide-react (kept; see R10–R14 sources): https://registry.npmjs.org/lucide-react/latest
