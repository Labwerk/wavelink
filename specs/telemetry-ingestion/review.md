# Review: Hardened telemetry ingestion

> Written by reviewer. Independent verification against spec.md. No source edits.

## Verdict

**PASS WITH ISSUES**

All 27 requirements are addressed with concrete, traceable evidence (code + passing
unit tests + a clean real typecheck against generated Convex types). No requirement
is silently unmet. The rate-limiter deviation (hand-rolled token bucket instead of
`@convex-dev/rate-limiter`) is the plan's own named, documented fallback for a
genuine environment block (GHCR pull denied by sandbox network policy), not an
invented shortcut, and it satisfies R21–R24 on its own merits. The issues below are
real but none rise to Blocking: one is a latent error-handling gap that could
degrade response fidelity under load (Should-fix), the rest are small edge cases or
documentation/process nits (Nice-to-have), plus the standing, environment-forced
absence of any live/integration test, which this review treats as a Should-fix note
per the reviewing brief rather than an automatic fail.

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met | `backend/http.ts:8-16` routes `POST /ingest/readings` to `backend/ingestHttp.ts:37` (`httpAction`). Typechecked clean against real `httpRouter`/`RouteSpec` types (`npx tsc --noEmit -p backend`, verified by reviewer). |
| R2 | Met | `backend/ingestHttp.ts:43-58`: missing/malformed/unmatched credential → 401 before any `runMutation`. Unit-tested: `backend/lib/ingestAuth.test.ts:69-77`. |
| R3 | Met (caveat) | `backend/ingestAuth.ts` never touches `ctx.auth`; a Convex-Auth-shaped bearer value never matches (`ingestAuth.test.ts:120-125`). Caveat: the "cannot read telemetry / manage devices" half of R3's acceptance criterion is currently vacuous, because `backend/devices.ts` and `backend/telemetry.ts` have **no auth gating at all yet** (pre-`auth-roles`) — see "Not covered" below. This is the spec's own acknowledged dependency ordering, not a builder defect. |
| R4 | Met | `backend/ingest.ts:49` — `recordBatch` is an `internalMutation`. Repo-wide grep confirms no other public `mutation`/`query` writes to `telemetry` (`backend/telemetry.ts` only exports a `query`; `backend/devices.ts` never touches the `telemetry` table). |
| R5 | Met | `backend/lib/ingestAuth.ts:100-104` (zero configured entries ⇒ always refuse, still runs a dummy compare). Unit-tested: `ingestAuth.test.ts:79-83`. `.env.example:24-31` documents "unset/empty ⇒ refuse all", no real token committed. |
| R6 | Met | `parseIngestTokens` (`ingestAuth.ts:33-45`) treats two entries sharing a `sourceId` as both valid. Unit-tested: `ingestAuth.test.ts:85-108` (overlap + immediate retirement, no gap). README §"Credential setup and rotation" documents the `npx convex env set` rotation sequence matching this exactly. |
| R7 | Met | Byte-identical 401 body (`ingestHttp.ts:18`, `UNAUTHORIZED_BODY`); constant-time compare with no early exit and a dummy compare on zero matches (`ingestAuth.ts:62-104`), unit-tested for no-short-circuit at `ingestAuth.test.ts:49-62`. Each failure is recorded via a structured `console.warn` (`ingestHttp.ts:49-56`, includes ts/user-agent/forwarded-for) plus an `ingestStats.requestsCredentialFailed` counter — a deliberate, plan-documented tradeoff (a DB row per credential failure would be an unauthenticated write-amplification vector) rather than a per-attempt DB row. See Issues (Nice-to-have) for a note on this tradeoff's limits. |
| R8 | Met | `backend/lib/ingestValidation.ts:42-76` (required/unexpected-field/type checks). Unit-tested per reason code, e.g. `ingestValidation.test.ts:19-40+` (one case per code, confirmed 26/26 passing in that file). |
| R9 | Met | `ingestValidation.ts:94-100` (future-skew / backfill-age bounds, inclusive-boundary semantics verified by reading: `>`/`<` not `>=`/`<=`, so a reading exactly at the bound is accepted). |
| R10 | Met | `ingestValidation.ts:77-92` (length bounds on externalId/metric/string value; `Number.isFinite` on numeric value). |
| R11 | Met | `backend/ingest.ts:102-114`: cache-miss on `by_externalId` ⇒ `unknown_device`; no `ctx.db.insert("devices", ...)` exists anywhere on the ingestion path (confirmed by grep — only `backend/devices.ts:register` inserts devices, and it is never called from `ingest.ts`). |
| R12 | Met | `ingest.ts:115-118`: `!device.isActive` ⇒ `inactive_device`, checked strictly after the existence check so the two reasons can never be conflated. |
| R13 | Met | `ingest.ts:69-87` (`reject()` inserts one `ingestRejections` row per rejection, every call site); invariant assertion at `ingest.ts:133-137` throws if `stored + rejected.length !== submitted` (fails safe — the whole transaction rolls back rather than silently under/over-counting). |
| R14 | Met | `ingest.ts:89-130`: the loop `continue`s past a rejection without aborting the batch; accepted readings for unrelated devices are inserted in the same transaction. |
| R15 | Met | `ingestHttp.ts:140-149` response includes `submitted`, `stored`, `rejected[]`; each rejection entry (`ingest.ts:81-86`) carries `index`, `reason`, `externalId?`, `metric?` — no prose parsing needed. |
| R16 | Met | `ingestHttp.ts`: `unauthorized` (401, L57), `malformed_payload` (400, L85/93), `batch_too_large`/`payload_too_large` (413, L77/99), `rate_limited` (429, L69/110), `internal_error` (500, L124) — every category except `internal_error` returns strictly before `ctx.runMutation(internal.ingest.recordBatch, ...)` is ever called (L119), so no partial write is possible; `internal_error` is only reached if `recordBatch`'s own transaction throws, which rolls back entirely. |
| R17 | Met | `backend/ingest.ts`'s `recordBatch` is one `internalMutation` — Convex commits all its writes as a single transaction — and `ingestHttp.ts:119` `await`s that mutation before building the 200 response (L140-149). See Issues (Should-fix) for a related but distinct fragility in the *post*-write stats-recording step. |
| R18 | Met | `ingestHttp.ts:73-78` (payload bytes vs `maxPayloadBytes` ⇒ 413 `payload_too_large`) and `L96-100` (`readings.length` vs `maxReadingsPerBatch` ⇒ 413 `batch_too_large`), both before parsing/mutation. |
| R19 | Met | `ingest.ts:139-151` + `backend/lib/ingestValidation.ts:105-133` (`computeFreshnessPatches`): only `acceptedForFreshness` entries contribute; exactly one `ctx.db.patch` per device with an actual advance. Unit-tested: `ingestValidation.test.ts` freshness cases ("all readings rejected gets no patch", "exactly one patch to the max"). |
| R20 | Met | `computeFreshnessPatches` (`ingestValidation.ts:126-131`): `if (maxTs > current)` — strictly greater, so an equal or older accepted reading never advances `lastSeenAt`. Unit-tested: "an older accepted reading than current lastSeenAt gets no patch (R20)". |
| R21 | Met | `backend/lib/ingestRateLimit.ts` (`applyTokenBucket`) + `ingestHttp.ts:62-70` (requests) and `L103-111` (readings), both keyed and both with `capacity` = configured burst. Unit-tested: `ingestRateLimit.test.ts:56-83` (burst passes, sustained excess throttled). |
| R22 | Met | `ingestHttp.ts:69,110` → `errorResponse(429, "rate_limited", retryAfterMs)`; `errorResponse` (`L27-35`) sets both the JSON body's `retryAfterMs` and an HTTP `Retry-After` header. Distinct status/category from `unauthorized`/`malformed_payload`. See Issues (Nice-to-have) for a `rate: 0` edge case. |
| R23 | Met | Both buckets keyed by `` `ingestRequests:${sourceId}` ``/`` `ingestReadings:${sourceId}` `` (`ingestHttp.ts:63,104`). Unit-tested: `ingestRateLimit.test.ts:85-94` ("two independent buckets... don't affect each other"). |
| R24 | Met | `backend/lib/ingestConfig.ts` reads every limit from `process.env` with defaults in `INGEST_CONFIG_DEFAULTS`. Reviewer independently diffed README's "Tunable limits" table (`README.md:298-313`) and `.env.example:40-53` against `INGEST_CONFIG_DEFAULTS` (`ingestConfig.ts:33-48`) — all 14 values match exactly. |
| R25 | Met | `backend/ingestStats.ts`: `record` (per-batch counter upsert), `summary` (range aggregation), documented CLI invocation in README ("Observability" section). See Issues (Should-fix) for a fragility that could undercount under contention. |
| R26 | Met | `gateway/simulator/src/index.ts`: bearer auth (`L121-128`), chunking to `WAVELINK_MAX_BATCH` (`L79-86,182`), exponential backoff with jitter honoring `retryAfterMs`/`Retry-After` (`L154-160,190,201`), logs every `rejected[]` entry (`L144-150`), never exits on 401/429/5xx/network error (`L129-177`). Typechecks clean (`npx tsc --noEmit -p gateway/simulator`, verified by reviewer). Not live-tested (see Test results). |
| R27 | Met | `README.md`'s "Ingestion" section (endpoint, request/response shapes, reason-code table, credential setup/rotation, tunable-limits table) plus `docker-compose.yml`'s `push` service wiring `INGEST_TOKENS` via `npx convex env set` and the `simulator` service's `WAVELINK_INGEST_*` env vars. Reviewer read the full section; no undocumented step was found. |

## Test results

**Ran and confirmed personally (not just trusting the builder's numbers):**
- `npm test` (`node --test` over `backend/lib/*.test.ts`) → **55/55 pass**, exit 0.
- `npx tsc --noEmit -p backend` → clean (exit 0), against the real generated
  `backend/_generated/{server,dataModel,api}` produced offline by
  `npx convex codegen --system-udfs --init` (confirmed this codegen path works with
  no network/deployment access, as the builder claimed).
- `npx tsc --noEmit -p gateway/simulator` → clean (exit 0).
- Read `.env.example`, `README.md`'s Ingestion section, and `docker-compose.yml` in
  full and cross-checked the documented defaults against
  `INGEST_CONFIG_DEFAULTS` in `backend/lib/ingestConfig.ts` — all 14 tunables match
  exactly, confirming the builder's "diffed programmatically" claim.
- Confirmed no lint script exists anywhere in the repo (`package.json`,
  `frontend/package.json`, `gateway/simulator/package.json`) — this predates the
  feature; nothing to run.

**Not run, and not possible in this environment (confirmed, not assumed):**
- Any live/integration test: no HTTP request has ever hit `ingestHttp.ts`, no
  mutation has ever written to a real `telemetry`/`ingestRejections`/`ingestStats`
  table, and `docker compose up` has never been exercised against real containers.
  This reviewer did not attempt `docker compose pull`/`up` again, since the
  builder's GHCR policy-denial finding (T2) is credible and re-attempting it would
  not produce new information.
- Whether `@convex-dev/rate-limiter` itself is compatible with the self-hosted
  backend image remains genuinely unverified (by builder or reviewer) — the
  hand-rolled fallback is judged on its own merits below, per this review's brief,
  not penalized for not being the named component.

**Deviation-specific judgment (tasks.md "Deviations from plan"):**
- The rate-limiter fallback (`backend/lib/ingestRateLimit.ts` + `ingestRateLimits`
  table) independently satisfies R21–R24: same `{ok, retryAfter}` contract, per-key
  buckets, burst = capacity, env-configurable, unit-tested including the R23
  "two sources are independent" case. It does not silently violate any non-goal or
  requirement — it's the plan's own named contingency, applied because the spike it
  was contingent on could not be run at all in this sandbox. No objection.
- The other four recorded deviations (`validateReadingShape` naming, the added
  `by_minuteStart` index, the `INGEST_REJECTION_MAX_ROWS` exact-enforcement
  threshold, and `"type": "module"`) are all either purely additive, cosmetic, or
  transparently reasoned platform limitations — none weakens a requirement or
  hides a gap. No objection.

## Issues

**Blocking**
- None.

**Should-fix**
- **Unguarded `ingestStats.record` calls can turn a well-defined response into a
  generic failure (affects R16, R17's response reliability, R22, R25).**
  `backend/ingestHttp.ts` calls `ctx.runMutation(internal.ingestStats.record, ...)`
  at **every** exit path (lines 45, 68, 76, 84, 92, 98, 109, 132) with no
  `try/catch`. If that mutation throws — e.g. under the "counter contention" the
  plan's own Risks section names as a real possibility (many concurrent batches
  from the same source hitting the same per-minute `ingestStats` document) — the
  exception propagates out of the `httpAction` unhandled. Two concrete
  consequences: (1) on the **accepted** path (line 132), this happens *after*
  `recordBatch` has already durably committed the readings (line 119) — so a
  sender could receive a failure/500-ish response for a batch that was, in fact,
  fully accepted and stored, inviting a retry that compounds the spec's
  already-accepted "duplicate on retry" risk; (2) on **every** other path (401,
  429, 413, 400), the carefully-designed, documented `{outcome:"error",
  category:...}` shape (R16, R22) could be replaced by whatever generic error
  Convex's own httpAction error handling produces, which does not match the
  documented contract. Suggest wrapping each `ingestStats.record` call in its own
  `try/catch`, logging a warning on failure, and always returning the
  already-determined response regardless of whether the stats write succeeded —
  stats are explicitly a secondary observability concern (R25) and should never be
  able to override the primary request outcome the client already earned.

**Nice-to-have**
- **`retryAfter` can become `Infinity` if an operator sets a `*_PER_MINUTE` env var
  to `0`.** `backend/lib/ingestRateLimit.ts:67` — `refillRatePerMs > 0 ? ... :
  Infinity`. `errorResponse` (`ingestHttp.ts:27-35`) then does
  `JSON.stringify({..., retryAfterMs: Infinity})`, which serializes to `null`
  (`JSON.stringify(Infinity) === "null"` in JS), while the `Retry-After` **header**
  gets the literal string `"Infinity"` — not a valid HTTP header value, and
  inconsistent with the (silently dropped) body field. Low priority (setting a
  rate to exactly 0 is an unusual way to hard-disable a source), but worth
  clamping — e.g. `Number.isFinite(retryAfter) ? retryAfter : someMaxMs` — before
  building the response.
- **An empty `readings: []` batch is accepted** (`ingestHttp.ts` never rejects a
  zero-length array; `ingest.ts` happily returns `{submitted:0, stored:0,
  rejected:[]}` with a 200). Spec's Terminology defines a Batch as "one ingestion
  request carrying **one or more** readings," so this is a minor mismatch with the
  glossary, though no numbered requirement explicitly forbids an empty batch and
  no harm results. Consider rejecting with a `malformed_payload`/dedicated reason
  if strict terminology conformance matters later.
- **`docker-compose.yml`'s backend image is still `:latest`**
  (`ghcr.io/get-convex/convex-backend:latest`, line 3), despite plan.md's Risks
  section explicitly suggesting "pin the backend image to a digest while you're in
  there — `latest` is not reproducible." This wasn't done and wasn't recorded in
  tasks.md's Deviations. It's a soft suggestion rather than one of spec.md's R1–R27
  or one of plan's four "please confirm" points, so not required for this review's
  pass/fail, but worth a follow-up task.
- **R7's "recorded" is a log line + counter, not a queryable per-attempt row** —
  this is the plan's own explicitly-reasoned tradeoff (Tech decisions table +
  Risks section), adopted to avoid handing an unauthenticated flood a write
  amplifier. Judged Met on its own terms here, but plan.md itself flags that if a
  future reviewer or stakeholder insists R7 means an auditable per-failure
  database row, that's a plan-level decision to revisit with the planner, not a
  builder defect to fix unilaterally.

## Not covered

- **R3's "cannot read telemetry / manage devices / manage users" half** has no
  meaningful test today because `backend/devices.ts` and `backend/telemetry.ts`
  carry **zero** auth gating yet (confirmed by reading both files — no
  `ctx.auth`/`requireRole` check anywhere): every query and mutation there is
  already fully public today, credentialed or not, so the ingestion credential
  isn't being "refused" from anything — there's no gate yet to refuse it from.
  This is squarely the spec's own acknowledged dependency ordering
  ("This feature must not require end-user auth to be finished first"), not a
  builder gap, but it means this half of R3 needs to be re-verified once
  `auth-roles` actually lands its `requireAuth`/`requireRole` checks — flag it for
  that feature's reviewer rather than closing the loop here.
- **All end-to-end/integration behavior** (a real HTTP POST actually reaching
  `ingestHttp.ts`, a real write landing in `telemetry`/`ingestRejections`/
  `ingestStats`, real cron execution, real credential rotation against a live
  deployment, real rate-limiter behavior under concurrent load, real
  `docker compose up`) has never been exercised, in this build or in this review,
  because both GHCR (self-hosted backend image) and Convex's anonymous dev-mode
  endpoint are policy-blocked in this sandbox. What stands in for it: pure-logic
  unit tests (55/55) for every requirement's core logic, plus a real `tsc`
  typecheck against actually-generated Convex types for every call site
  (`ctx.db`, `ctx.runMutation`, `internal.*` references, index names, schema
  shapes). This is a materially weaker guarantee than a live integration test for
  a security-hardening feature, and should be exercised for real the first time
  this environment (or any environment) has unblocked registry/deployment access,
  before this feature is trusted in a real deployment.
