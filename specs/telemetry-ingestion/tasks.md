# Tasks: Hardened telemetry ingestion

> Written by builder. Ordered by dependency (setup → core → edge cases → tests).
> Every requirement in spec.md must be covered by at least one task.
> Mark `- [x]` only when its tests pass.

## Setup

- [x] **T1** — Bump `convex` to `^1.46.0` in root, `gateway/simulator/`, and
  `frontend/` `package.json`; `npm install` at root (workspaces cover
  `frontend` + `gateway/simulator`).
  - Files: `package.json`, `package-lock.json`, `gateway/simulator/package.json`,
    `frontend/package.json`
  - Satisfies: infra for all requirements (dependency bump)
  - Acceptance: `npm install` completes with no peer-dep errors.
  - **Done.** `npm install` succeeded; `node_modules/convex/package.json`
    reports `1.46.0` everywhere. (See T2 for why `@convex-dev/rate-limiter`
    was added then removed rather than kept.)

- [x] **T2** — Component-support spike: attempt `docker compose pull`/`up`
  against the self-hosted backend image to confirm the self-hosted image
  accepts components (`@convex-dev/rate-limiter`) before building on top of
  it. Record the outcome (worked / didn't / untestable in this sandbox) in
  Deviations before continuing.
  - Files: (spike only; see Deviations)
  - Satisfies: enables R21–R23 (risk spike named in plan's Risks section)
  - Acceptance: either (a) the self-hosted backend accepts the pushed
    component config — or (b) the spike is inconclusive/fails in this
    environment and the fallback (hand-rolled token bucket, same call-site
    shape) is adopted instead, recorded as a deviation.
  - **Result: inconclusive — environment-blocked, not a plan defect.** Started
    the Docker daemon and ran `docker compose pull backend`; it failed with a
    403 from `pkg-containers.githubusercontent.com` (GHCR's blob-storage
    host). The sandbox's egress-proxy status endpoint
    (`$HTTPS_PROXY/__agentproxy/status`) confirmed this as a
    `connect_rejected` / policy-denial, not a transient error — this sandbox's
    network policy blocks pulling `ghcr.io/get-convex/convex-backend` at all.
    Per the harness rules, org policy denials are reported, not retried or
    worked around. **Component support on the self-hosted backend remains
    unverified.** Adopted the plan's documented fallback (hand-rolled
    token-bucket rate limiter, see T8) as the actual implementation, rather
    than shipping unverified `@convex-dev/rate-limiter` wiring that could
    silently fail `convex dev`/`push` if the incompatibility turns out to be
    real rather than just this sandbox's network policy. `@convex-dev/rate-limiter`
    was installed then removed from `package.json` accordingly (see
    Deviations).

## Core: schema, config, auth, validation

- [x] **T3** — Schema: add `ingestRejections`, `ingestStats`, and
  `ingestRateLimits` tables (the last one for T8's hand-rolled limiter,
  replacing the plan's `@convex-dev/rate-limiter` component storage) per the
  Data model section (fields, indexes `by_ts`, `by_reason_and_ts`,
  `by_source_and_minuteStart`, `by_key`).
  - Files: `backend/schema.ts`
  - Satisfies: R13, R25, (R21–R23 storage)
  - Acceptance: `npx tsc --noEmit -p backend` (or equivalent) typechecks the
    schema with no errors.
  - **Done.** Generated `backend/_generated/` and `backend/tsconfig.json`
    offline via `npx convex codegen --system-udfs --init` (works without any
    live/reachable deployment — see note below); `npx tsc --noEmit -p backend`
    is clean. This unexpectedly unblocks real typechecking for the rest of the
    backend work despite T2's finding that no live Convex deployment is
    reachable in this sandbox (see Deviations).

- [x] **T4** — `backend/lib/ingestConfig.ts`: read all tunable limits from
  `process.env` with the documented defaults (batch size, payload bytes, skew,
  backfill age, length bounds, rate/burst, retention).
  - Files: `backend/lib/ingestConfig.ts`, `backend/lib/ingestConfig.test.ts`
  - Satisfies: R24 (config plumbing used by everything below)
  - Acceptance: `node --test` unit test — each env var overrides its default;
    unset env vars fall back to the documented default values.
  - **Done.** `node --test backend/lib/ingestConfig.test.ts` — 4/4 pass.

- [x] **T5** — `backend/lib/ingestAuth.ts`: parse `INGEST_TOKENS`
  (`<sourceId>.<secret>` comma list), constant-time compare over UTF-8 bytes
  against every configured entry (no early exit; dummy compare on unknown
  sourceId), return `{ sourceId } | null`.
  - Files: `backend/lib/ingestAuth.ts`, `backend/lib/ingestAuth.test.ts`
  - Satisfies: R2, R3, R5, R6, R7
  - Acceptance: `node --test` unit tests — valid token in list matches; empty/
    unset `INGEST_TOKENS` always rejects; two tokens sharing a `sourceId` both
    match (rotation overlap); a removed entry stops matching; compare runtime
    does not short-circuit on prefix mismatch (loop-count assertion, not a
    timing assertion).
  - **Done.** `node --test backend/lib/ingestAuth.test.ts` — 16/16 pass,
    including the no-short-circuit loop-count assertion and R3/R6/R23
    scenarios.

- [x] **T6** — `backend/lib/ingestValidation.ts`: pure `validateReading()` —
  shape → bounds → timestamp checks (device/existence checks excluded, since
  those need `ctx.db`), fixed evaluation order, stable reason codes per plan's
  table.
  - Files: `backend/lib/ingestValidation.ts`, `backend/lib/ingestValidation.test.ts`
  - Satisfies: R8, R9, R10
  - Acceptance: `node --test` unit tests — one case per reason code
    (`missing_field`, `unexpected_field`, `wrong_type`,
    `timestamp_too_far_future`, `timestamp_too_old`, `value_not_finite`,
    `external_id_too_long`, `metric_too_long`, `string_value_too_long`), plus a
    well-formed reading passes and a timestamp just inside each bound passes.
  - **Done.** Implemented as `validateReadingShape()`. Deviation from the
    function name in tasks/plan prose (`validateReading`): named
    `validateReadingShape` to make explicit that device-existence checks
    (R11/R12) are deliberately not part of it — see Deviations.

- [x] **T7** — Freshness-monotonicity rule as a pure, independently testable
  function: given per-device accepted-reading max timestamps and current
  `lastSeenAt`, compute the patch set (only devices whose max exceeds current;
  `status: "online"`, `lastSeenAt: max`), once per device, never regressing.
  - Files: `backend/lib/ingestValidation.ts` (co-located, used by
    `backend/ingest.ts`)
  - Satisfies: R19, R20
  - Acceptance: `node --test` unit tests — device with all readings rejected
    gets no patch; device with an older accepted reading than current
    `lastSeenAt` gets no patch; device with a newer accepted reading gets
    exactly one patch to the max, not one per reading.
  - **Done.** Implemented as `computeFreshnessPatches()`, same file.
    `node --test backend/lib/ingestValidation.test.ts` — 26/26 pass (20 shape
    cases + 6 freshness cases).

- [x] **T8** — `backend/lib/ingestRateLimit.ts`: hand-rolled token-bucket rate
  limiter (fallback adopted in T2), same call-site/return shape the plan
  describes for the component (`{ok, retryAfter}`), backed by the
  `ingestRateLimits` table (T3) with a read-modify-write per key. The Convex
  ctx/db-consuming wrapper is added in T12 (`backend/ingestRateLimit.ts`,
  a top-level `internalMutation`) since it needs the generated server module.
  - Files: `backend/lib/ingestRateLimit.ts`, `backend/lib/ingestRateLimit.test.ts`
  - Satisfies: R21, R22, R23 (rate limiting mechanism)
  - Acceptance: `node --test` unit tests on the pure arithmetic (no ctx/db
    needed here — see T12 for the storage-backed wrapper) — under the
    configured rate, requests succeed; a burst up to capacity succeeds; one
    over capacity is rejected with `ok:false` and a `retryAfter`; two
    different keys/buckets are independent (R23); token refill is time-based
    (advance a fake clock, confirm tokens replenish); a denied request does
    not consume tokens.
  - **Done.** `node --test backend/lib/ingestRateLimit.test.ts` — 9/9 pass.

## Core: mutation, HTTP action, stats

- [x] **T9** — Convert `backend/ingest.ts` `recordBatch` from `mutation` to
  `internalMutation`; rewrite the handler to run `validateReading()` +
  device-existence/active checks per reading (fixed order: shape/bounds →
  timestamp → device), insert `telemetry` for accepted readings, insert one
  `ingestRejections` row per rejected reading (never `continue`-skip without a
  record), then apply the T7 freshness patch once per device after the loop.
  Assert `stored + rejected.length === submitted` before returning.
  - Files: `backend/ingest.ts`
  - Satisfies: R4, R8, R9, R10, R11, R12, R13, R14, R17, R19, R20
  - Acceptance: cannot unit-test the `ctx.db`-dependent parts with
    `node --test`, and no live backend is reachable in this sandbox (T2). Real
    `npx tsc --noEmit -p backend` typecheck against the actual generated
    server/dataModel types **is** possible, though (see T3's note on offline
    codegen) — that plus code review against T6/T7's already-tested pure
    logic is the verification actually performed; true integration behavior
    (does a posted batch really land in `telemetry`?) remains unverified and
    is flagged in the final summary.
  - **Done.** `npx tsc --noEmit -p backend` clean after this change. Device
    existence/active lookups are cached per `externalId` (including negative
    "unknown device" results) so a batch with many readings for one device
    queries `devices` once; the once-per-batch freshness patch uses T7's
    `computeFreshnessPatches` against a `deviceId → lastSeenAt` map built from
    that same cache, so no extra queries are needed for the freshness step.

- [x] **T10** — `backend/ingestStats.ts`: `record` (internalMutation, one
  read-modify-write per batch keyed by `sourceId` + minute), `prune`
  (internalMutation, deletes rows older than retention and caps
  `ingestRejections` row count), `summary` (internalQuery, aggregates a time
  range for R25).
  - Files: `backend/ingestStats.ts`, `backend/schema.ts`
  - Satisfies: R25
  - Acceptance: reviewed against schema/indexes from T3; `npx tsc --noEmit -p
    backend` clean; no live backend available to exercise it end-to-end (T2)
    — flagged as unverified live.
  - **Done.** Added a `by_minuteStart` index to `ingestStats` (not in the
    plan's original two-index list) so `prune` can age out stale rows across
    all sources without pinning a `sourceId` first — see Deviations. The
    row-count backstop for `ingestRejections` is only exactly enforced when
    `INGEST_REJECTION_MAX_ROWS` is small enough to probe in one bounded query
    (Convex transactions cap scanned/read documents well below the default
    200,000); documented in code and flagged in Deviations rather than
    silently approximated.

- [x] **T11** — `backend/http.ts`: `httpRouter()` with `POST /ingest/readings`
  wired to the new httpAction (leave room for `auth-roles` to add routes to the
  same router later, per plan's Risks note).
  - Files: `backend/http.ts`
  - Satisfies: R1
  - Acceptance: reviewed for correct `httpRouter()`/`route()` usage against the
    installed `convex` package's type definitions; no live backend to smoke
    test against (T2).
  - **Done.** `npx tsc --noEmit -p backend` clean against the real
    `httpRouter`/`RouteSpec` types from the installed `convex` package.

- [x] **T12** — `backend/ingestHttp.ts` (+ `backend/ingestRateLimit.ts`, the
  Convex-facing `internalMutation` wrapper for T8's pure token bucket): the
  httpAction pipeline — authenticate (T5) → 401 uniform body on failure;
  rate-limit requests then readings (T8's hand-rolled limiter via
  `ingestRateLimit.consume`); enforce `MAX_PAYLOAD_BYTES` and
  `MAX_READINGS_PER_BATCH` before parsing/running the mutation; call
  `internal.ingest.recordBatch`; call `internal.ingestStats.record`; return the
  200/401/400/413/429/500 response shapes from the plan.
  - Files: `backend/ingestHttp.ts`, `backend/ingestRateLimit.ts`
  - Satisfies: R1, R2, R3, R5, R6, R7, R15, R16, R18, R21, R22, R23
  - Acceptance: reviewed R-by-R against response-shape requirements; no live
    backend to smoke test end-to-end (T2) — flagged as unverified live.
  - **Done.** `npx tsc --noEmit -p backend` clean, including
    `internal.ingest.recordBatch` / `internal.ingestRateLimit.consume` /
    `internal.ingestStats.record` call sites resolving against the real
    generated `internal` API object. Every request-level failure path returns
    before any `ctx.runMutation` that could write `telemetry` (R16); the rate
    limiter's own `consume` mutation commits independently of
    `recordBatch`'s outcome (plan's "not refunded on failure" design,
    preserved under the hand-rolled implementation).

- [x] **T13** — `backend/crons.ts`: hourly `internal.ingestStats.prune`.
  - Files: `backend/crons.ts`
  - Satisfies: R25 (bounded retention, supports observability without
    unbounded growth)
  - Acceptance: reviewed against Convex `cronJobs()`/`crons.interval()` API
    from the installed package's type definitions.
  - **Done.** `npx tsc --noEmit -p backend` clean.

## Client and deployment plumbing

- [x] **T14** — Rewrite `gateway/simulator/src/index.ts`: stop calling
  `ingest.recordBatch` via `ConvexHttpClient`; `fetch` `WAVELINK_INGEST_URL`
  with `Authorization: Bearer $WAVELINK_INGEST_TOKEN`; chunk to
  `WAVELINK_MAX_BATCH`; log every `rejected[]` entry; exponential backoff with
  jitter on 429/5xx/network error (honoring `retryAfterMs`/`Retry-After`),
  capped, never exiting/tight-looping; keep `devices.register` bootstrap
  unchanged (out of scope per plan's Risks).
  - Files: `gateway/simulator/src/index.ts`
  - Satisfies: R26
  - Acceptance: `npx tsc --noEmit` in `gateway/simulator` passes; no live stack
    to smoke test against (T2) — flagged as unverified live; code reviewed
    against R26's acceptance criteria.
  - **Done.** `npx tsc --noEmit -p gateway/simulator` clean. Uses a recursive
    await-loop instead of `setInterval` so a rate-limited/failed tick's
    backoff actually delays the next attempt rather than firing on a fixed
    timer regardless of outcome. Not run live against a real endpoint (T2) —
    only typechecked and code-reviewed against R26's acceptance criteria.

- [x] **T15** — `docker-compose.yml` / `.env.example` / README updates: wire
  `INGEST_TOKENS` into the `push` service (`npx convex env set`), add
  `WAVELINK_INGEST_URL` / `WAVELINK_INGEST_TOKEN` / `WAVELINK_MAX_BATCH` to the
  `simulator` service env, document the ingestion endpoint, credential
  generation/rotation, and the full tunable-limits table (matching the
  defaults actually in `ingestConfig.ts`).
  - Files: `docker-compose.yml`, `.env.example`, `README.md`
  - Satisfies: R5, R6, R24, R27
  - Acceptance: README's documented defaults match `ingestConfig.ts` literally
    (spot-checked); following the Docker deployment steps does not require any
    step not written down.
  - **Done.** `docker compose config -q` validates the compose file (only
    expected "variable not set, defaulting to blank" warnings for values a
    user fills into `.env`). README's "Tunable limits" table values were
    diffed programmatically against `INGEST_CONFIG_DEFAULTS` — all 14 match
    exactly. Not run end-to-end (T2's docker/network limitation) — the
    `push` service's `npx convex env set INGEST_TOKENS` line and the
    simulator's new env vars are reviewed but not exercised against a live
    stack.

## Tests

- [x] **T16** — Add root `test` script (`node --test`) and ensure all
  pure-logic unit tests from T4–T8 run under it in one command.
  - Files: `package.json`
  - Satisfies: enables verification of R2, R3, R5–R10, R19–R23, R24
  - Acceptance: `npm test` from repo root runs all new tests and exits 0.
  - **Done.** `npm test` → 55/55 pass, exit code 0. Also added `"type":
    "module"` to root `package.json` (see Deviations) so `node --test` runs
    the `.ts` test files without a `MODULE_TYPELESS_PACKAGE_JSON` warning.

- [x] **T17** — Final pass: run `npm test` and `npx tsc --noEmit` across
  backend/simulator. Docker-based end-to-end verification (valid batch,
  malformed, unknown-device, inactive-device, over-batch, bad-credential,
  rate-limited, `ingestStats.summary` counts) is blocked in this sandbox per
  T2 — state that plainly rather than claiming it.
  - Satisfies: all (verification pass)
  - Acceptance: `npm test` green; typecheck clean; live-verification status
    stated plainly in the final summary.
  - **Done.** `npm test`: 55/55 pass. `npx tsc --noEmit -p backend`: clean.
    `npx tsc --noEmit -p gateway/simulator`: clean. `npx tsc --noEmit` in
    `frontend`: clean (unaffected by the `convex` bump). `docker compose
    config -q`: valid (only expected "not set, defaulting to blank" warnings
    for `.env`-supplied values). **Not performed, and explicitly flagged as
    unverified:** any live/integration test — no HTTP request has actually
    hit `ingestHttp.ts`, no mutation has actually written to a real
    `telemetry`/`ingestRejections`/`ingestStats` table, and the
    `@convex-dev/rate-limiter` vs. hand-rolled-limiter question (T2) is
    unresolved for lack of a reachable self-hosted or Cloud deployment in
    this build sandbox (GHCR and `version.convex.dev` are both blocked by
    this sandbox's egress policy — confirmed via the proxy status endpoint,
    not assumed). See the final summary for what this means for review.

## Review round 1 fixes (specs/telemetry-ingestion/review.md, PASS WITH ISSUES)

- **Should-fix, addressed:** Every `ctx.runMutation(internal.ingestStats.record, ...)`
  call in `backend/ingestHttp.ts` (8 call sites) is now routed through a new
  `recordStatsBestEffort(ctx, args)` helper that wraps the call in its own
  `try/catch` and logs a structured `console.warn` on failure instead of
  letting the exception propagate. This means a stats-write failure (e.g.
  counter contention on the per-minute `ingestStats` document, which the
  plan's Risks section names as plausible) can never (a) turn an already-
  durably-committed accepted batch into an apparent failure response, or (b)
  replace a documented `{outcome:"error", category:...}` shape with a
  generic Convex error on any other exit path. Not a deviation from plan.md
  — a bug fix to match the plan's own intent that stats are a secondary,
  non-blocking concern (R25).
- **Nice-to-have, addressed:** `retryAfter === Infinity` (when an operator
  sets a `*_PER_MINUTE` env var to `0`) is now clamped before it can reach a
  response. Added `clampRetryAfterMs()` + `MAX_RETRY_AFTER_MS` (24h) to
  `backend/lib/ingestRateLimit.ts` (pure, unit-tested) and wired it into
  `backend/ingestHttp.ts`'s `errorResponse()`, so the JSON body's
  `retryAfterMs` and the `Retry-After` header are always finite/valid.
- **Nice-to-have, addressed:** `docker-compose.yml`'s backend image is now
  pinned by digest (`ghcr.io/get-convex/convex-backend@sha256:1b0dcd93a3d126400d16e256aea1106a2ee9538882dda545d2c979f28cff1483`,
  the digest `latest` resolved to on 2026-09-20) instead of the floating
  `:latest` tag, per plan.md's Risks section. Resolved via GHCR's manifest
  API, which — unlike the blob-storage CDN
  (`pkg-containers.githubusercontent.com`) that blocked the T2 spike — is
  reachable from this sandbox; the exact `curl` commands used are in a
  comment above the pinned line so a future update doesn't require
  rediscovering the method.
- **Nice-to-have, addressed (optional, per reviewer/coordinator — trivial fix
  applied):** An empty `readings: []` array is now rejected as
  `malformed_payload` in `backend/ingestHttp.ts` rather than succeeding with
  a vacuous `{submitted:0, stored:0, rejected:[]}` 200 — spec.md's
  Terminology defines a Batch as carrying "one or more readings." No
  requirement number governs this, so not logged as a spec-requirement fix,
  just a terminology-conformance tightening.
- **Nice-to-have, not addressed (per coordinator, left as-is):** R7's
  "recorded" being a log line + counter rather than a queryable per-attempt
  row is the plan's own deliberate, documented tradeoff — revisiting it is a
  planner-level decision, not something to change unilaterally here.
- New tests added: `backend/lib/ingestRateLimit.test.ts` gained 4 cases
  covering the rate-0 → `Infinity` path and `clampRetryAfterMs`'s behavior
  (finite passthrough, `Infinity`/`NaN`/`-Infinity` clamped, and that the
  clamped output survives `JSON.stringify` and header coercion without
  producing `null`/`"Infinity"`). Full suite: **59/59 pass** (was 55/55).
  `npx tsc --noEmit -p backend`, `-p gateway/simulator`, and frontend's
  `npx tsc --noEmit` all still clean; `docker compose config -q` still valid.

## Deviations from plan

> Builder fills this in immediately when implementation departs from plan.md —
> not after the fact, not only when reviewer asks. Empty section = zero deviations.

- **Deviation:** Merged `main` (the `auth-roles` feature) into this branch after review
  round 2 had already passed, requiring integration changes not anticipated by plan.md.
  - **Plan said:** Nothing — `auth-roles` hadn't landed yet when this plan was written; its
    collision risk with this feature was flagged (see Risks: "Simulator's `devices.register`
    bootstrap", "`backend/http.ts` is shared with `auth-roles`") but not resolved.
  - **Did instead:** `auth-roles` had independently built its own minimal ingestion-auth path
    (`backend/lib/serviceAuth.ts`, a single shared `INGEST_SERVICE_TOKEN`, a bare
    `POST /ingest/telemetry` route with no validation/rejection-recording/rate-limiting) to
    satisfy its own spec's R12. On merge, this feature's implementation was kept as the real
    ingestion path (it's a strict superset — satisfies auth-roles' R12 too, plus closes
    foundation R23's silent-drop problem and adds rate limiting/observability that
    `auth-roles`' version lacked); `auth-roles`' minimal version and `serviceAuth.ts` were
    removed. `backend/http.ts` keeps both `auth.addHttpRoutes(http)` (required for Convex
    Auth's own sign-in routes) and this feature's `/ingest/readings` route, exactly as the
    Risks section anticipated. `backend/schema.ts` merged both features' tables. The test
    suite migrated from `node --test` (`backend/lib/*.test.ts`) to `vitest` + `convex-test`
    (`tests/*.test.ts`), the test framework `auth-roles` established — `tests/ingest.test.ts`
    was rewritten as real integration tests using `t.fetch()` against this feature's actual
    endpoint, which finally exercises the full HTTP-action → internal-mutation pipeline
    in-process (see plan.md's Risks, "no live/integration test was possible", now partially
    resolved). The simulator's device-registration bootstrap was removed to match
    `auth-roles`' own fix for that exact collision (devices are now admin-registered via the
    dashboard).
  - **Why:** Two independently-developed features touched the same seam (ingestion auth).
    Keeping the more complete, already-reviewed implementation avoided regressing this
    feature's hardening while still satisfying everything `auth-roles` needed from ingestion.
  - **Consequence:** All 27 requirements remain met (re-verified: `npm test` — now `vitest
    run` — 188/188 passing across 12 files, `tsc --noEmit` clean across backend/simulator/
    frontend, `docker compose config` valid). Two real bugs found by an independent
    `/code-review` pass on the pre-merge branch were fixed during this integration:
    `ingestStats.summary` now uses the `by_minuteStart` index instead of a full-table
    `.filter()` scan (was at risk of exceeding Convex's per-transaction scan limit at the
    documented 90-day retention default), and a batch whose reading count exceeds
    `INGEST_READING_BURST` is now refused as `batch_too_large` before ever reaching the rate
    limiter, instead of getting an impossible-to-satisfy `rate_limited` response with a
    `retryAfterMs` that could never actually succeed.

- **Deviation:** Rate limiting implemented as a hand-rolled token bucket
  (`backend/lib/ingestRateLimit.ts` + `ingestRateLimits` table) instead of the
  `@convex-dev/rate-limiter` component.
  - **Plan said:** Use the official `@convex-dev/rate-limiter` v0.4.0
    component (`backend/convex.config.ts` + `app.use(rateLimiter)`), with the
    hand-rolled table as an explicitly named fallback "if the push fails"
    (plan's Risks section, "Components on the self-hosted backend image").
  - **Did instead:** Used the fallback from the start of real implementation.
  - **Why:** This sandbox's network egress policy blocks pulling
    `ghcr.io/get-convex/convex-backend` (403 from GHCR's blob-storage host,
    confirmed as a policy denial via the proxy status endpoint, not a
    transient failure), so `docker compose up` against the real self-hosted
    backend was never reachable here — the spike the plan calls for could not
    be run at all, let alone pass or fail on its own merits. Rather than ship
    `@convex-dev/rate-limiter` wiring whose compatibility with the self-hosted
    image is genuinely unknown (not "probably fine, just untested by me"), the
    safer choice was the plan's own named fallback, which the plan states
    keeps "the same call sites, same `{ok, retryAfter}` shape" — so swapping
    in the real component later, once someone can verify it against a live
    self-hosted backend, only touches `ingestRateLimit.ts` and
    `convex.config.ts`, not `ingestHttp.ts`. **This is an environment
    limitation of the build sandbox, not a finding that the plan's first
    choice is wrong** — a future builder with unblocked registry access should
    attempt T2's spike for real before assuming the fallback is required
    long-term.
  - **Consequence:** `@convex-dev/rate-limiter` is not a dependency of this
    build (added then removed from `package.json` after the spike was
    blocked). R21–R23 are met functionally by the hand-rolled limiter; the
    plan's specific component choice is unverified, not confirmed-then-
    replaced.

- **Deviation:** `validateReading()` from the plan's prose is implemented as
  `validateReadingShape()`.
  - **Plan said:** "pure `validateReading()`" (Tech decisions table,
    "Argument validation style" row).
  - **Did instead:** Named it `validateReadingShape` in
    `backend/lib/ingestValidation.ts`.
  - **Why:** The function only covers shape/bounds/timestamp (R8–R10); device
    existence/active checks (R11/R12) need `ctx.db` and live in
    `backend/ingest.ts` itself, exactly as the plan's own "Where per-reading
    validation runs" row describes. The plan's prose name reads as if one
    function does all of validation; the more specific name makes the split
    the plan actually specifies unambiguous at the call site. No behavioral
    difference from the plan.

- **Deviation:** Added a `by_minuteStart` index to `ingestStats` beyond the
  plan's Data model section, which lists only `by_source_and_minuteStart`.
  - **Plan said:** `ingestStats` has one index, `by_source_and_minuteStart`.
  - **Did instead:** Added a second index, `by_minuteStart` (`["minuteStart"]`
    alone).
  - **Why:** The prune cron needs to find stale rows by age across *all*
    sources; `by_source_and_minuteStart` requires pinning an `sourceId`
    first; and equality-then-range only works starting from the leftmost
    field. Without a time-first index, aging out `ingestStats` would require
    a full table scan every hour. Purely additive — does not change any
    existing query or the write path.

- **Deviation:** The row-count backstop for `ingestRejections`
  (`INGEST_REJECTION_MAX_ROWS`) is only exactly enforced when the configured
  cap is below a few thousand rows; at the documented default (200,000) it is
  not atomically enforceable at all in this implementation.
  - **Plan said:** "a hard row cap" as a "second, count-based bound" (Tech
    decisions, "Retention" row), without specifying the enforcement
    mechanism.
  - **Did instead:** `backend/ingestStats.ts`'s `prune` only runs the exact
    count-based trim when `INGEST_REJECTION_MAX_ROWS < 4000`; above that, only
    age-based retention (`INGEST_REJECTION_RETENTION_MS`, default 7 days) is
    enforced.
  - **Why:** Convex transactions cap the number of documents a single query
    can scan/read well below 200,000 (the "32,000 documents scanned per
    transaction" limit the plan itself cites from `docs/production/state/limits.mdx`),
    so an atomic "count exactly N rows, delete the oldest excess" is
    mechanically impossible at the plan's own default cap value — not a
    corner cut, a hard platform limit the plan's Sources section already
    names but didn't reconcile against this specific default. Age-based
    retention alone already bounds storage (a flood inside the rate limit for
    7 days is still a bounded number of rows), so the count cap is a
    secondary backstop, not the only control. Flagging rather than silently
    shipping a check that would throw or silently no-op at the documented
    default.
  - **If this needs exact enforcement at 200,000 rows:** maintain a live
    counter (increment on insert in `ingest.ts`, decrement on delete in
    `prune`) in a small dedicated document instead of a query-time count —
    deliberately not done here to avoid introducing new write contention on
    the hot ingestion path without being asked to.

- **Deviation:** Real `npx tsc --noEmit -p backend` typechecking (against the
  actual generated `_generated/server`/`_generated/dataModel`/`_generated/api`
  types) turned out to be possible in this sandbox after all, despite T2's
  finding that no live/reachable Convex deployment exists here.
  - **Plan/tasks.md assumed:** Backend Convex function files could only be
    verified by code review, since generating `backend/_generated/` normally
    requires `npx convex dev` against a real deployment (self-hosted or
    Cloud), and T2 established that none is reachable in this sandbox.
  - **Did instead:** Discovered and used `npx convex codegen --system-udfs`
    (a real, documented CLI flag — not a hack) which generates
    `backend/_generated/` purely from the local `backend/schema.ts` and
    function files, with **no deployment lookup and no network access at
    all**. Also ran `npx convex codegen --init` once to get the standard
    `backend/tsconfig.json` Convex normally scaffolds. Every backend `.ts`
    file in this build (`schema.ts`, `ingest.ts`, `ingestStats.ts`, `http.ts`,
    `ingestHttp.ts`, `ingestRateLimit.ts`, `crons.ts`, and everything under
    `lib/`) was typechecked with `npx tsc --noEmit -p backend` against these
    real generated types after every change, not just reviewed by eye.
  - **Why:** This is strictly more verification than the plan/tasks.md
    expected was achievable here, so it's recorded for transparency, not as a
    problem. It does **not** substitute for integration/runtime verification
    — no query, mutation, or httpAction in this build has actually executed
    against a real database or HTTP request in this sandbox; typechecking
    confirms the code is well-typed and its call sites match, nothing about
    runtime behavior (e.g., whether a `.unique()` throws on an unexpected
    duplicate, whether an index name is spelled right at the string-literal
    level in a way TypeScript can't catch, etc.).
  - **Also added:** `"allowImportingTsExtensions": true` to
    `backend/tsconfig.json` (in its "not required by Convex" section) so the
    `*.test.ts` files — which import sibling modules with an explicit `.ts`
    extension, required for `node --test` to run them directly — don't fail
    `tsc`'s TS5097 check. Safe because `noEmit` was already set.

- **Deviation:** Added `"type": "module"` to root `package.json`.
  - **Plan said:** Nothing — not mentioned in plan.md.
  - **Did instead:** Added it.
  - **Why:** Without it, `node --test backend/lib/*.test.ts` prints a
    `MODULE_TYPELESS_PACKAGE_JSON` warning on every run (Node reparses each
    `.ts` test file as ESM after guessing wrong from the extensionless root
    `package.json`). The root package has no `.js` files of its own — only
    workspace packages under `frontend/` and `gateway/simulator/`, which each
    have their own `package.json` and are unaffected by the root's `type`
    field — so this is a no-risk cleanup, not a behavior change.
