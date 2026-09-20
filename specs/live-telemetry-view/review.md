# Review: Live telemetry view

> Written by reviewer. Independent verification against spec.md. No source edits.

## Verdict

**PASS WITH ISSUES**

R1–R7 are fully and verifiably implemented, each backed by passing tests I ran myself
(not just tasks.md checkmarks). R8 is correctly implemented as a thin, deny-by-default
auth guard on every query, and — per plan.md's explicit, dated decision (2026-09-20) to
build this feature ahead of `auth-roles` — is rightly reported as **Blocked**, not
`Met` or `Missing`. That is a documented cross-feature dependency, not a builder defect,
so it does not block this verdict on its own. The "issues" below are Should-fix/
Nice-to-have items that don't affect correctness of R1–R7; there are no Blocking issues.

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met | `backend/liveView.ts:31-63` (`overview` returns `status`/`lastSeenAt` verbatim from the stored device doc, active devices only). Test: `backend/liveView.test.ts:42-79` ("shows status/lastSeenAt verbatim… (R1, R2)"), `:81-88` ("excludes decommissioned devices (R1)"). Frontend: `frontend/components/DeviceCard.tsx:39-59` renders both fields unmodified; `frontend/components/DeviceCard.test.tsx:21-27` asserts verbatim status text. |
| R2 | Met | `backend/lib/keyMetrics.ts` (per-type config, ≤4 metrics) + `backend/lib/latestMetrics.ts:22-44` (`resolveLatestMetrics`, exact `by_device_metric_and_ts` desc `.take(1)` per metric, parallel — not a sampled/stale scan). Test: `backend/liveView.test.ts:42-79` asserts the exact latest value (47, not the older 41) and that a never-reported metric is `null` not omitted. Frontend: `DeviceCard.tsx:60-69` renders `—` for `null`; `DeviceCard.test.tsx:36-39`. |
| R3 | Met | Route `frontend/app/devices/[deviceId]/page.tsx` → `DeviceDetailView.tsx`; `backend/liveView.ts:72-111` (`deviceSnapshot`) returns the union of configured + discovered metrics, each resolved exactly, and still returns a decommissioned device rather than 404ing. Test: `backend/liveView.test.ts:117-154` (union + decommissioned-device cases); `frontend/app/devices/[deviceId]/DeviceDetailView.test.tsx:44-70,72-96` (renders metrics, labels decommissioned device instead of hiding it). |
| R4 | Met | `backend/liveView.ts:119-139` (`recentEvents`) reads only the `telemetry` table via `by_device_and_ts`, touching neither `alerts` nor `alertRules`. Test: `backend/liveView.test.ts:184-199` asserts every returned entry's keys are exactly `["id","metric","ts","value"]` (no alert fields present to leak) and confirmed by grep — no `alerts`/`alertRules` reference anywhere in `backend/liveView.ts` or `frontend/components/EventLog.tsx`. |
| R5 | Met | All three `liveView.*` calls are plain Convex `useQuery` subscriptions (`frontend/app/page.tsx:27`, `DeviceDetailView.tsx:20-21`) — Convex's documented read-set-tracking + WebSocket push is the update mechanism; no `setInterval`/`router.refresh()`/revalidation anywhere in the feature (confirmed by grep across `frontend/app/page.tsx`, `frontend/app/devices/`, `frontend/components/`, `backend/liveView.ts` — zero matches beyond a code comment). Note: this is a code-inspection guarantee resting on Convex's own reactivity contract, not an end-to-end integration test that seeds a write mid-render and observes a UI update without a running Convex dev deployment (see "Not covered"). |
| R6 | Met | `backend/lib/freshness.ts:30-39` resolves the per-device threshold server-side; `frontend/lib/freshness.ts:22-32` (`classifyFreshness`) + `frontend/lib/useNow.ts` (one shared 1s clock via `useSyncExternalStore`) compute staleness purely client-side, consumed identically by `DeviceCard.tsx` (overview) and `DeviceDetailView.tsx:41-64` (detail) — both render a **text** badge ("Stale"/"Never reported"), never colour alone. Test: `backend/lib/freshness.test.ts` (threshold resolution incl. override/invalid-override fallback), `frontend/lib/freshness.test.ts`, `frontend/lib/useNow.test.tsx` (shared-tick + re-render), `DeviceCard.test.tsx:29-34` (renders "Stale" text past threshold). |
| R7 | Met | `frontend/components/FilterBar.tsx` (zone/type/status selects + clear) + `frontend/components/DeviceGrid.tsx` (group-by zone/type/status) filter/group the already-subscribed `overview` array client-side; selections mirrored to URL search params in `frontend/app/page.tsx:42-53`. Test: `frontend/components/FilterBar.test.tsx` (selecting a field updates only that field; clearing restores all fields to `ALL`); `frontend/components/DeviceGrid.test.tsx` (grouping). Plan.md documents, correctly, that no prior device-list filter/group capability exists to be "consistent with" — this screen is treated as that list, using the three fields foundation §6.1 names. |
| R8 | **Blocked** (by design, not a defect) | `backend/lib/auth.ts:17-23` (`requireAuth`) is called as the first statement of all three `liveView.*` queries (`backend/liveView.ts:34,75,122`) and throws a uniform "Not authenticated" error when `ctx.auth.getUserIdentity()` is `null`. Test: `backend/lib/auth.test.ts` + one "throws for an unauthenticated caller (R8)" test per query in `backend/liveView.test.ts` (lines 37-40, 100-106, 158-164) — all three pass. **What's missing and why it's not a builder defect:** (a) no real `users`/role resolution (that's `auth-roles`, not yet built — confirmed no `frontend/middleware.ts` or `frontend/proxy.ts` exists, matching plan.md's statement that route-level gating is out of this feature's scope); (b) no end-to-end test with a real signed-in session, because none exists yet in this repo. `plan.md`'s "Decision summary" #6 and "Risks & unknowns" explicitly pre-authorize exactly this state and instruct the reviewer to record it as `Blocked` rather than `Met`/`Missing` — this is a planner-acknowledged cross-feature dependency on `auth-roles`, correctly flagged by the builder in `tasks.md`'s "R8 note for the reviewer", not a gap the builder introduced silently. |

## Test results

- `npm run test` (repo root, backend, vitest): **25/25 passed**, 6 test files (`backend/lib/auth.test.ts`, `freshness.test.ts`, `keyMetrics.test.ts`, `latestMetrics.test.ts`, `backend/liveView.test.ts`, `backend/telemetry.test.ts`).
- `npm run typecheck` (repo root → `tsc --noEmit -p backend/tsconfig.json && tsc --noEmit -p backend/tsconfig.test.json`): clean, no output/errors.
- `cd frontend && npm run test` (vitest): **26/26 passed**, 8 test files.
- `cd frontend && npx tsc --noEmit --project tsconfig.json`: clean, no errors.
- `cd frontend && npm run build` (production build, Turbopack): fails without `NEXT_PUBLIC_CONVEX_URL` set (`ConvexReactClient` requires an absolute URL) — this is pre-existing behavior of `frontend/app/providers.tsx`, unmodified by this feature (confirmed identical on `main`), not a regression. Re-ran with a dummy `NEXT_PUBLIC_CONVEX_URL` set: **build succeeds**, including the new `/devices/[deviceId]` dynamic route and the rewritten `/` static route.
- No lint config exists in the repo (no `.eslintrc*`/`eslint.config.*` found anywhere outside `node_modules`) — nothing to run; this predates the feature.
- Verified the "hand-wrote `backend/_generated/`" deviation's claim directly: `backend/_generated/` exists on disk (needed for `convex-test`) but `git status --short` shows nothing under it and `.gitignore:10` lists `backend/_generated/` — confirmed not committed, as tasks.md claims.
- Verified by grep: no `setInterval`/`router.refresh`/revalidation call in any feature file (R5), and no `alerts`/`alertRules` reference in `backend/liveView.ts` or `frontend/components/EventLog.tsx` (R4).

## Issues

**Blocking**

- None.

**Should-fix**

- `backend/liveView.ts:36-40` — `overview` does `.withIndex("by_zone_and_status")` (no range constraint given, so it's an in-order scan of the whole index) then `.filter(isActive)` post-hoc, before `.take(500)`. This is the same shape of anti-pattern plan.md's own "Risks & unknowns" section calls out for `devices.listActive` and explicitly says not to copy ("Do **not** let `liveView.overview` copy the pattern"). It's bounded (unlike `devices.listActive`'s unbounded `.collect()`) so it isn't a functional bug at the spec's stated scale (tens–low hundreds of devices), but it doesn't get any benefit from the `by_zone_and_status` index either, since `isActive` isn't part of it. Suggestion: either add `isActive` to an index (e.g. `by_isActive_and_zone`) and query with an `.eq("isActive", true)` range condition, or note in a comment why the plain scan is acceptable at this scale so a future reader doesn't assume the index is doing filtering work it isn't.

**Nice-to-have**

- R5 has no automated test that seeds a telemetry write mid-render and asserts the UI updates without any user action — understandably hard without a live Convex dev deployment (blocked by this sandbox's egress policy, per plan.md's own risk notes), and the code-level evidence (plain `useQuery`, zero polling calls) is solid, but it's worth flagging as the one requirement resting entirely on Convex's own documented reactivity contract rather than a repo-local test. No action needed unless a real deployment becomes reachable later.
- `frontend/lib/freshness.ts`'s `STALE_FACTOR = 3` is manually duplicated from `backend/lib/freshness.ts` rather than shared/imported, by design (per the file's own comment, to avoid a frontend/backend import). Low risk since both are covered by tests that pin the value to `3`, but a future change to one without the other would silently desync R6's threshold — worth a shared-constant refactor if this codebase grows a common package later.

## Not covered

- R8's end-to-end behavior (a real signed-in session actually resolving vs. an unauthenticated route request actually being denied at the HTTP/route level) has no test and cannot have one yet — `auth-roles` isn't built. This is expected per plan.md and correctly reported as `Blocked` above, not silently skipped.
- R5's "live push update" behavior has no integration-level test exercising an actual Convex WebSocket subscription receiving a pushed update (see Nice-to-have above); coverage here is by code inspection + reliance on Convex's own tested reactivity guarantees, not a repo-local test.
