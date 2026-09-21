# Review: Device registry

> Written by reviewer. Round 2 (round 1 issues resolved).

## Verdict

**PASS**

All 31 requirements have a concrete implementation with evidence, and every
Should-fix issue from round 1 has been resolved and independently re-verified.
`npm test` now runs 5 files / 61 tests, all passing; `tsc --noEmit` for both
`backend` and `frontend` is clean. The only requirements not verified
end-to-end (the live-browser/subscription half of R3/R6/R10, and the
R16/R17/R31 real signed-in-session demonstration) are pre-disclosed,
architecturally-sound gaps that spec.md's own "Verification note" and
plan.md's "Auth seam" section already flag as expected on this branch (no
`auth-roles` sign-in flow exists here) — treated as "not verifiable here," not
a failure, per my review instructions.

### Round 2 changes (verified)

1. **R17 enumeration gap — fixed.** `tests/deviceApiSurface.test.ts` (new, 7
   tests) structurally scans `backend/devices.ts`'s exported surface and fails
   if any export isn't classified as a public read, an admin-gated
   mutation/query verified to call `requireAdmin(ctx)`, or internal-only. A
   self-check test proves the scanner actually catches an unclassified
   addition (adds a fake `wipeEverything` export and asserts it's flagged).
   `tests/devices.test.ts`'s hand-written `REGISTRY_MUTATIONS` is now
   cross-checked against the same `ADMIN_GATED_MUTATIONS` list
   (`tests/testUtils.ts`), which is also what the scanner enforces — so the
   original gap (a new mutation could be added to `devices.ts` and forgotten
   in the test array with nothing failing) is closed at both ends. I read the
   new test file in full and confirmed the self-check actually exercises the
   failure path rather than trivially passing.
2. **Dead indexes — fixed.** `backend/devices.ts` now has a shared
   `selectDeviceSource` helper that index-narrows on whichever single filter
   is most selective (`status` → `by_lifecycle_status_lastSeenAt`, else `zone`
   → `by_lifecycle_and_zone`, else `type` → `by_lifecycle_and_type`), used by
   `devices.list`. Both previously-dead indexes are now genuinely read. New
   tests confirm the zone-only and type-only paths return correct results.
   `devices.facets` deliberately does **not** use this helper — the builder
   caught a real correctness bug while first attempting to wire it up the same
   way (pre-narrowing the shared 3-tally base scan by an active filter would
   silently drop every other value of that same dimension from its own
   facet, breaking R9's "no hard-coded list" guarantee across filter
   combinations) — and recorded this as a new, well-reasoned deviation in
   tasks.md rather than shipping the bug or the naive fix. I verified this
   reasoning is sound by tracing `facets`'s `tally`/`matches` functions myself:
   each tally already excludes its own dimension from the filter predicate, so
   a shared scan narrowed to one zone would indeed make every *other* zone's
   count silently vanish. Leaving `facets` on the lifecycle-only scan is the
   correct call, not a shortcut.

Neither fix introduced regressions: I re-ran the full suite and both
typechecks myself (see Test results) rather than trusting the builder's
report.

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met | `backend/schema.ts:11-16` (`status` union + optional `lastSeenAt`); `tests/devices.test.ts` "three fixtures report online, offline (after sweep), and unknown respectively" |
| R2 | Met | `backend/devices.ts` `recomputeStatus`; `backend/ingest.ts:60-63` sets `online`+`lastSeenAt`; `tests/ingest.test.ts` "telemetry for an in-service device is recorded and flips it online (R2)" |
| R3 | Met (function level); live-subscription half not verifiable here | `backend/devices.ts` `sweepOffline` (internalMutation); `backend/crons.ts:13` 15s interval; `tests/devices.test.ts` "a device transitions online -> offline with no further telemetry once the sweeper runs (R3)" proves the write-not-time-elapse invariant. Held-subscription-across-real-websocket behavior cannot be exercised by `convex-test` (documented in tasks.md "Not fully covered"); architecture (write-only state changes invalidate subscriptions) is sound and matches Convex's documented model. |
| R4 | Met | `backend/lib/config.ts` `heartbeatWindowMs()` env-backed; `tests/config.test.ts` "heartbeat window is overridable without a code change"; `tests/devices.test.ts` "the heartbeat window is configurable without a code change (R4)" |
| R5 | Met | Single stored `status` field read by `list`/`get`/`facets`, no read-time derivation (`backend/devices.ts`); `tests/devices.test.ts` "list, detail and a status=offline filter agree on the same device at the same moment (R5)" |
| R6 | Met architecturally; live client-push not verifiable here | Every writer that changes connectivity (`ingest.recordBatch`, `sweepOffline`, `reactivate`) patches the document, which is what invalidates a real Convex subscription — no code path derives status at read time. `convex-test` cannot hold an open subscription (documented gap, not a defect); manual verification steps are given in tasks.md. |
| R7 | Met | `backend/devices.ts` `selectDeviceSource` + `list` combine `zone`/`type`/`status` with AND; `tests/devices.test.ts` "filters on zone and status combine with AND (R7)", plus new "filtering by zone alone... uses by_lifecycle_and_zone" and "filtering by type alone... uses by_lifecycle_and_type" |
| R8 | Met | `backend/devices.ts` `facets` tallies under the active filter; `tests/devices.test.ts` "facets group by zone/type/status with counts that respect the active filter (R8)" |
| R9 | Met | `facets` derives choices from `scanned` rows, no hard-coded list, and each tally excludes its own dimension so every value stays offered even while that dimension is filtered; `tests/devices.test.ts` "a newly used zone/type becomes a filter choice with no code change (R9)" |
| R10 | Met (function level); live-subscription half not verifiable here | `tests/devices.test.ts` "a device that crosses the heartbeat window leaves a status=online filtered list (R10)" re-queries after the sweeper runs and confirms the device is gone; reactive-client behavior is the same "write invalidates subscription" argument as R6. |
| R11 | Met | `backend/devices.ts` server-side clamp to `deviceListPageSize()*4`; `.paginate()` cursor semantics; `tests/devices.test.ts` "a page-size request far beyond the configured default is clamped server-side (R11)" and "listing returns a bounded page and the remainder is reachable by cursor, without duplicates or omissions (R11)" |
| R12 | Met | `backend/devices.ts` `register`; `frontend/app/devices/DeviceForm.tsx` + `DevicesView.tsx` wire the form to the mutation (code-reviewed, no component-test harness in repo); `tests/devices.test.ts` "an admin registers a device and it appears in the list with the supplied values" |
| R13 | Met | `backend/devices.ts` `update`; `DeviceDetail.tsx` edit form wiring; `tests/devices.test.ts` "edits name, type, zone and metadata; detail reflects the new values" |
| R14 | Met | `backend/devices.ts` `decommission`/`reactivate`; `DeviceDetail.tsx` confirm-style UI buttons; `tests/devices.test.ts` "decommission then reactivate preserves identifier/name/type/zone/metadata..." |
| R15 | Met | `backend/lib/validation.ts` collects multiple field errors; `DeviceForm.tsx` maps `ConvexError({fieldErrors})` to per-field messages; `tests/devices.test.ts` "a blank name AND a duplicate identifier in the same submit report both fields (R15)" |
| R16 | Partial (matches spec's own documented verification-level caveat) | `access.currentActor` (`backend/lib/access.ts`) drives `isAdmin` gating of every admin control in `DevicesView.tsx`/`DeviceDetail.tsx` (code-reviewed: register button, edit/decommission/reactivate buttons, history tab all conditioned on `isAdmin`). No real viewer/operator/maintenance browser session exists on this branch to demonstrate end-to-end, exactly as spec.md's "Verification note — R16, R17, R31" anticipates. |
| R17 | Met | `requireAdmin` is the first line of `register`/`update`/`decommission`/`reactivate` (`backend/devices.ts`); `tests/devices.test.ts` "admin gating (R17, R31)" proves the full allow/deny matrix with `DEVICE_REGISTRY_REQUIRE_ADMIN=true`. **Round 1 gap closed**: `tests/deviceApiSurface.test.ts` now structurally enumerates every export in `devices.ts` and fails on anything unclassified (self-check included), and `tests/devices.test.ts`'s `REGISTRY_MUTATIONS` is cross-checked against the same shared list, so a newly added mutation can no longer be silently forgotten by either test. (End-to-end real-session verification remains the same pre-disclosed gap as R16/R31.) |
| R18 | Met | `backend/lib/validation.ts` `validateRequiredTrimmed`; `tests/validation.test.ts` + `tests/devices.test.ts` "empty, whitespace-only, or missing externalId/name/type is refused..." |
| R19 | Met | `backend/devices.ts` uniqueness check spans all lifecycle states via `by_externalIdKey`; `tests/devices.test.ts` "registering an identifier held by a decommissioned device is also refused" |
| R20 | Met | `backend/lib/validation.ts` `normalizeExternalIdKey` (trim+lowercase), used identically in `devices.register` and `ingest.recordBatch`; `tests/validation.test.ts`, `tests/devices.test.ts` "two identifiers differing only by trim/case cannot both be registered (R20)", `tests/ingest.test.ts` "a differently-cased/whitespace externalId still resolves..." |
| R21 | Met | `devices.update`'s args validator omits `externalId` — Convex rejects undeclared args before the handler runs; `tests/devices.test.ts` "no edit path changes externalId — supplying one is rejected before the handler runs (R21)" |
| R22 | Met | `backend/lib/validation.ts` `validateMetadataInto` against `backend/lib/config.ts` bounds; `tests/validation.test.ts`, `tests/devices.test.ts` "too many entries is refused..." and "an over-length key or value is refused; existing metadata on a failed edit is unchanged" |
| R23 | Met | Validation lives in `backend/lib/validation.ts`, called directly by `register`/`update` — all tests call the mutations directly (not through any UI), proving server-side enforcement independent of entry point |
| R24 | Met | `decommission`/`reactivate` only patch lifecycle fields; `telemetry`/`alerts` rows untouched; `tests/devices.test.ts` "decommission then reactivate preserves identifier/name/type/zone/metadata; telemetry stays queryable" |
| R25 | Met | `devices.list` defaults to `lifecycle="in_service"` via index; `includeDecommissioned` gated by `requireAdmin`; `tests/devices.test.ts` "default list omits decommissioned devices; includeDecommissioned (admin) shows them marked" and "includeDecommissioned is admin-only" |
| R26 | Met | `backend/ingest.ts` aggregates rejections, increments `rejectedReadingCount`/`lastRejectedReadingAt`, `console.warn`s, never resurrects state; `tests/ingest.test.ts` "telemetry for a decommissioned device is refused... (R26)" |
| R27 | Met | No `ctx.db.delete` anywhere in `backend/` (confirmed independently by `grep`, both rounds); `tests/devices.test.ts` and `tests/deviceApiSurface.test.ts` both assert absence via source-text checks |
| R28 | Met | `DeviceDetail.tsx` renders a distinct lifecycle `Badge` separate from (and never substituting for) the connectivity badge; `tests/devices.test.ts` "a decommissioned device with stale telemetry reports lifecycle distinctly from connectivity (R28)" |
| R29 | Met | `backend/lib/audit.ts` `recordAudit`/`diffFields`; `tests/devices.test.ts` "a successful edit records one entry with the acting admin, both field changes, and old/new values" |
| R30 | Met | Audit insert happens inside the same mutation as the patch, after validation; `tests/devices.test.ts` "a change that fails validation produces no history entry; every successful change has exactly one" |
| R31 | Met (function level; same pre-disclosed e2e caveat as R16) | `backend/devices.ts` `changeHistory` gated by `requireAdmin`, now also covered by `tests/deviceApiSurface.test.ts`'s enumeration; `DeviceDetail.tsx` only queries it when `isAdmin` (else `"skip"`); `tests/devices.test.ts` "devices.changeHistory is refused for non-admins and succeeds for admin (R31)" |

## Test results

- `npm test` (from `D:/Self/wavelink`), re-run by me after round 2 fixes: **5 files, 61 tests, all pass** (`tests/config.test.ts` 4, `tests/deviceApiSurface.test.ts` 7, `tests/validation.test.ts` 10, `tests/ingest.test.ts` 4, `tests/devices.test.ts` 36).
- `npx tsc --noEmit -p backend/tsconfig.json`: clean (re-run by me).
- `npx tsc --noEmit -p frontend/tsconfig.json`: clean (re-run by me).
- No lint script exists in `package.json` to run.
- Independently verified (not just re-reading the builder's claims), both rounds:
  - `grep -r "ctx.db.delete" backend/` → no matches (R27).
  - Read `tests/deviceApiSurface.test.ts` in full: the classification lists (`PUBLIC_UNGATED_READS`, `INTERNAL_ONLY`, and the shared `ADMIN_GATED_*` from `testUtils.ts`) together account for exactly the 10 exports actually in `backend/devices.ts` (`list`, `get`, `facets`, `changeHistory`, `register`, `update`, `decommission`, `reactivate`, `sweepOffline`, `backfillLifecycle`) — nothing is missing or double-counted. The scanner's self-check test genuinely exercises the failure path (injects a fake export and asserts it's caught).
  - Read `backend/devices.ts`'s `selectDeviceSource` and confirmed it is now used by `list` and does select `by_lifecycle_and_zone`/`by_lifecycle_and_type` when those are the sole active filter; confirmed `facets` intentionally does not use it, and traced its `tally`/`matches` logic to confirm the builder's stated reason (index-narrowing the shared scan would corrupt cross-filter facet counts) is correct.
  - `docker-compose.yml`'s `backend` service environment block only forwards a fixed set of vars, confirming the round-1 `.env.example` deviation is accurate (carried over from round 1, still holds).

## Issues

### Blocking
None.

### Should-fix
None remaining — both round-1 items are resolved (see "Round 2 changes" above).

### Nice-to-have

1. The sweeper's page-full reschedule branch (`backend/devices.ts`, `page.length === SWEEP_PAGE_SIZE`) remains untested, as disclosed in tasks.md's "Not fully covered". Constructing 500+ stale devices in a unit test is expensive but not impossible; worth adding if the sweeper is ever touched again. Not blocking.
2. `DeviceForm.tsx` disables the external-identifier input in edit mode for UX (R21 is enforced server-side regardless); this is fine since the real boundary is server-side and tested, just noting the UI treatment is decorative by design.

## Not covered

- **R3/R6/R10 (live, held-subscription behavior)** — no test opens a real Convex websocket subscription across the heartbeat window; `convex-test` re-executes queries rather than pushing to an open subscription. Disclosed in both plan.md ("Risks & unknowns" → "Test execution is local") and tasks.md ("Not fully covered"), not a code defect. Treated as "not verifiable here," not a failure, per my review instructions.
- **R16/R17/R31 true end-to-end in a signed-in browser session** — no sign-in flow exists on this branch (by design; `auth-roles` is a separate, unmerged feature). Explicitly called out in spec.md's own "Verification note — R16, R17, R31 on this branch" as "a known gap, not a satisfied criterion," to be re-verified when `auth-roles` merges and `DEVICE_REGISTRY_REQUIRE_ADMIN` flips to strict. Pre-declared, correctly disclosed, not a reviewer-found gap.

## Notes on deviations recorded in tasks.md

All four deviations were checked against their stated rationale and found accurate and non-security-weakening:

1. `.env.example` documents device-registry env vars as a comment block rather than `KEY=value` lines, because `docker-compose.yml` genuinely does not forward arbitrary env vars into the backend container (confirmed by reading `docker-compose.yml` directly). Correctly reasoned, no requirement or non-goal violated.
2. `DEVICE_LIST_PAGE_SIZE` is enforced as a server-side clamp (`min(requested, default*4)`) rather than a literal page size, because Convex's `PaginationOptions.numItems` is client-supplied and required. Verified by test and by reading `backend/devices.ts`. No requirement violated.
3. The hand-corrected `backend/_generated/api.d.ts`/`backend/tsconfig.json` deviation is a sandbox/tooling limitation (no linked Convex deployment to run real codegen), clearly flagged with a recommendation to run real `npx convex dev` codegen before deploying; `backend/_generated/` is gitignored so nothing incorrect is being committed as source of truth. Acceptable.
4. **(New, round 2)** `devices.facets` deliberately does not use the same index-narrowing helper as `devices.list`, departing from a literal reading of plan.md's Data model table. Verified this is the *correct* choice, not a shortcut — see "Round 2 changes" #2 above. Well-reasoned and clearly documented in tasks.md with the exact correctness argument.

The `DEVICE_REGISTRY_REQUIRE_ADMIN` permissive default (the one decision with real security weight) is not a builder deviation — it is a decision made explicitly by the planner and disclosed prominently in spec.md, plan.md, tasks.md, the README (with a `⚠️` warning), and `.env.example`. It does not "silently" violate anything.
