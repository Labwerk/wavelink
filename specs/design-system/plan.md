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
