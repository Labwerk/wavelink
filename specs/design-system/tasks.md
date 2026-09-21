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

## Review round 1 fixes

- **R7 (blocking, review.md issue 1)**: swapped every exact-token spacing literal (`3rem`..`0.25rem` in padding / margin / gap, including the `0.5rem` inside shorthands like `0.1rem 0.5rem`) for `var(--space-N)` and every `font-weight: 600` / `fontWeight: 600` for `var(--weight-semibold)`, in the 13 existing app/component files. Off-scale values (`0.1rem`, `0.15rem`, `0.35rem`, `0.6rem`, `0.8rem`, `0.9rem`) are left as legacy. No rendered values changed.
- `styles/literals.test.ts` now also flags token-equal spacing (padding / margin / gap) and font weights, so R7 for spacing and weight is enforced rather than left to review. Its header comment was updated; `styles/README.md` still describes the legacy off-scale exception.
- Re-run: `frontend` `npx vitest run` -> 13 files, 101 tests pass; `next build` succeeds.
- This corrects the earlier T8 scope: the plan's "swap font-size and spacing when the value exactly equals a token" is now fully done, so there is no spacing deviation to record.
