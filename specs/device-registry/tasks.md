# Tasks: Device registry

> Written by builder. Ordered by dependency (setup → core → edge cases → tests).
> Every requirement in spec.md must be covered by at least one task.
> Mark `- [x]` only when its tests pass.

- [x] **T1** — Add test tooling (vitest + convex-test)
  - Files: `package.json`, `vitest.config.ts`, `tests/tsconfig.json`
  - Satisfies: infra (supports verification of all requirements below)
  - Acceptance: `npm test` runs vitest (0 tests is fine at this point) with no config errors — confirmed, then superseded by T6/T8 tests.

- [x] **T2** — Schema: `devices` lifecycle/identity fields + new indexes, `auditLog` table
  - Files: `backend/schema.ts`, `backend/tsconfig.json` (added — did not exist on this branch; needed to typecheck `backend/`)
  - Satisfies: R1, R19, R20, R21, R24, R25, R28, R29
  - Acceptance: `npx tsc --noEmit -p backend/tsconfig.json` passes; convex-test loads the schema in every test in `tests/devices.test.ts`

- [x] **T3** — Deployment config resolver (env-backed, documented defaults)
  - Files: `backend/lib/config.ts`
  - Satisfies: R4, R22, R11, R16, R17, R31 (the `DEVICE_REGISTRY_REQUIRE_ADMIN` flag)
  - Acceptance: `tests/config.test.ts` (4 tests, pass) covers default values and env-var overrides

- [x] **T4** — Local auth seam (`getActor` / `requireAdmin` / `currentActor`)
  - Files: `backend/lib/access.ts`
  - Satisfies: R16, R17, R31
  - Acceptance: admin-gating matrix in `tests/devices.test.ts` (`describe("admin gating (R17, R31)")`, pass)

- [x] **T5** — Shared validation + audit helpers
  - Files: `backend/lib/validation.ts`, `backend/lib/audit.ts`
  - Satisfies: R15, R18, R20, R22, R23, R29, R30
  - Acceptance: `tests/validation.test.ts` (10 tests, pass); exercised end-to-end in `tests/devices.test.ts`

- [x] **T6** — `devices.ts`: list/get/facets/register/update/decommission/reactivate/changeHistory/sweepOffline/backfillLifecycle
  - Files: `backend/devices.ts`
  - Satisfies: R1, R2, R5, R7, R8, R9, R10, R11, R12, R13, R14, R15, R17, R18, R19, R20, R21, R22, R23, R24, R25, R27, R28, R29, R30, R31
  - Acceptance: `tests/devices.test.ts` (36 tests, pass) — registration/uniqueness/validation/lifecycle/listing/facets/audit/admin-gating/no-hard-delete
  - **Round 2 (post-review) fix**: `devices.list` now uses a shared `selectDeviceSource` helper that
    index-narrows on whichever single filter is most selective — `status` → `by_lifecycle_status_lastSeenAt`,
    else `zone` → `by_lifecycle_and_zone`, else `type` → `by_lifecycle_and_type` — so those two indexes
    (previously defined in schema.ts but never read by any query — review.md Should-fix #2) are now
    exercised. `devices.facets` deliberately does **not** use this helper (see the comment above its scan
    in `backend/devices.ts`): a facet must keep offering every value of a dimension as a choice even while
    that dimension's own filter is active (R9), so pre-narrowing the shared 3-tally base scan by any one of
    zone/type/status would silently corrupt exactly that dimension's own tally. `facets` keeps its
    lifecycle-only scan. Added `tests/devices.test.ts` cases exercising the zone-only and type-only index
    paths directly (previously only the zone+status combination, which always took the `status` branch,
    was tested).

- [x] **T7** — `crons.ts`: 15s sweeper registration
  - Files: `backend/crons.ts`
  - Satisfies: R3, R6
  - Acceptance: `tests/devices.test.ts` invokes `internal.devices.sweepOffline` directly with `vi.useFakeTimers()` and asserts the online→offline transition only happens once the sweeper runs (not merely once time has passed) and that the documented bound (window + 15s) holds; `crons.ts` compiles and is imported cleanly by the test module graph (`import.meta.glob("../backend/**/*.*s")`). See "Not fully covered" below for R6's client-reactivity half.

- [x] **T8** — `ingest.ts`: normalized lookup + decommissioned-device rejection accounting
  - Files: `backend/ingest.ts`
  - Satisfies: R2, R20, R26
  - Acceptance: `tests/ingest.test.ts` (4 tests, pass)

- [x] **T9** — Frontend: devices management view (filter bar, grouping, paginated table, admin forms, lifecycle/connectivity badges, history tab) + root redirect
  - Files: `frontend/app/devices/page.tsx`, `frontend/app/devices/DevicesView.tsx`, `frontend/app/devices/DeviceForm.tsx`, `frontend/app/devices/DeviceDetail.tsx`, `frontend/app/page.tsx`
  - Satisfies: R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R28, R31
  - Acceptance: `npx tsc --noEmit -p frontend/tsconfig.json` passes; manual code-review trace of each requirement against `DevicesView.tsx`/`DeviceDetail.tsx`/`DeviceForm.tsx` (no component-test harness in this repo — see plan.md's noted limitation on R16/R17/R31 end-to-end demonstration without a sign-in flow, and "Not fully covered" below)

- [x] **T10** — README: new env vars, permissive-default warning, migration note, normalization note
  - Files: `README.md`, `.env.example`
  - Satisfies: documentation for R4, R20, and the auth-seam risk called out in plan.md

- [x] **T11** — Full verification pass
  - Files: none (verification only)
  - Satisfies: all
  - Acceptance (round 1): `npm test` → 4 files, 51 tests, all pass. `npx tsc --noEmit -p backend/tsconfig.json` clean. `npx tsc --noEmit -p frontend/tsconfig.json` clean.
  - Acceptance (round 2, post-review): `npm test` → 5 files, 61 tests, all pass. Both tsconfigs still clean.

- [x] **T12** — Round 2: fix reviewer's two Should-fix issues (specs/device-registry/review.md)
  - Files: `tests/deviceApiSurface.test.ts` (new), `tests/testUtils.ts`, `tests/devices.test.ts`, `backend/devices.ts`
  - Satisfies: R17, R27 (structural enumeration), R7/R8/R9 (index wiring correctness)
  - Acceptance: `tests/deviceApiSurface.test.ts` (7 tests, pass) structurally scans `backend/devices.ts` and
    fails on any exported mutation/query not classified as a public read, admin-gated (and verified to call
    `requireAdmin`), or internal-only — including a self-check proving the scanner actually catches an
    unclassified addition. `tests/devices.test.ts`'s hand-written `REGISTRY_MUTATIONS` is now cross-checked
    against the same `ADMIN_GATED_MUTATIONS` list the scanner enforces, closing the gap the reviewer found
    (a new mutation could previously be added to `devices.ts` and forgotten in the test's array with nothing
    failing). See T6 above for the index-wiring fix.

## Deviations from plan

> Builder fills this in immediately when implementation departs from plan.md —
> not after the fact, not only when reviewer asks. Empty section = zero deviations.

- **Deviation:** `DEVICE_HEARTBEAT_WINDOW_MS` and the other device-registry config vars are documented
  in `.env.example` as a comment block pointing to `npx convex env set`, not as literal `KEY=value`
  lines consumed by `docker-compose.yml`.
  - **Plan said:** "All of the above belong in `.env.example` and the README env table" (Configuration
    section).
  - **Did instead:** Added the full table (names, defaults, purpose) to README's new "Device registry
    function env vars" section, and a commented pointer to it in `.env.example`, but did not add them as
    active `KEY=value` lines there.
  - **Why:** Verified against `docker-compose.yml`: the `backend` service only forwards a fixed,
    hardcoded set of env vars (`INSTANCE_NAME`, `INSTANCE_SECRET`, the origin URLs, `POSTGRES_URL`,
    `DO_NOT_REQUIRE_SSL`) from `.env` into the container. Convex function code reads `process.env` from
    the deployment's own env store (`npx convex env set` / dashboard), which is unrelated to that file.
    Adding `DEVICE_HEARTBEAT_WINDOW_MS=60000` etc. to `.env.example` as if `docker compose up` would wire
    it through would be actively misleading; the accurate fix keeps the same discoverability goal without
    the false implication.

- **Deviation:** `DEVICE_LIST_PAGE_SIZE` is enforced as a server-side *cap* (`min(requested, default × 4)`
  in `devices.list`) rather than literally being "the page size."
  - **Plan said:** "`DEVICE_LIST_PAGE_SIZE` (50) + cursor navigation" as the mechanism satisfying R11;
    listed as a plain config value in the Configuration table.
  - **Did instead:** Convex's `PaginationOptions.numItems` is required and client-supplied (there is no
    server-side "default" hook in `paginationOptsValidator`/`.paginate()`), so the frontend's
    `usePaginatedQuery` supplies `initialNumItems: 50` (kept in sync with the documented default by
    comment, not by import — the client bundle cannot read a Convex deployment env var directly) while
    the server independently clamps any caller's requested `numItems` to `deviceListPageSize() * 4`, so
    R11's "bounded result set" holds even for a direct, non-UI call that asks for an unbounded page.
  - **Why:** Without the clamp, `DEVICE_LIST_PAGE_SIZE` would be decorative (nothing read it) and a
    direct API call could still request an unbounded page, which is exactly what R11 rules out.

- **Deviation:** `backend/_generated/api.d.ts` and `backend/tsconfig.json` were hand-written/corrected
  rather than produced by `npx convex dev` / `npx convex codegen`.
  - **Plan said:** Nothing explicit (generated files are normally not a plan concern), but implicitly
    assumes the standard `npx convex dev` codegen loop is available.
  - **Did instead:** This sandbox has no linked Convex project/login (`npx convex codegen` fails with "No
    CONVEX_DEPLOYMENT set"), so `backend/_generated/api.d.ts` was hand-edited to match this branch's
    actual `backend/*.ts` module list, and `backend/tsconfig.json` (absent on this branch) was added
    following the same shape used on `implement-roles-auth`. Note `backend/_generated/` is gitignored, so
    this is a local, regenerable artifact, not something being committed as source of truth.
  - **Why:** Before this change, `backend/_generated/api.d.ts` already referenced modules that do not
    exist on this branch at all (`audit.ts`, `auth.ts`, `authz.ts`, `lib/permissions.ts`, etc. — likely
    left over from a codegen run against a different branch checkout), which would have failed
    `tsc --noEmit` regardless of this feature. **Anyone picking up this repo should run `npx convex dev`
    once against a real deployment to regenerate `backend/_generated/` for real** before relying on it
    beyond local typecheck/test.

- **Deviation:** `devices.facets` does not use the same index-narrowing helper as `devices.list`, even
  though both are index-eligible on the same fields.
  - **Plan said:** plan.md's Data model table lists `by_lifecycle_and_zone`/`by_lifecycle_and_type` as
    serving "zone= filter, zone grouping" / "type= filter, type grouping" — read literally, this implies
    `facets` (which is what produces grouping counts, R8) should use them too.
  - **Did instead:** Only `devices.list` uses them. `devices.facets` computes three tallies (zones, types,
    statuses) from one shared base scan, and each tally must exclude its *own* dimension's filter (a zone
    facet must still list every zone as a choice even while a zone filter is active — that's what makes R9
    work). If the shared base scan were pre-narrowed by, say, `zone=selectedZone` (because a zone filter
    happened to be active), the zone tally would only ever see that one zone and every other zone would
    silently disappear from the facet list. Caught this in my own first attempt at wiring `facets` up the
    same way as `list` (review.md's Should-fix #2) before shipping it, so `facets` keeps its lifecycle-only
    scan; see the comment above it in `backend/devices.ts` for the full reasoning.
  - **Why:** Correctness (R9's "no hard-coded list" of choices, kept live across every combination of
    active filters) over literal adherence to the plan's data-model table wording, which didn't anticipate
    this interaction. No requirement is weakened — `list` still uses both indexes for their stated
    "filter" purpose; only the "grouping" half of that table row doesn't apply to `facets` for the reason
    above.

## Not fully covered (see plan.md's own "Risks & unknowns" for why)

- **R6 (client push, no manual refresh)** and the live-websocket half of **R3/R10**: `convex-test` runs
  functions directly and re-executes each `t.query(...)` call fresh — it does not simulate a held
  browser subscription receiving a server-pushed update. The tests prove the underlying invariant that
  makes R6 true (state lives in a *written* field — `ingest`/`sweepOffline`/`reactivate` all patch the
  document — so a real Convex subscription *will* be invalidated and re-pushed), and prove the sweeper
  performs the flip only when it runs (not merely once time has elapsed), but do not exercise an actual
  open subscription across the heartbeat window. This matches plan.md's own "Test execution is local"
  risk note. Manual verification: run `npm run dev`, open the dashboard, stop the simulator for a device,
  and watch its badge flip after ~window+15s with the tab left open.
- **R16/R17/R31 end-to-end in the running app**: as plan.md's Auth seam section flags, this branch has no
  sign-in flow, so "in a viewer session, no control is rendered" and "a non-admin session's call is
  refused" are demonstrated at the function-test level (`tests/devices.test.ts` admin-gating matrix, run
  with `DEVICE_REGISTRY_REQUIRE_ADMIN=true`) and by code review of `DevicesView`/`DeviceDetail`'s
  `isAdmin` gating, not by an actual multi-role browser session.
- **Sweeper re-schedule on a full page** (`sweepOffline`'s `page.length === 500` branch in
  `backend/devices.ts`): not exercised by a test — constructing 500+ devices past the cutoff in a unit
  test wasn't judged worth the runtime cost. Verified by code review only.
