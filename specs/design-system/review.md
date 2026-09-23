# Review: Design system & app shell — Round 4 (final)

> Reviewer: independent review agent. Scope: the Tailwind CSS + Headless UI migration
> (spec Constraints + R15-R18, ten-convention R17/AC17; plan.md "Tailwind + Headless UI
> migration (R15-R18)"; tasks.md T24-T31 with its Deviations list). Re-confirms R1-R14 did
> not regress under the new stack. Code is uncommitted on `feature/design-system`; verified
> via `git diff`/`git status`, not git history.

## Verdict: PASS

All 18 requirements are met. The one Blocking issue found in the first pass of this round
(R11 regression: the base-layer plain-link `transition` rule in `styles/globals.css` did not
animate because it was raw CSS rather than a Tailwind utility class, so it never picked up the
theme's default transition duration/easing) has been fixed by the builder and independently
re-verified by this review, including a direct read of the rebuilt, compiled CSS output. A
regression test now guards against this exact class of bug recurring silently.

`npx vitest run --maxWorkers=2` → 22 files, **212 tests, all pass** (210 + 2 new regression
assertions). `next build` succeeds.

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met | `frontend/styles/tokens.css` `@theme` block (`tokens.css:12-98`) is the sole token source; `styles/README.md` documents every token; `styles/tokens.test.ts` "parity" describe block enforces doc↔theme sync. |
| R2 | Met | `components/StatusBadge.tsx:70-84` renders a lucide icon (`aria-hidden="true"`) plus a visible text label for every kind; `styles/tokens.test.ts` contrast checks (fg/muted/status colors on canvas/surface/surface-raised/surface-hover, and on their `-bg` tints) all pass; independent Unicode-glyph grep (Python, same ranges as the plan) over all non-test `.ts`/`.tsx` found zero matches. |
| R3 | Met | `components/shell/AppShell.tsx` mounted once in `app/layout.tsx`; `AppShell.test.tsx` (nav/identity/loading-frame assertions) passes. |
| R4 | Met | `lib/nav.ts` `visibleNavItems` unchanged in logic; `lib/nav.test.ts` passes. |
| R5 | Met | Shell persists in root layout; `next/link` navigation; `AppShell.test.tsx` `aria-current` assertions pass. |
| R6 | Met | `styles/globals.css:19-29` `color-scheme: dark`, canvas/fg body rules; independent grep for `dark:` variant across `app/`+`components/` → 0 matches; `styles/literals.test.ts` "no dark: variant" check passes. |
| R7 | Met | Zero `*.module.css` and zero `style={{` remain (`find … -iname "*.module.css"` and `grep -rn 'style={{' app components` both empty, independently reproduced); `styles/literals.test.ts` class-token scan (arbitrary values, raw palette colors, non-scale spacing) passes; independent grep for raw palette classes (`bg-gray-800` etc.), bracket arbitrary values (`[...]`), and `/`-modifiers (`bg-accent/10`) all found 0 matches. |
| R8 | Met (manual, unchanged) | `components/shell/SideNav.tsx:14` / `AppShell` `min-w-5xl` (1024px); not testable in jsdom, carried over as a manual check. |
| R9 | Met | Shell/nav/sign-out logic untouched — only markup/classes changed. `AppShell.test.tsx`'s sign-out test is the one sanctioned rewrite the plan predicted (opens the account menu first, same `signOut()` → `router.replace("/signin")` assertions, `AppShell.test.tsx:132-140`) — confirmed via `git diff`. |
| R10 | Met | `tokens.css:80-88` `--shadow-1`/`--shadow-2` (same values as the pre-migration `--elevation-1/2`); z-scale `z-10`/`z-20`/`z-30` documented in README and applied at `SideNav.tsx:14` (`z-20`), `TopBar.tsx:26` (`z-10`), `AccountMenu.tsx:33` (`z-30`); `DeviceCard`'s `Card interactive` recipe (`components/ui/Card.tsx:5-7`) uses `shadow-1`→`shadow-2` on hover; `styles/literals.test.ts` bans any `shadow-*`/`z-*` value outside `{1,2,none}`/`{10,20,30}` — independent grep for other shadow/z values found none. |
| R11 | Met (fixed — see Issue 1 history) | Every *recipe* component (`Button`, `Card`, `Field`, `SelectableList`, `SideNav`, `AccountMenu`) has hover/active/focus classes driven by Tailwind's `transition`/`transition-colors` utilities, which correctly pick up `--default-transition-duration: 150ms` / `--default-transition-timing-function` from `tokens.css:96-97`. Movement (`motion-safe:hover:-translate-y-0.5` in `Card.tsx:7`, `motion-safe:data-closed:scale-95` in `AccountMenu.tsx:33`) is correctly gated behind `motion-safe:`. The base-layer "plain link" rule (`styles/globals.css:40-43`) previously used raw `transition: color;` with no duration — now fixed to `transition: color var(--default-transition-duration) var(--default-transition-timing-function);`. Re-verified directly in the freshly rebuilt compiled CSS (`rm -rf .next` then `next build`): `.next/static/chunks/109ay5ip4p46j.css` now contains `:where(a){color:var(--color-accent);transition:color var(--default-transition-duration) var(--default-transition-timing-function)}` for the 4 previously-affected bare `<Link>`s (`app/admin/users/page.tsx:35,71`, `app/devices/[deviceId]/DeviceDetailView.tsx:37,52`). A new regression test, `styles/literals.test.ts`'s "globals.css raw transitions use the shared duration/easing tokens (R11)" describe block, scans every raw `transition`/`transition-property` declaration in `globals.css` and fails if it doesn't reference `var(--default-transition-duration)` — passing, and independently confirmed to have the right self-check (catches `transition: color;`, passes `transition: color var(--default-transition-duration) ...;`). |
| R12 | Met | `components/StatusBadge.tsx:1-41`, same 9-icon lucide map as the prior round, sized via `size-icon` (theme `--spacing-icon`); `styles/literals.test.ts` "status icons only" ban + independent Unicode sweep both clean; `lucide-react` import restricted to `StatusBadge.tsx` (verified by grep and by the `conventions.test.ts` / `literals.test.ts` scans). |
| R13 | Met | `STATUS_TONE` static class map (`StatusBadge.tsx:58-68`) is the only place status-color utilities render outside the documented allowlist (`Card.tsx` stale tone, `Field.tsx` `ErrorText`, `DeviceDetail.tsx`/`admin/users/page.tsx`/`signin/page.tsx` inline error text) — `styles/literals.test.ts` "exactly one status badge implementation" describe block automates this and passes; independently confirmed by grep. No second `function \wBadge`/CSS class matching `/badge\|pill/i` found. |
| R14 | Met | `components/shell/AppShell.tsx` content wrapper uses `p-content`; `TopBar.tsx:26` uses `px-content`; `tokens.css:58` `--spacing-content: 2rem` (an allowed scale step); every `<main>` in `app/**` outside `app/signin` has no padding utility (independently grepped, confirmed empty); `styles/literals.test.ts` "shell-owned content inset" describe block passes. |
| R15 | Met | `tokens.css:12-98` is one `@theme` block with the Tailwind default namespaces reset to `initial` first (`--color-*`, `--text-*`, `--font-*`, `--font-weight-*`, `--leading-*`, `--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--text-shadow-*`, `--ease-*`, `--animate-*`, all confirmed present at `tokens.css:13-24` and checked by `tokens.test.ts` "namespace resets"); zero `*.module.css` and zero inline `style=`/`style={{` anywhere in `app/`+`components/` (independently verified); the only non-utility CSS is the five-rule `@layer base` in `globals.css`, documented in `styles/README.md`. |
| R16 | Met | `AccountMenu.tsx` uses Headless `Menu`/`MenuButton`/`MenuItem`/`MenuItems` for the account dropdown; `Field.tsx` wraps Headless `Field`/`Label`/`Description`/`Input`/`Select`/`Checkbox` for every form control; `Button.tsx` wraps Headless `Button`; `DeviceDetail.tsx` uses Headless `Disclosure`/`DisclosureButton`/`DisclosurePanel` for the change-history toggle (auto-managed `aria-expanded`, confirmed by reading the render-prop `{ open }` usage at `DeviceDetail.tsx:162-166`). `styles/conventions.test.ts` "Headless UI primitives imported only where the convention lives" passes, confirming no hand-rolled dropdown/dialog/keyboard logic exists elsewhere. `AppShell.test.tsx`'s sign-out test exercises the Menu open→click path end to end. |
| R17 | Met | All ten conventions have exactly one implementation file (`conventions.test.ts` "each convention implementation file exists exactly once" passes); README "UI conventions" section documents all ten (`styles/README.md:136+`, confirmed by grep); no raw `<button\|table\|select\|input\|textarea>` outside the allowlisted convention files (`conventions.test.ts` "no raw form/table controls" passes, independently spot-checked); every authenticated page's primary render starts with `<PageHeading` (`app/page.tsx:77`, `app/devices/DevicesView.tsx:113`, `app/devices/[deviceId]/DeviceDetailView.tsx:52`, `app/admin/users/page.tsx:71` — loading/error branches correctly exempted, e.g. `admin/users/page.tsx:24-38`). Manual AC17(d) page-by-page visual review (no unique card margins, no one-off focus styles) not performed by this text-only review — see Not covered. |
| R18 | Met | Phase-0 characterization tests (`DevicesView.test.tsx`, `admin/users/page.test.tsx`, `DeviceForm.test.tsx`, `DeviceDetail.test.tsx`, `signin/page.test.tsx`) query by role/label/placeholder/visible text only (spot-checked `DevicesView.test.tsx` in full: `getByLabelText`, `getByRole("button", { name: … })`) and all pass against the migrated code. Existing suites pass with only the two sanctioned rewrites (`AppShell.test.tsx` sign-out opens the menu first; `StatusBadge.test.tsx` icon assertions, both already accounted for under R9/R12 above) — confirmed via `git diff` that no other test file's assertions were weakened, only extended (e.g. `DeviceCard.test.tsx`, `DeviceGrid.test.tsx` gained `data-kind` checks, none removed). `next build` succeeds. |

## Scrutiny of the builder's flagged deviations (tasks.md "Deviations from plan (round 2)")

- **Equal `flex-1` panes for the device list/detail two-column layout** (vs. the plan's implied
  wider-list ratio): acceptable. Neither the spec nor plan.md's requirement list mandates a
  specific ratio; the deviation is honestly disclosed and traces to a real constraint (the
  closed spacing/fraction-utility scale has no ratio class without an arbitrary value, which is
  correctly banned). No requirement is violated.
- **`EventLog` losing fixed-width time/metric columns** (now `flex gap-4`, no `min-width`):
  acceptable. Confirmed in `components/EventLog.tsx:54-58` — content and order are unchanged,
  `EventLog.test.tsx` passes unmodified, and no requirement mandates column alignment. Purely
  visual, correctly disclosed.
- **`/signin` top margin `mt-16` → `mt-12`** (4rem → 3rem): acceptable. `16` is not in the
  closed spacing-step set `{0,0.5,1,1.5,2,3,4,6,8,12}`; `12` (3rem) is the nearest allowed step.
  `/signin` is outside R14's scope. Confirmed at `app/signin/page.tsx:37`.
- **Dropped Headless `Menu` Escape-closes-and-returns-focus test**: this is a real automated-coverage
  gap (confirmed — `grep -rn "Escape" **/*.test.tsx` finds only the builder's explanatory comment
  at `AppShell.test.tsx:146`, no assertion). However, Escape-to-close and focus-return are Headless
  UI `Menu`'s **built-in** keyboard behavior (not hand-rolled), so the underlying implementation is
  not suspected to be broken — only the automated verification of it is missing in this jsdom
  environment, which R16's own acceptance criterion explicitly carves out as a **manual** "keyboard
  audit (Tab through every interactive element, test Escape/Enter/Space where applicable)". This is
  listed under Not covered below rather than as an Issue, since it doesn't fail against a
  criterion the plan committed to automating (the plan's R18 strategy step 3 proposed it as
  automated, but the builder's documented, non-flaky-workaround-attempted deviation to defer it
  to the manual audit is a reasonable, disclosed trade-off, not a silent gap).
- **Visible labels added to the admin create-user inputs (Email, Display name, Temporary password)
  and the `DeviceForm` metadata Key/Value inputs**: acceptable, and in fact *required* by R17
  convention 7 ("form field: label above control"). This is not a new feature or new field — the
  same three admin inputs and the same two metadata inputs exist today with only placeholder text;
  turning the placeholder text into a visible `<Label>` is exactly the re-layout the spec's
  narrowed non-goal anticipates ("applied to existing screens' existing content without new
  fields... "). Confirmed at `app/admin/users/page.tsx:185-203` (labels match the old placeholder
  text verbatim) and `app/devices/DeviceForm.tsx:164-171` (Key/Value).

## Issues

### Blocking

None remaining.

**History (resolved this round):** the base-layer `:where(a)` plain-link rule in
`frontend/styles/globals.css:40-43` used raw CSS `transition: color;` with no duration, so it
did not inherit the theme's `--default-transition-duration`/`--default-transition-timing-function`
the way Tailwind's generated `transition`/`transition-colors` utility classes do. Confirmed in the
compiled build output that the 4 bare `<Link>`s relying on this rule (`app/admin/users/page.tsx:35`,
`:71`, `app/devices/[deviceId]/DeviceDetailView.tsx:37`, `:52`) snapped their hover/active color
change instantly instead of animating (violating R11/AC11). The builder fixed this by spelling out
`transition: color var(--default-transition-duration) var(--default-transition-timing-function);`
and added a regression test (`styles/literals.test.ts`, "globals.css raw transitions use the shared
duration/easing tokens (R11)") that scans every raw `transition`/`transition-property` declaration
in `globals.css` for the theme reference. Both the source fix and the compiled CSS output were
independently re-verified by this review (see Test results).

### Should-fix

None.

### Nice-to-have

- Consider adding automated coverage for Headless `Menu` Escape-to-close, if a future Headless UI
  version or testing-library upgrade makes the jsdom `Transition`/`getAnimations` interaction more
  reliable — currently correctly deferred to the manual audit (see Not covered).

## Test results

- `frontend`: `npx vitest run --maxWorkers=2` (Node v22.12.0 via nvm) → **22 files, 212 tests, all pass**
  (first pass: 210/210 before the fix; re-run after the fix: 212/212, including the builder's 2 new
  regression assertions for the `globals.css` transition rule).
- `frontend`: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npx next build` (Node v22.12.0),
  run twice (once before, once after the fix, the second with `rm -rf .next` first for a clean
  rebuild) → both compiled successfully, TypeScript passed, all 6 routes generated (`/`,
  `/admin/users`, `/devices`, `/devices/[deviceId]`, `/signin`, `/_not-found`).
- Compiled-CSS inspection (this review's own step, not in the builder's verification log, done both
  before and after the fix): `.next/static/chunks/*.css` was read directly. Before the fix:
  `:where(a){color:var(--color-accent);transition:color}` (no duration — the bug). After the fix
  (fresh `rm -rf .next && next build`, `.next/static/chunks/109ay5ip4p46j.css`):
  `:where(a){color:var(--color-accent);transition:color var(--default-transition-duration) var(--default-transition-timing-function)}`
  — confirmed fixed. Also confirmed `p-content`/`w-sidebar` resolve to real utility rules
  (`--spacing-content`/`--spacing-sidebar` work as named theme keys, per the plan's phase-1 risk
  check).
- Independent grep/Python sweeps performed by this review (not just the project's own scanners):
  - Unicode status-glyph scan (same ranges as the plan) over all non-test `.ts`/`.tsx` → 0 matches.
  - `*.module.css` remaining → 0. `style={{` in `app/`+`components/` → 0.
  - `dark:` variant → 0. Arbitrary bracket values (`[...]`) → 0. Raw Tailwind palette classes
    (`bg-gray-800` etc.) → 0. `/`-modifiers (`bg-accent/10`, `text-sm/6`) → 0.
  - `duration-*`/`ease-*` classes, `transition-all` → 0. `<main>` with a padding utility outside
    `app/signin` → 0. `z-*` outside `{10,20,30}` → 0. `shadow-*` outside `{1,2,none}` → 0.
  - `lucide-react` imports → only `components/StatusBadge.tsx`.
  - Status-color utilities (`bg/text/border-success|warning|danger|neutral|decommissioned[-bg]`)
    outside `StatusBadge.tsx` → only the documented allowlist (`Card.tsx`, `Field.tsx`,
    `DeviceDetail.tsx`, `admin/users/page.tsx`, `signin/page.tsx`).
  - `git diff --stat` / `git status` reviewed: all changes are inside `frontend/` and
    `specs/design-system/*.md` plus the workspace `package-lock.json` (expected, for
    `tailwindcss`/`@tailwindcss/postcss`/`postcss`/`@headlessui/react`). No stray files outside
    `frontend/` from local tooling; `backend/_generated/`, `.convex/`, `node_modules/` remain
    gitignored, not newly tracked.

## Not covered

- **R8** (1024px+ viewport correctness), the manual halves of **R10/R11/R12** (elevation
  screenshot with borders disabled, hover/press/tab screen recording, OS-level reduced-motion
  toggle, VoiceOver label read-through), and **AC17(d)** (manual page-by-page visual review against
  the README for one-off margins/focus styles) remain manual/browser-only, as in prior rounds.
- **R16's keyboard audit** (Tab through every interactive element; Escape/Enter/Space where
  applicable) — the account menu's Escape-to-close and focus-return specifically has no automated
  test (see "Scrutiny of the builder's flagged deviations" above); Headless UI's `Menu` supplies
  this behavior by default, but it has not been independently exercised in a real browser by this
  review.
- **Visual before/after screenshots** referenced in plan.md's R18 strategy step 6 were not
  produced or reviewed by the builder or this review (text-only environment).

## Reminder to the builder

Per the coordinator's instruction: **do not run destructive git commands** (`checkout`, `restore`,
`reset`, `stash`, `clean`, etc.) on this tree — all of R10-R14 and R15-R18's work is uncommitted,
and any of those commands could discard it. Confirmed the builder's fix respected this (no git
history change, tree still fully uncommitted).

## Summary for the requesting agent

Round 4 final verdict: **PASS**. The one Blocking issue found in this round's first pass (R11
regression in the base-layer plain-link transition, `styles/globals.css:42`) was fixed by the
builder (`a8281390229d2a3d5`) and independently re-verified by this review: source fix confirmed,
a new regression test added and passing, `npx vitest run --maxWorkers=2` green at 212/212, a fresh
`next build` succeeds, and the compiled CSS output was re-read directly to confirm the `:where(a)`
rule now carries the theme's duration/easing. This closes the review loop for design-system R1-R18
(4 rounds total: round 2 closed R1-R9, round 3 closed R10-R14, round 4 closed R15-R18 after one
fix cycle). No message needed to the planner or spec-writer — the defect traced to the builder's
implementation, not the plan or spec, and is now resolved.

Remaining manual-only checks (not blocking, browser-only, unchanged from before): R8 at
1024/1440px; R10 elevation screenshot with borders suppressed; R11 hover/press/tab recording and
OS-level reduced-motion toggle; R12 VoiceOver/screen-reader label read-through; R16's keyboard
audit, specifically the account menu's Escape-to-close/focus-return (Headless UI's built-in
behavior, not independently exercised in a real browser); AC17(d)'s manual page-by-page visual
review against the README; and the before/after screenshots from plan.md's R18 strategy step 6.

---

# Review: Design system & app shell — Round 3 (history)

> Reviewer: independent review agent. Scope: re-confirm R1-R9 (previously PASS, round 2)
> did not regress, and verify the newly implemented R10-R14 (elevation, interaction states,
> icon set, single StatusBadge, shell-owned content inset). Code at the uncommitted working
> tree on `feature/design-system` (builder tasks T11-T23).

## Verdict: PASS

All 14 requirements are met with evidence in code and passing automated tests. `npx vitest run
--maxWorkers=2` is green (141/141, 14 files) and `next build` succeeds. Independent grep sweeps
for Unicode status glyphs, ad hoc badge markup, per-page padding literals, raw shadow/z-index/
duration values, and missing hover/active/focus states found no violations beyond what the
project's own scanners already catch. No unexpected files outside `frontend/` are in `git
status` (the only ignored/untracked items outside `frontend/` — `.convex/`, `backend/_generated/`,
`node_modules/`, `.env.local` — are gitignored local build/codegen artifacts, not new source).

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met | `frontend/styles/tokens.css` is the sole `:root` token definition; `styles/README.md` documents every token; `styles/tokens.test.ts` enforces doc parity. Unchanged since round 2. |
| R2 | Met | `components/StatusBadge.tsx:55-63` renders icon (`aria-hidden`) + visible text for every kind; `styles/tokens.test.ts` contrast checks; grep sweep found no color-only status cue. |
| R3 | Met | `components/shell/AppShell.tsx` mounted once in `app/layout.tsx`; `AppShell.test.tsx` unchanged and passing. |
| R4 | Met | `lib/nav.ts` `visibleNavItems`; `lib/nav.test.ts` passing (141/141 total includes this suite). |
| R5 | Met | Shell persists in root layout; `next/link` navigation; `AppShell.test.tsx` `aria-current` assertions pass. |
| R6 | Met | `globals.css:1-12` dark theme; mechanical token migration retained from round 1/2. |
| R7 | Met | `styles/literals.test.ts` "no token-duplicating literals" describe block passes; manual grep for hex/rgb/named colors and padding literals in `app/`, `components/` found none outside the documented legacy/allowlist exceptions (`DeviceForm.tsx:165` fieldset padding and `admin/users/page.tsx:181` form padding are element-level, not page-root, and are pre-existing/off-scale, not new duplicates). |
| R8 | Met (manual, unchanged) | `AppShell.module.css:4` `min-width: 1024px`; not testable in jsdom, carried over from round 2. |
| R9 | Met | `DevicesView.tsx` rows changed from `<li onClick>` to `<button type="button" aria-pressed>` (`DevicesView.tsx:248-259`) — same `onClick={() => onSelect(d._id)}` handler, same click behavior, now keyboard-focusable (an accessibility improvement, not a behavior change per R9's scope of "role-based visibility, sign-out, and navigation destinations"). `lib/useNow.ts` fix caches `Date.now()` between ticks instead of returning a fresh value on every `getSnapshot()` call (fixing a `useSyncExternalStore` contract violation that caused "Maximum update depth exceeded"); still ticks every 1s (`TICK_MS = 1000`), first render still reflects real time via lazy init (`cachedNow === null ? Date.now() : cachedNow`, `useNow.ts:47-49`). `lib/useNow.test.tsx` and all `DeviceDetailView`/`DeviceCard`/`DeviceGrid` suites pass unmodified logic paths. Existing suites (`nav`, `AppShell`, `FilterBar`, `MetricTable`) pass unmodified. |
| R10 | Met | `tokens.css:64-72` defines `--elevation-0/1/2` + `--layer-topbar/sidebar`, each with a paired surface; README "Elevation" table has a non-empty Use cell per level (verified); applied at `SideNav.module.css:9-10`, `TopBar.module.css:12-13`, `DeviceCard.module.css:9,15,21`; `styles/literals.test.ts` "elevation and z-index only via tokens" describe block bans one-off shadow/z-index values and asserts the three components declare `box-shadow: var(--elevation-...)`. |
| R11 | Met | `tokens.css:74-79` `--motion-duration`/`--motion-ease`/`--motion-lift` + reduced-motion override (`tokens.css:96-100`, sets `--motion-lift: 0px`); `globals.css:22-51` global `:where()` transition + hover/active/focus-visible rules (zero-specificity, explicit property list, no `transition: all`); per-component hover/active on `SideNav.module.css` `.item`/`.brand`, `DeviceCard.module.css` `.card` (translateY lift on hover, reset on active), `DevicesView.module.css` `.row`; `styles/interaction.test.ts` (new file) statically checks hover/active presence for every element in the plan's table, plus that `DevicesView.tsx` rows are real `<button>`s, not `<li onClick>`; `styles/literals.test.ts` motion describe block bans raw time literals, `transition: all`, and non-token `transform` values. All pass. |
| R12 | Met | `components/StatusBadge.tsx:1-41` imports 9 distinct `lucide-react` icons (`Wifi`, `WifiOff`, `ClockAlert`, `CircleQuestionMark`, `Ban`, `TriangleAlert`, `CircleX`, `CircleCheck`, `CircleMinus`), one render site (`StatusBadge.tsx:59`), sized/stroked from `--icon-size-sm`/`--icon-stroke` (`StatusBadge.module.css:36-41`), `aria-hidden="true"`, visible text label as accessible name. Manual grep sweep (Python Unicode range scan matching the plan's banned ranges) over all `.ts`/`.tsx` source outside `*.test.*` found zero status-symbol glyphs. `styles/literals.test.ts` "status icons only" describe block enforces the same ban with a self-check (flags `⚠`/`●`, allows `←`/`∅`/`⋯`/`—`/`·`/`…`). `StatusBadge.test.tsx` rewritten for icon assertions. |
| R13 | Met | Inventory S1-S12 fully migrated: `DeviceCard.tsx:50,52,60`, `DeviceDetailView.tsx:54,60,65`, `DeviceDetail.tsx:100-101`, `DevicesView.tsx:191,256`, `DeviceGrid.tsx:47`, `admin/users/page.tsx:103`, `EventLog.tsx:52` all render through `StatusBadge`. Grep sweep confirms: no second `function \wBadge`/`const \wBadge` outside `StatusBadge.tsx`; no CSS class matching `/badge|pill/i` outside `StatusBadge.module.css`; status color tokens (`--color-success/warning/danger/neutral/decommissioned` + `-bg`) only appear in `StatusBadge.module.css` plus the documented allowlist (`DeviceCard.module.css` stale tint; inline error-message text color in `DeviceDetail.tsx`, `DeviceForm.tsx`, `admin/users/page.tsx`, `signin/page.tsx`) — verified directly with `grep -rln`. `lucide-react` imported only by `StatusBadge.tsx` (verified). `styles/literals.test.ts` "exactly one status badge implementation" describe block automates all of this and passes. Component tests (`DeviceCard`, `DeviceGrid`, `EventLog`, `DeviceDetailView`) assert `data-kind` attributes. |
| R14 | Met | `AppShell.module.css:14-18` `.content { padding: var(--content-inset) }`; `TopBar.module.css:8` `padding: 0 var(--content-inset)`; `tokens.css:89-90` `--content-inset: var(--space-6)`. Inventory P1-P8 all removed: `page.tsx` `<main>` has no inline padding (verified — grep found none), `devices/page.tsx` fallback is a bare `<p>`, `DevicesView.tsx:109` uses `className={styles.layout}` (no padding in `DevicesView.module.css` `.layout`, verified), `DeviceDetailView.module.css:1-3` `.main` keeps only `max-width: 720px`, `admin/users/page.tsx` `<main>` has no inline padding. `/signin` is exempt and untouched. `styles/literals.test.ts` "shell-owned content inset" describe block scans all of `app/**` except `app/signin/**` for inline/module page-root padding and passes. |

## Test results

- `frontend`: `npx vitest run --maxWorkers=2` (Node v22.12.0 via nvm) → **14 files, 141 tests, all pass**.
- `frontend`: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npx next build` (Node v22.12.0) → compiled successfully, TypeScript passed, all 6 routes generated (`/`, `/admin/users`, `/devices`, `/devices/[deviceId]`, `/signin`, `/_not-found`).
- Repo root: `npx vitest run` → 244 tests pass; `backend/liveView.test.ts` and `backend/telemetry.test.ts` fail to load (`Cannot find module './testUtils'`) — pre-existing, unrelated to this feature (no backend file touched by this diff), matches the builder's verification log.
- Manual grep sweeps performed independently by this review (not just relying on the project's own scanners):
  - Unicode status-glyph scan (Python, same code-point ranges as the plan) over all non-test `.ts`/`.tsx` in `app/`, `components/`, `lib/` → 0 matches.
  - Ad hoc badge/pill markup (`function \wBadge`, `const \wBadge =`, CSS classes matching `/badge|pill/i`) → 0 matches outside `StatusBadge.{tsx,module.css}`.
  - Page-root padding literals in `app/**/*.tsx` and `*.module.css` → only non-page-root, element-level padding found (form/fieldset), consistent with R14 scope.
  - Raw `box-shadow`/`z-index`/transition-duration literals → 0 matches outside `tokens.css`.
  - `lucide-react` imports → only `components/StatusBadge.tsx`.
  - Status color tokens (`--color-success/warning/danger/neutral/decommissioned[-bg]`) outside `StatusBadge.module.css` → only the documented allowlist (stale card tint, inline error-message text).
- `git status` reviewed for stray files outside `frontend/`: only `specs/design-system/*.md` and `package-lock.json` (workspace lockfile, expected for the new `lucide-react` dependency) are modified outside `frontend/`. No unexpected files from local Convex codegen leaked into the tracked tree (`backend/_generated/`, `.convex/` are gitignored).

## Issues

None blocking, should-fix, or nice-to-have identified in this round.

## Not covered

- **R8** (1024px+ viewport correctness) and the R10/R11/R12 *manual* checks (elevation screenshot with borders disabled, hover/press/tab recording, reduced-motion OS toggle, VoiceOver label announcement) remain manual-only — not exercisable in this text-only review environment or in jsdom. The static/automated proxies for these (CSS `min-width`, `interaction.test.ts`, the literal scans, `StatusBadge.test.tsx`'s aria-hidden + label assertions) all pass, and the code structurally satisfies each acceptance criterion (single shared duration/easing tokens, real focusable buttons, aria-hidden icons with visible text), but a human/browser pass is still recommended before shipping to end users, consistent with the plan's own "Manual checks" section.

## Summary for the requesting agent

Round 3 verdict: **PASS**. This closes the review loop (1 round needed at this stage; 2 rounds total
across the whole R1-R14 arc, since R1-R9 passed at round 2 and R10-R14 passed on their first review
pass here). No message sent to builder/planner/spec-writer — no defects found.

Remaining manual-only checks (not blocking, browser-only): R8 at 1024/1440px, R10 elevation
screenshot with borders suppressed, R11 hover/press/tab recording, R11 OS-level reduced-motion
toggle, R12 VoiceOver/screen-reader label read-through.
