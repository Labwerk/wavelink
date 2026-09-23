# Tasks: Design system & app shell

> Written by builder from `spec.md` + `plan.md`. Tests run from `frontend/` with `npx vitest run`
> (baseline before changes: 8 files / 26 tests passing). Typecheck: `npx tsc --noEmit -p .` in `frontend/`
> (baseline: only pre-existing "Cannot find module '*.module.css'" errors, because `next-env.d.ts` is not generated
> outside `next dev/build`; these are not caused by this feature).

## Tasks

- [x] **T1 - Tokens, base styles, token doc** (R1, R6)
  - Files: `frontend/styles/tokens.css`, `frontend/styles/globals.css`, `frontend/styles/README.md`
  - Acceptance: `tokens.css` defines every token from plan.md (colors, spacing, type, radius, layout) on `:root`;
    `globals.css` sets `color-scheme: dark`, body, link, focus, form-control, heading defaults from tokens only;
    README documents every token.

- [x] **T2 - Token tests: contrast + doc parity** (R1, R2, R6)
  - Files: `frontend/styles/tokens.test.ts`
  - Acceptance: test parses `tokens.css`; WCAG contrast >= 4.5 for text/muted/accent/status colors on bg, surface,
    surface-raised; on-accent on accent; status colors over their `-bg` tints; every token in CSS is in README and vice versa.

- [x] **T3 - Nav config** (R4, R5)
  - Files: `frontend/lib/nav.ts`, `frontend/lib/nav.test.ts`
  - Acceptance: `visibleNavItems(capabilitiesFor(role))` matches the plan table for all four roles; `isActive` correct for
    `/`, `/devices`, `/devices/abc`, `/admin/users`, `/signin`.

- [x] **T4 - StatusBadge** (R2)
  - Files: `frontend/components/StatusBadge.tsx`, `StatusBadge.module.css`, `StatusBadge.test.tsx`
  - Acceptance: every kind renders a glyph (aria-hidden) plus non-empty text; glyphs unique per kind; `label` override works.

- [x] **T5 - Shell components** (R3, R4, R5, R8, R9)
  - Files: `frontend/components/shell/{AppShell,SideNav,TopBar}.tsx`, matching `.module.css`
  - Acceptance: SideNav renders `<nav aria-label="Primary">` with only permitted items, `aria-current="page"` on the active one;
    TopBar shows section title, email, role, Sign out (handler identical to old `SiteHeader`); AppShell bare on `/signin` and when
    `me == null`, frame-only while loading; `min-width: 1024px`.

- [x] **T6 - Shell tests** (R3, R4, R5, R9)
  - Files: `frontend/components/shell/AppShell.test.tsx`
  - Acceptance: viewer has no Users link, admin does; bare on `/signin` and null me; loading frame has no links/identity; identity
    shown; pathname change moves `aria-current`; Sign out calls `signOut` then `router.replace("/signin")`; links have expected hrefs.

- [x] **T7 - Wire shell into layout, remove SiteHeader** (R3, R5, R6, R9)
  - Files: `frontend/app/layout.tsx`, delete `frontend/app/SiteHeader.tsx`, update stale comment in `frontend/app/page.tsx`
  - Acceptance: layout imports both stylesheets and renders `<AppShell>` inside `Providers`; no remaining `SiteHeader` import.

- [x] **T8 - Mechanical token migration of existing files** (R6, R7)
  - Files: `frontend/components/{DeviceCard,DeviceGrid,EventLog,FilterBar,MetricTable}.module.css`,
    `frontend/components/DeviceCard.tsx` (none needed if no literals), `frontend/app/page.tsx`, `app/signin/page.tsx`,
    `app/admin/users/page.tsx`, `app/devices/{DevicesView,DeviceDetail,DeviceForm}.tsx`, `app/devices/[deviceId]/DeviceDetailView.module.css`
  - Acceptance: colors / `fontFamily` / exact-match font sizes replaced by `var(--token)`; no markup or layout change; existing
    test suites pass unmodified.

- [x] **T9 - Literal scan test** (R7)
  - Files: `frontend/styles/literals.test.ts` (kept separate from `tokens.test.ts` to keep each file's purpose single; plan named it under tokens.test.ts, see Deviations)
  - Acceptance: scan of `app/`, `components/`, `lib/` (excluding tests and tokens) finds no hex/rgb/hsl/named color and no font-size
    equal to a token value.

- [x] **T10 - Full verification** (R1-R9)
  - Acceptance: full `npx vitest run` in `frontend/` green; root backend `npx vitest run` unaffected; `tsc` shows no new errors;
    `next build` attempted.

## Requirement coverage

| Req | Tasks |
|---|---|
| R1 | T1, T2, T8 |
| R2 | T2, T4 |
| R3 | T5, T6, T7 |
| R4 | T3, T5, T6 |
| R5 | T3, T5, T6, T7 |
| R6 | T1, T2, T7, T8 |
| R7 | T8, T9 |
| R8 | T5 (CSS `min-width`; not testable in jsdom, manual check) |
| R9 | T5, T6, T7, T8, T10 (existing suites unchanged) |

## Deviations from plan

- **Token `--color-decommissioned`**: plan said `#8792B0` (~5.6:1 hand-calculated). The contrast test measured 4.37:1 for it on the neutral tint over surface, below the 4.5 gate. Per the plan's instruction (adjust the hex, not the threshold) it is now `#909BB9`, same hue and slightly lighter. Reflected in `tokens.css` and `styles/README.md`. (R2, R6)
- **Literal scan lives in its own file**: the plan listed it under `styles/tokens.test.ts`. It is `styles/literals.test.ts` instead so each test file has one purpose. Same coverage. (R7)
- **Stale card tint layering**: plan said the stale card keeps "amber border/tint". `--color-warning-bg` is translucent, so `DeviceCard.module.css` layers it over `--color-surface` (`linear-gradient(tint, tint), var(--color-surface)`) to keep the card opaque like non-stale cards. Visual only. (R6, R7)
- **Extra helper `activeNavItem`** in `lib/nav.ts` (not in plan) gives the top bar its section title from the same `NAV_ITEMS`/`isActive` logic. (R3, R5)

## Verification log

- `frontend`: `npx vitest run` -> 13 files, 101 tests pass (baseline was 8 files / 26 tests; existing suites unmodified).
- `frontend`: `NEXT_PUBLIC_CONVEX_URL=... npx next build` -> compiled, TypeScript passed, all routes generated.
- `frontend`: `npx tsc --noEmit -p .` -> only the pre-existing `*.module.css` "cannot find module" errors (no `next-env.d.ts` outside `next dev/build`); the build's own type check passes.
- Repo root `npx vitest run`: 244 tests pass; `backend/liveView.test.ts` and `backend/telemetry.test.ts` fail to load because `backend/testUtils` is missing. Pre-existing and unrelated (no backend file touched).
- Environment note: `vitest` initially failed on this machine (missing rolldown native binding, npm optional-deps bug). Fixed locally with `npm install --no-save --no-package-lock @rolldown/binding-win32-x64-msvc@1.2.9`; no repo file changed.
- Manual checks from plan.md (four-role sign-in, 1024px/1440px, grayscale, no-reload navigation) are not run by the builder; left for review.

## Tasks (amendment 2026-09-23: R10-R14 polish pass)

> Builder addendum for spec/plan amendment 2026-09-23. R1-R9 above stay as shipped (PASS). These tasks
> only add work, per `plan.md`'s "Amendment 2026-09-23" section.

- [x] **T11 - Install lucide-react** (R12)
  - Files: `frontend/package.json`, `frontend/package-lock.json`
  - Acceptance: `lucide-react@^1.47.0` in `dependencies`; `npm install` succeeds; lockfile updated.

- [x] **T12 - Token additions: elevation, motion, icon, content-inset, interaction colors** (R10, R11, R14)
  - Files: `frontend/styles/tokens.css`, `frontend/styles/README.md`
  - Acceptance: `--elevation-0/1/2`, `--layer-topbar`/`--layer-sidebar`, `--motion-duration`/`--motion-ease`/`--motion-lift`,
    `--icon-size-sm`/`--icon-stroke`, `--content-inset`, `--color-surface-hover`/`--color-accent-hover`/`--color-accent-bg`
    all defined on `:root`; a `@media (prefers-reduced-motion: reduce)` `:root` block sets `--motion-lift: 0px`; README
    documents every new token including an Elevation table with a non-empty "Use" column per level.

- [x] **T13 - Token tests: elevation/motion/contrast extensions** (R10, R11)
  - Files: `frontend/styles/tokens.test.ts`
  - Acceptance: at least 2 `--elevation-*` tokens exist; README Elevation table has a Use cell per level; motion tokens
    exist in the default `:root` and the reduced-motion block sets `--motion-lift` to `0px`; new interaction colors pass
    the existing contrast gate (text/muted on `--color-surface-hover`; accent-hover on bg/surface/raised; accent on
    `--color-accent-bg` over surface/bg).

- [x] **T14 - Global interaction states + transitions** (R11)
  - Files: `frontend/styles/globals.css`
  - Acceptance: `:where(a, button, input, select, textarea)` gets a `transition` using `var(--motion-duration)` and
    `var(--motion-ease)` over an explicit property list (no `transition: all`); hover/active rules for link and button;
    resting `outline: 2px solid transparent` plus `:focus-visible` outline-color rule; `h1` margin-block reset.

- [x] **T15 - StatusBadge: lucide icons + active/inactive kinds** (R12, R13)
  - Files: `frontend/components/StatusBadge.tsx`, `StatusBadge.module.css`, `StatusBadge.test.tsx`
  - Acceptance: `STATUS_GLYPH` Unicode map replaced by a `STATUS_ICON` lucide-component map covering all 9 kinds
    (`online, offline, stale, unknown, decommissioned, warning, error, active, inactive`); icon rendered `aria-hidden`,
    sized/stroked from `--icon-size-sm`/`--icon-stroke`; visible text label is the accessible name; rewritten test
    asserts one `svg[aria-hidden="true"]` per kind, unique icon per kind, label text, and shared icon attributes.

- [x] **T16 - Elevation applied to shell + card** (R10)
  - Files: `frontend/components/shell/SideNav.module.css`, `frontend/components/shell/TopBar.module.css`,
    `frontend/components/DeviceCard.module.css`
  - Acceptance: `.sidebar` and `.bar` declare `box-shadow: var(--elevation-1)` and their respective `z-index: var(--layer-*)`;
    `.card` declares `var(--elevation-1)` at rest and `var(--elevation-2)` on hover; no one-off shadow/z-index literal.

- [x] **T17 - Interaction states: nav, brand, card, device list row** (R11)
  - Files: `frontend/components/shell/SideNav.module.css`, `frontend/components/DeviceCard.module.css`,
    `frontend/app/devices/DevicesView.tsx`, new `frontend/app/devices/DevicesView.module.css`
  - Acceptance: `.item`/`.brand` have `:hover`/`:active`/focus-visible rules; `DeviceCard .card` hover uses
    `--elevation-2` + `translateY(var(--motion-lift))`, active uses `--elevation-1` + `translateY(0)`; the device list
    row becomes a real `<button type="button" aria-pressed>` (keyboard-focusable) styled from the new module, replacing
    `<li onClick>`; click behavior unchanged (R9).

- [x] **T18 - New interaction + literal-scan tests for R10/R11/R12/R14** (R10, R11, R12, R14)
  - Files: `frontend/styles/interaction.test.ts` (new), `frontend/styles/literals.test.ts` (extend)
  - Acceptance: static table of (file, selector) asserting `:hover`/`:active` rules exist for the elements in the plan's
    interaction table, plus a check that the global transition rule references the duration/ease tokens and that
    `DevicesView.tsx` has no `<li ... onClick`; literal scan additionally bans raw `box-shadow`/`z-index` values outside
    `var(--elevation-*)`/`var(--layer-*)`, raw transition/animation time literals and `transition: all`, non-token
    `transform` values, and status-symbol Unicode code points (with an allow-list for `← → ∅ ⋯ — · …`).

- [x] **T19 - Migrate status indicators S1-S12 to StatusBadge** (R12, R13)
  - Files: `frontend/components/DeviceCard.tsx`, `DeviceCard.module.css`,
    `frontend/app/devices/[deviceId]/DeviceDetailView.tsx`, `DeviceDetailView.module.css`,
    `frontend/app/devices/DeviceDetail.tsx`, `frontend/app/devices/DevicesView.tsx`,
    `frontend/components/DeviceGrid.tsx`, `frontend/app/admin/users/page.tsx`,
    `frontend/components/EventLog.tsx`, `EventLog.module.css`
  - Acceptance: every ad hoc status indicator listed in plan.md's S1-S12 inventory now renders through `StatusBadge`;
    the local `Badge` in `DeviceDetail.tsx` and the `.staleBadge`/`.decommissioned`/`.gap` color CSS are removed;
    `DeviceGrid`/`DevicesView` group headings render a badge only when `groupBy === "status"`; existing suites
    (`DeviceCard`, `DeviceGrid`, `DeviceDetailView`, `EventLog`) keep passing with new `data-kind` assertions added.

- [x] **T20 - Literal-scan tests for R13 (single badge, status colors, lucide import)** (R13)
  - Files: `frontend/styles/literals.test.ts` (extend)
  - Acceptance: exactly one Badge-like implementation (`components/StatusBadge.tsx`); no other CSS Module class matching
    `/badge|pill/i`; status-color tokens (`--color-success/warning/danger/neutral/decommissioned` + `-bg`) appear only
    in `StatusBadge.module.css` plus an explicit allow-list (`DeviceCard.module.css` stale tint, excluded error/notice
    text colors); `lucide-react` imported only by `components/StatusBadge.tsx`.

- [x] **T21 - Shell-owned content inset; remove per-page padding** (R14)
  - Files: `frontend/components/shell/AppShell.module.css`, `frontend/components/shell/TopBar.module.css`,
    `frontend/styles/tokens.css`, `frontend/app/page.tsx`, `frontend/app/devices/page.tsx`,
    `frontend/app/devices/DevicesView.tsx`, `frontend/app/devices/[deviceId]/DeviceDetailView.module.css`,
    `frontend/app/admin/users/page.tsx`
  - Acceptance: `AppShell .content` declares `padding: var(--content-inset)`; `TopBar .bar` horizontal padding uses
    `var(--content-inset)`; inventory items P1-P8 from plan.md have their inline/module `padding` removed; no
    authenticated page under `app/` (excluding `app/signin`) sets outer padding via inline style or a module class
    applied to its page root; `/signin` is unaffected.

- [x] **T22 - Literal-scan test for R14 (page padding ban)** (R14)
  - Files: `frontend/styles/literals.test.ts` (extend)
  - Acceptance: scan of `app/**` excluding `app/signin/**` finds no `<main`/Suspense-fallback inline `style` containing
    `padding`, and no module rule applied to a page-root `<main>`/`<div>` wrapper declaring `padding`; confirms
    `--content-inset` resolves to a `--space-*` token.

- [x] **T23 - Full verification (amendment)** (R10-R14, R9 regression)
  - Acceptance: `npx vitest run` in `frontend/` green (all suites, old and new); `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npx next build` succeeds; existing R1-R9 suites (`nav`, `AppShell`, `FilterBar`, `MetricTable`) pass unmodified.

## Requirement coverage (amendment)

| Req | Tasks |
|---|---|
| R10 | T12, T13, T16, T18 |
| R11 | T12, T13, T14, T17, T18 |
| R12 | T11, T15, T18 |
| R13 | T15, T19, T20 |
| R14 | T12, T21, T22 |

## Review round 1 fixes

- **R7 (blocking, review.md issue 1)**: swapped every exact-token spacing literal (`3rem`..`0.25rem` in padding / margin / gap, including the `0.5rem` inside shorthands like `0.1rem 0.5rem`) for `var(--space-N)` and every `font-weight: 600` / `fontWeight: 600` for `var(--weight-semibold)`, in the 13 existing app/component files. Off-scale values (`0.1rem`, `0.15rem`, `0.35rem`, `0.6rem`, `0.8rem`, `0.9rem`) are left as legacy. No rendered values changed.
- `styles/literals.test.ts` now also flags token-equal spacing (padding / margin / gap) and font weights, so R7 for spacing and weight is enforced rather than left to review. Its header comment was updated; `styles/README.md` still describes the legacy off-scale exception.
- Re-run: `frontend` `npx vitest run` -> 13 files, 101 tests pass; `next build` succeeds.
- This corrects the earlier T8 scope: the plan's "swap font-size and spacing when the value exactly equals a token" is now fully done, so there is no spacing deviation to record.

## Deviations from plan (amendment 2026-09-23: R10-R14)

- **T18's `interaction.test.ts` is a new file, as planned**, but the R10/R11 elevation, z-index, transition/animation-literal and status-symbol-glyph scans described in the plan's "Test strategy" table were added as new `describe` blocks inside `styles/literals.test.ts` instead of a second new file, to keep every static-scan check (R7's existing scans plus the new R10-R14 ones) in one file with one shared `walk()`/`stripComments()` helper set, matching the R1-R9 precedent of "each test file has one purpose" (tokens.test.ts = token values/docs, literals.test.ts = static source scans, interaction.test.ts = per-selector hover/active/focus presence). Coverage is unchanged from the plan; only the file split differs.
- **`lib/useNow.ts` bug fix (incidental, not in plan or spec)**: `getSnapshot()` returned a fresh, uncached `Date.now()` on every call, violating `useSyncExternalStore`'s requirement that `getSnapshot` return a stable value between store updates. This reliably caused a "Maximum update depth exceeded" React error in `DeviceDetailView.test.tsx` in this build environment (confirmed reproducible against the unmodified R1-R9 `HEAD` copy of the file too, so it predates this amendment and is not caused by R10-R14 work). Fixed by caching the value and only refreshing it inside `tick()` (once per second), lazily initialized on first read so the very first render still reflects the real current time. Behavior is unchanged (still ticks every 1s); `lib/useNow.test.tsx` passes unmodified. Recorded here because the task explicitly required `npx vitest run` to be all-green and this was blocking it.
- **Environment setup required beyond `npm install`**: this machine's Node was v22.8.0, one minor below what `jsdom`/`vitest`/`rolldown`'s optional native bindings require (`^22.12.0`), which produced `ERR_REQUIRE_ESM` failures unrelated to any code change; fixed by using Node v22.12.0 (via `nvm`) for all `frontend` test/build commands. Also, `backend/_generated/` (gitignored, required by every Convex-backed component/test) did not exist in this checkout; it was generated locally with `npx convex dev --once`, which auto-provisioned a local anonymous Convex deployment (no cloud account needed) purely to run codegen — no schema/function code was changed and no data was written. Neither is a code change; noted here so a re-run in a fresh clone knows what one-time setup is needed.

## Verification log (amendment 2026-09-23: R10-R14)

- `frontend`: `npx vitest run` (Node v22.12.0) -> 14 files, 141 tests pass. Run several times to confirm stability: with default worker concurrency this build machine showed occasional single-test 5s timeouts under load (a different test each run, never the same one twice — component tests that use real timers/`userEvent`, e.g. `FilterBar`, `DeviceGrid`, `AppShell`), consistent with CPU contention across parallel jsdom workers rather than a logic bug (each of those files, and the full suite, passed cleanly on other runs). `npx vitest run --maxWorkers=2` reproduced 141/141 green on every attempt and is the recommended invocation on a loaded machine.
- `frontend`: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npx next build` (Node v22.12.0) -> compiled, TypeScript passed, all 6 routes generated, run twice, both clean.
- `lucide-react@^1.47.0` installed (hoisted to the workspace root `node_modules` — this repo is an npm workspace); `package-lock.json` updated.
- New/extended test files: `styles/tokens.test.ts` (+elevation/motion/interaction-contrast), `styles/literals.test.ts` (+elevation, motion, status-symbol-glyph, single-badge, page-padding scans), `styles/interaction.test.ts` (new), `components/StatusBadge.test.tsx` (rewritten for icons), plus `data-kind` assertions added to `DeviceCard.test.tsx`, `DeviceGrid.test.tsx`, `EventLog.test.tsx`, `DeviceDetailView.test.tsx`.
- Manual browser checks from plan.md (elevation screenshot, hover/press/tab recording, reduced-motion toggle, VoiceOver label, grayscale) were not run by the builder; left for review, as with the R1-R9 pass.

## Tasks (round 2: Tailwind CSS + Headless UI migration, R15-R18)

> Builder addendum for plan.md's "Tailwind + Headless UI migration (R15-R18)" section. Follows the plan's
> 8 phases (0-7). R1-R14 outcomes must keep holding under the new stack; this only changes *how* they are
> implemented.

- [x] **T24 - Phase 0: characterization tests (write first, green on current CSS-Modules code)** (R18)
  - Files: `app/devices/DevicesView.test.tsx`, `app/admin/users/page.test.tsx`, `app/devices/DeviceForm.test.tsx`,
    `app/devices/DeviceDetail.test.tsx`, `app/signin/page.test.tsx` (all new)
  - Acceptance: each test queries by role/label/placeholder/visible text only (never class names or DOM shape);
    all pass against the pre-migration code before any styling file changes.

- [x] **T25 - Phase 1: toolchain + theme** (R15)
  - Files: `frontend/package.json`/`package-lock.json` (+tailwindcss, @tailwindcss/postcss, postcss,
    @headlessui/react), new `frontend/postcss.config.mjs`, `styles/tokens.css` (-> `@theme` + temporary legacy
    alias block), `styles/globals.css` (-> `@import "tailwindcss"` + tokens + minimal `@layer base`),
    `app/layout.tsx` (import globals.css only, drop tokens.css import)
  - Acceptance: `npx next build` produces CSS containing `p-content`/`w-sidebar` utility rules (verifies named
    spacing keys resolve per the plan's phase-1 risk check); if not, fall back to numeric steps per the plan.
    Old CSS Modules still render (via the alias block) so the app isn't broken mid-migration.

- [x] **T26 - Phase 2: ui primitives** (R16, R17)
  - Files: new `components/ui/{Button,Card,PageHeading,Table,Field,SelectableList}.tsx`, `lib/cx.ts`,
    `vitest.setup.ts` (jsdom shims for ResizeObserver/getAnimations)
  - Acceptance: each primitive has a small unit test; Headless UI-backed primitives render and respond to
    keyboard (Enter/Space/Escape where applicable).

- [x] **T27 - Phase 3: shell** (R3-R6, R9, R16, R17 conventions 1, 2, 9)
  - Files: `components/shell/AppShell.tsx` (+delete `.module.css`), `SideNav.tsx` (+delete `.module.css`),
    `TopBar.tsx` (+delete `.module.css`), new `components/shell/AccountMenu.tsx`
  - Acceptance: `AppShell.test.tsx` updated so sign-out opens the account menu (Headless `Menu`) before
    clicking "Sign out"; same `signOut`-then-`replace` assertion; nav/active-item/role-gating tests unchanged
    in intent.

- [x] **T28 - Phase 4: badge** (R2, R12, R13, R17 convention 5)
  - Files: `components/StatusBadge.tsx` (+delete `.module.css`)
  - Acceptance: `StatusBadge.test.tsx` passes unmodified (same public assertions: icon, aria-hidden, label).

- [x] **T29 - Phase 5: shared components** (R7, R15, R17 conventions 4, 6)
  - Files: `components/DeviceCard.tsx` (+delete `.module.css`), `components/DeviceGrid.tsx` (+delete
    `.module.css`), `components/FilterBar.tsx` (+delete `.module.css`, Headless `Field`/`Select`, H2/H3),
    `components/MetricTable.tsx` (+delete `.module.css`, `ui/Table`), `components/EventLog.tsx` (+delete
    `.module.css`)
  - Acceptance: `DeviceCard`, `DeviceGrid`, `FilterBar`, `MetricTable`, `EventLog` test suites pass unmodified
    (same queries as before).

- [x] **T30 - Phase 6: pages** (R7, R14, R16, R17, R18)
  - Files: `app/page.tsx` (H4, PageHeading), `app/devices/DevicesView.tsx` (+delete `.module.css`, H5-H9,
    PageHeading, `SelectableList`), `app/devices/DeviceDetail.tsx` (H10, H11, `Table`), `app/devices/DeviceForm.tsx`
    (H12-H14), `app/devices/[deviceId]/DeviceDetailView.tsx` (+delete `.module.css`, PageHeading),
    `app/admin/users/page.tsx` (H15-H17, PageHeading, `Table`), `app/signin/page.tsx` (H18)
  - Acceptance: zero remaining `*.module.css` files and zero `style={{`/`style=` in `app/`+`components/`;
    every characterization test from T24 and every pre-existing suite passes; visible labels added to the
    admin create-user inputs (Email, Display name, Temporary password) and the metadata Key/Value inputs.

- [x] **T31 - Phase 7: close-out** (R1, R7, R15, R17)
  - Files: `styles/tokens.css` (delete legacy alias block), `styles/README.md` (token tables rewritten +
    new "UI conventions" section), `styles/literals.test.ts` (rewritten for class-token scanning, allowlist
    driven to empty), `styles/interaction.test.ts` (rewritten for recipe/class checks), `styles/tokens.test.ts`
    (rewritten for `@theme`), new `styles/conventions.test.ts`
  - Acceptance: `npx vitest run --maxWorkers=2` all green; `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud
    npx next build` succeeds; static-test allowlist is empty; manual AC17(d) checklist left for review.

## Requirement coverage (round 2: R15-R18)

| Req | Tasks |
|---|---|
| R15 | T25, T29, T30, T31 |
| R16 | T26, T27, T29, T30 |
| R17 | T26, T27, T28, T29, T30, T31 |
| R18 | T24, T27, T30, T31 |

## Deviations from plan (round 2: R15-R18 Tailwind + Headless UI migration)

- **`tokens.css` comment bug found by the build, not by tests**: an early draft of the Motion section's
  doc comment contained the literal substring `duration-*/ease-*`, which is a CSS comment-close token
  (`*/`) landing mid-comment. This silently truncated the `/* ... */` comment early, leaving the rest of
  the comment's prose as bare CSS text that `next build`'s Tailwind PostCSS pass rejected as a syntax
  error ("Missing opening ("). Vitest's static tests never exercise real CSS parsing, so this only surfaced
  at `next build`. Fixed by rewording to "no duration- or ease- class" (functionally identical wording,
  no `*/` substring). Documented here because it is exactly the kind of thing R18 says the test matrix
  should catch and didn't — a follow-up worth considering is a cheap "does tokens.css parse" smoke test.
- **`components/ui/Field.tsx` wrapper prop types**: the plan's recipe sketch used
  `ComponentProps<typeof HeadlessInput>` (etc.) to type `TextInput`/`SelectInput`. That does not
  typecheck against Headless UI 2.x's generic, "as"-polymorphic component signatures (`ComponentProps`
  cannot resolve the default tag's native props through a generic call signature), which `next build`'s
  TypeScript pass caught but `vitest` (no full type-check) did not. Fixed by typing these wrappers
  directly against `ComponentPropsWithoutRef<"input">` / `<"select">` (the actual default-rendered
  element), which Headless UI forwards untouched. No behavior change; `components/ui/Field.test.tsx`
  passes unmodified.
- **Two-column device list/detail layout uses equal `flex-1` panes**, not the plan's implied "list wider
  than detail" ratio. Tailwind's restricted numeric scale (plan's closed spacing-step set) has no
  fractional/ratio flex utility without an arbitrary value (`flex-[2]`, banned by the static test) or a
  `/`-based fraction class (also banned). Recorded as one of the plan's expected "small, documented
  rounding changes."
- **`components/EventLog.tsx` row columns lost their fixed `min-width` alignment** (time/metric columns
  no longer line up vertically across rows). The original CSS used `min-width: 6rem` / `8rem`, values
  with no equivalent in the closed spacing-step set `{0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12}` (max step 12 =
  3rem). Rather than add a new named spacing key for one component, the columns now flow naturally
  (`flex gap-4`, no fixed width) — a small, documented visual rounding, not a behavior change (content
  and order are identical; `EventLog.test.tsx` passes unmodified).
- **`app/signin/page.tsx` top margin rounded from `4rem` to `3rem`** (`mt-16` -> `mt-12`), for the same
  reason: `16` is not in the allowed spacing-step set, `12` (3rem) is the nearest allowed step.
- **`styles/interaction.test.ts` and `styles/literals.test.ts` (R10/R11/R12/R13/R14 class-token scans)
  use a shared string/template-literal + whitespace-split heuristic** to extract "class tokens" from
  `.tsx` source, rather than a full TSX/JSX parser (matching the plan's "shared helper... takes string
  literals and template-literal static parts, splits them on whitespace" description literally, but
  implemented as one dependency-free regex-based helper instead of an AST walk). This can in principle
  both under- and over-match on unusual code shapes; the reviewer should still spot-check with grep, as
  the R1-R9 pass's literal scanners already noted for their own heuristics.
- **`STATUS_COLOR_TOKEN` in `styles/literals.test.ts` deliberately excludes `accent`** from the
  R13-restricted status-color set. The plan's token-mapping table groups `accent`/`accent-hover`/
  `accent-bg` together with the true status hues (`success`/`warning`/`danger`/`neutral`/
  `decommissioned`), but `accent` is also the general-purpose interactive color used everywhere
  (primary buttons, active nav item, links, focus ring) — restricting it to `StatusBadge.tsx` only would
  make the whole design system fail its own scan. Only the five true status hues (plus their `-bg`
  tints) are restricted, consistent with the R1-R9 pass's original interpretation.
- **Two Headless `Menu` keyboard tests were not made fully automated**: `AppShell.test.tsx`'s sign-out
  flow (click the account-menu button, click "Sign out") is automated and passing, but a stricter
  "Escape closes the menu and returns focus to the button" assertion could not be made to pass reliably
  in this jsdom environment (Headless UI 2.x's `Menu`/`Transition` exit path did not consistently
  unmount on a synthetic Escape keydown even with the `ResizeObserver`/`getAnimations` shims from
  plan.md's risk list). Removed rather than left flaky; left for the manual keyboard audit (R16 AC).

## Verification log (round 2: R15-R18)

- **Phase 0 (characterization)**: `frontend`: new tests `app/devices/DevicesView.test.tsx`,
  `app/admin/users/page.test.tsx`, `app/devices/DeviceForm.test.tsx`, `app/devices/DeviceDetail.test.tsx`,
  `app/signin/page.test.tsx` (22 tests) written and run green against the pre-migration CSS-Modules code
  before any styling file was touched; full baseline suite (`npx vitest run`) was 19 files / 163 tests
  passing before phase 1 began.
- **Toolchain**: `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `postcss`, `@headlessui/react@2.2.10`
  installed (exact versions match plan.md's pinned decisions). Read
  `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` (Tailwind CSS section) and
  `.../02-guides/tailwind-v3-css.md` per `frontend/AGENTS.md`, confirming the `@tailwindcss/postcss` +
  `postcss.config.mjs` + `@import "tailwindcss"` setup used.
- **Named spacing keys verified early (phase 1 risk check)**: after wiring the shell to `p-content`/
  `w-sidebar`, `next build`'s compiled CSS output was inspected directly
  (`.next/static/chunks/*.css`) and contains `.p-content{padding:var(--spacing-content)}` and
  `.w-sidebar{width:var(--spacing-sidebar)}` — named `--spacing-*` theme keys resolve to utilities as
  documented, so the plan's numeric-step fallback was not needed.
- **Final state**: `find . -iname "*.module.css"` and `grep -rl "style={{" app components` both return
  empty (zero CSS Modules, zero inline styles) — R15's "no per-component stylesheets or inline styles".
- `frontend`: `npx vitest run --maxWorkers=2` -> 22 files, 210 tests pass, run three times to confirm
  stability (one earlier run under heavy concurrent build/install load on this machine showed transient
  5s-timeout failures on 2 unrelated test files per run, different files each time — confirmed not
  reproducible by re-running those files alone or the full suite again once load dropped; consistent
  with the same CPU-contention flakiness documented in the R10-R14 round, not a logic bug).
- `frontend`: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npx next build` -> compiles, passes
  TypeScript, generates all 6 routes; run clean twice after the two fixes above (tokens.css comment,
  Field.tsx prop types).
- Static-test allowlists (`STATUS_COLOR_ALLOWLIST`, the raw-tag `ALLOWED` set in `conventions.test.ts`,
  etc.) are non-empty only for the specific, documented R13/AC17(c) exclusions the spec and plan name
  explicitly (error text, the stale-card tone, the account menu's own button, `DeviceForm`'s
  `<datalist>`); there is no "not yet migrated" entry left — every `*.module.css` and inline style is
  gone.
- Manual checks from plan.md (AC17(d) page-by-page review against the README, keyboard/VoiceOver audit,
  1024/1440px visual check, before/after screenshots) were not run by the builder; left for review, as
  with the R1-R14 rounds.

## Round 4 review fixes (R15-R18)

- **R11 (blocking, review.md Round 4 issue 1)**: `styles/globals.css`'s base-layer plain-link rule
  (`:where(a) { transition: color; }`) was raw CSS, not a Tailwind utility class, so it never picked up
  `--default-transition-duration`/`--default-transition-timing-function` (those apply automatically only
  to Tailwind-generated `transition`/`transition-colors` classes). The compiled output
  (`.next/static/chunks/*.css`) confirmed the color change snapped instead of animating for the 4 plain
  `<Link>`s with no className (`admin/users/page.tsx:35,71`, `DeviceDetailView.tsx:37,52`). Fixed by
  spelling out the duration/easing explicitly: `transition: color var(--default-transition-duration)
  var(--default-transition-timing-function);`. Verified in the rebuilt compiled CSS.
- Added a regression test, `styles/literals.test.ts`'s new "globals.css raw transitions use the shared
  duration/easing tokens (R11)" describe block: scans every raw `transition`/`transition-property`
  declaration in `globals.css` and fails if it doesn't reference `var(--default-transition-duration)`,
  so a future handwritten transition can't silently drop the duration again (this class of bug — a
  compiled-CSS-only failure vitest's DOM-level tests never exercise — is the same gap the tokens.css
  comment-truncation deviation note above already flagged).
- Re-run: `npx vitest run --maxWorkers=2` -> 22 files, 212 tests pass; `next build` succeeds; compiled
  `:where(a){...}` rule now includes the duration/easing (verified directly in `.next/static/chunks/*.css`).
