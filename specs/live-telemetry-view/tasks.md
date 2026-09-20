# Tasks: Live telemetry view

> Written by builder. Ordered by dependency (setup → core → edge cases → tests).
> Every requirement in spec.md must be covered by at least one task.
> Mark `- [x]` only when its tests pass.

> **R8 note for the reviewer:** `auth-roles` (specs/auth-roles/) has not shipped —
> `backend/lib/auth.ts` here is the thin `ctx.auth.getUserIdentity()` stand-in
> plan.md's "Risks & unknowns" explicitly calls for in that situation, not the
> full role-resolving `requireAuth`. Every `liveView.*` query is guarded by it
> and denies an unauthenticated caller (tested in T1/T5/T6/T7), but there is no
> real sign-in flow yet to verify end-to-end, and route-level gating (the other
> half of R8) is auth-roles' scope, not built here. Per plan.md, please mark R8
> **blocked**, not met, until auth-roles lands.

## Setup

- [x] **T1** — Backend auth guard stub (`requireAuth`), ahead of `auth-roles` landing
  - Files: `backend/lib/auth.ts`
  - Satisfies: R8
  - Acceptance: `requireAuth(ctx)` throws when `ctx.auth.getUserIdentity()` is `null`,
    resolves when an identity is present. Verified by `backend/lib/auth.test.ts`
    (via `convex-test`, `t.query`/`t.withIdentity`).

- [x] **T2** — Key-metric config
  - Files: `backend/lib/keyMetrics.ts`
  - Satisfies: R2, R3
  - Acceptance: `keyMetricsForType` returns the simulator's 3 metrics for
    `cnc-mill`/`agv`/`robot-arm`, falls back to `DEFAULT_KEY_METRICS` for an
    unknown type, and never returns more than 4 entries. Unit-tested in
    `backend/lib/keyMetrics.test.ts`.

- [x] **T3** — Staleness/freshness config (server-side threshold resolution)
  - Files: `backend/lib/freshness.ts`
  - Satisfies: R6
  - Acceptance: `expectedIntervalMsFor(device)` returns the type default
    (10 000 ms), a valid `metadata.expectedIntervalMs` override, and falls back
    to the type default for an unparseable/`<= 0` override. Unit-tested in
    `backend/lib/freshness.test.ts`.

## Core (backend)

- [x] **T4** — Shared "latest reading" helpers, reused by existing `telemetry.latestForDevice`
  - Files: `backend/lib/latestMetrics.ts`, `backend/telemetry.ts`
  - Satisfies: R2, R3 (supporting refactor — no requirement changes behavior of
    `telemetry.latestForDevice`, which stays as specified in plan.md)
  - Acceptance: `latestByMetric` (pure reduce-to-latest-per-metric) unit-tested
    in `backend/lib/latestMetrics.test.ts`; `resolveLatestMetrics` (exact
    per-metric `by_device_metric_and_ts` `.take(1)`, parallel) integration-tested
    via `convex-test`; `telemetry.latestForDevice` still returns one row per
    metric, newest first, verified in `backend/telemetry.test.ts`.

- [x] **T5** — `liveView.overview` query
  - Files: `backend/liveView.ts`
  - Satisfies: R1, R2, R6, R7 (server side: returns the fields the client
    filters/groups on and the resolved `expectedIntervalMs`), R8
  - Acceptance: `backend/liveView.test.ts` — authenticated call returns every
    active device's `status`/`lastSeenAt` verbatim and `keyMetrics` matching
    seeded latest readings (missing metric → `value: null`, not a placeholder
    string); decommissioned (`isActive: false`) devices excluded; unauthenticated
    call throws.

- [x] **T6** — `liveView.deviceSnapshot` query
  - Files: `backend/liveView.ts`
  - Satisfies: R3, R6, R8
  - Acceptance: `backend/liveView.test.ts` — returns the union of configured
    key metrics and metrics discovered in the device's recent telemetry, each
    resolved exactly; a decommissioned device is still returned (not null),
    flagged `isActive: false`; a nonexistent `deviceId` returns `null`;
    unauthenticated call throws.

- [x] **T7** — `liveView.recentEvents` query
  - Files: `backend/liveView.ts`
  - Satisfies: R4, R8
  - Acceptance: `backend/liveView.test.ts` — returns telemetry rows newest-first
    bounded by `limit` (default 50, capped 200); asserts the function's only
    `ctx.db.query` call targets `"telemetry"` (no `alerts`/`alertRules` read);
    unauthenticated call throws.

## Core (frontend)

- [x] **T8** — Shared 1s clock
  - Files: `frontend/lib/useNow.ts`
  - Satisfies: R6 (drives staleness without a data write); supports R5 by
    keeping the "time passing" channel independent of the data-subscription
    channel
  - Acceptance: `frontend/lib/useNow.test.tsx` — a component using `useNow()`
    re-renders with an updated timestamp after fake timers advance 1s; two
    components mounted at once share the same tick (same value at the same
    instant).

- [x] **T9** — Client-side freshness classifier
  - Files: `frontend/lib/freshness.ts`
  - Satisfies: R6
  - Acceptance: `frontend/lib/freshness.test.ts` — `"never"` when `lastSeenAt`
    is undefined; `"live"` at exactly the threshold; `"stale"` just past it.

- [x] **T10** — Overview screen: `DeviceCard`, stale badge, filter/group
  - Files: `frontend/components/DeviceCard.tsx`, `DeviceCard.module.css`,
    `frontend/components/FilterBar.tsx`, `FilterBar.module.css`,
    `frontend/components/DeviceGrid.tsx`, `DeviceGrid.module.css`,
    `frontend/app/page.tsx`
  - Satisfies: R1, R2, R5, R6, R7
  - Acceptance: `frontend/components/DeviceCard.test.tsx` — a live device
    renders no "Stale" text; a device past its `expectedIntervalMs` renders a
    "Stale" text badge (never colour-only) and status/last-seen values still
    match the input verbatim (R1). `frontend/components/FilterBar.test.tsx` —
    selecting a zone/type/status calls the change handler with just that
    field updated; clearing restores "all". `page.tsx` wires
    `useQuery(api.liveView.overview)` with no `setInterval`/manual refresh
    (R5 — code-reviewable, no polling call in the file).

- [x] **T11** — Device detail route: header, `MetricTable`, `EventLog`
  - Files: `frontend/app/devices/[deviceId]/page.tsx`,
    `frontend/app/devices/[deviceId]/DeviceDetailView.tsx`,
    `frontend/app/devices/[deviceId]/DeviceDetailView.module.css`,
    `frontend/components/MetricTable.tsx`, `MetricTable.module.css`,
    `frontend/components/EventLog.tsx`, `EventLog.module.css`
  - Satisfies: R3, R4, R5, R6
  - Acceptance: `frontend/components/MetricTable.test.tsx` — renders every
    metric passed in, including a `value: null` one as "—".
    `frontend/components/EventLog.test.tsx` — renders every entry passed in
    (reading rows only — the component's props type has no alert fields, so
    there is nothing to leak) plus a synthesized gap marker when two entries
    are further apart than the passed-in threshold. `page.tsx` awaits
    `props.params` (Next 16 async params) before rendering the client child.
    `frontend/app/devices/[deviceId]/DeviceDetailView.test.tsx` — loading /
    not-found / live / stale-badge states, with `convex/react`'s `useQuery`
    mocked per-query via `getFunctionName`.

## Edge cases

- [x] **T12** — Decommissioned device reached by direct link
  - Files: `frontend/app/devices/[deviceId]/DeviceDetailView.tsx`
  - Satisfies: R3 (edge case named in plan.md's Data model section)
  - Acceptance: covered by `DeviceDetailView` rendering `device.isActive === false`
    as a "Decommissioned" label instead of hiding/erroring; exercised in
    `frontend/app/devices/[deviceId]/DeviceDetailView.test.tsx`.

## Tests / final sweep

- [x] **T13** — Full test run + typecheck sweep
  - Files: none (verification only)
  - Satisfies: all of R1–R8 (coverage check)
  - Acceptance: `npm run test` (root, backend) and `npm run test` (frontend)
    both green; requirement-coverage table below cross-checked against actual
    test names.

## Requirement → task cross-check

| Req | Tasks |
|---|---|
| R1 | T5, T10 |
| R2 | T2, T4, T5 |
| R3 | T2, T6, T11, T12 |
| R4 | T7, T11 |
| R5 | T8, T10, T11 |
| R6 | T3, T8, T9, T10, T11 |
| R7 | T5, T10 |
| R8 | T1, T5, T6, T7 |

## Deviations from plan

> Builder fills this in immediately when implementation departs from plan.md —
> not after the fact, not only when reviewer asks. Empty section = zero deviations.

- **Deviation:** Hand-wrote `backend/_generated/{dataModel.d.ts,server.ts,api.ts}`
  locally instead of generating them with `npx convex dev`/`npx convex codegen`.
  - **Plan said:** nothing explicit — plan.md assumes a normal dev environment
    where `npx convex dev` produces `backend/_generated/` (gitignored, per
    `README.md` and `.gitignore`).
  - **Did instead:** `npx convex codegen` (and `npx convex dev`) refuses to run
    without a configured deployment, and configuring one requires reaching
    `api.convex.dev`, which this sandbox's egress policy blocks (confirmed:
    `connect_rejected` from the agent proxy). Both `plan.md`'s own "Risks &
    unknowns" (Convex docs unreachable) and `specs/auth-roles/plan.md`'s "Test
    execution environment" risk already flag this class of limitation. Rather
    than leave the feature untested, I reproduced the exact shape Convex's own
    codegen templates produce — copied from `node_modules/convex/dist/esm/cli/codegen_templates/{server,api}.js` and the standard `dataModel.d.ts` pattern —
    by hand into `backend/_generated/`. These files are `.gitignore`d
    (`backend/_generated/`), so nothing about the committed repo changes; a
    real `npx convex dev` run in an environment with network access overwrites
    them identically. This unblocked real `convex-test` integration tests
    (`backend/liveView.test.ts`, `backend/telemetry.test.ts`, etc.) instead of
    only testing pure helper functions.
  - **Why:** Testing nothing beyond pure functions would leave R1, R3, R4, R7,
    R8 (all of which live in actual Convex query handlers) with zero automated
    coverage. This gets real coverage without touching what gets committed.

- **Deviation:** Added `vitest`, `convex-test`, `@edge-runtime/vm` (root) and
  `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`
  (frontend) as new dev dependencies.
  - **Plan said:** "No new tech" (plan.md decision #1) — but that line is about
    product dependencies (charting/state/CSS libs), not test tooling; plan.md's
    "Tech decisions" table doesn't name a test framework for this feature, and
    the repo had none at all before this feature.
  - **Did instead:** Added the same combination `specs/auth-roles/plan.md`
    already independently chose for backend Convex-function testing
    (`convex-test` + `vitest`), plus `@testing-library/react`/`jsdom` on the
    frontend side for the two components (`DeviceCard`, and staleness
    generally) whose correctness the spec explicitly ties to a rendered-text
    assertion (R6's acceptance criterion).
  - **Why:** Consistency with the only other precedent in the repo (auth-roles'
    plan), and there was no existing test setup to match instead.

- **Deviation:** `liveView.overview`'s `keyMetrics` and `liveView.deviceSnapshot`'s
  `metrics` return `{ metric, value: null, ts: null }` for a configured/expected
  metric that has never reported, instead of omitting it.
  - **Plan said:** plan.md's "Requirement coverage" row for R2 says "a metric
    with no reading renders as '—', distinguishable from a zero" — implying the
    row is still present to render as "—".
  - **Did instead:** Made this explicit in the return shape (`value: null`)
    rather than leaving the client to infer absence from a shorter array.
  - **Why:** Not a behavior change from what plan.md describes, just makes the
    "missing vs. zero" distinction structural instead of implicit, which is
    easier to test and reviewer-verify.

- **Deviation:** No standalone `DeviceHeader` component. The device
  name/type/zone/status/last-seen/stale-badge markup for the detail view is
  inline in `frontend/app/devices/[deviceId]/DeviceDetailView.tsx` instead.
  - **Plan said:** plan.md's "Architecture" diagram lists `DeviceHeader` as a
    child of the detail route, alongside `MetricTable` and `EventLog`.
  - **Did instead:** Kept that markup inline in `DeviceDetailView` rather than
    extracting a third leaf component.
  - **Why:** It's a handful of lines with no reuse elsewhere (unlike
    `MetricTable`/`EventLog`, which are meaningfully reusable/independently
    testable units), so a separate file/test would be indirection without
    payoff. `MetricTable` and `EventLog` — the two pieces plan.md's own R3/R4
    coverage rows actually hang requirements on — are real, separately tested
    components as planned.
