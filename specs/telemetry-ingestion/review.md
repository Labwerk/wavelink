# Review: Hardened telemetry ingestion

> Written by reviewer. Independent verification against spec.md. No source edits.

## Verdict

**PASS**

All 27 requirements are addressed with concrete, traceable evidence (code + passing
unit tests + a clean real typecheck against generated Convex types). No requirement
is silently unmet. The rate-limiter deviation (hand-rolled token bucket instead of
`@convex-dev/rate-limiter`) is the plan's own named, documented fallback for a
genuine environment block (GHCR blob pulls denied by sandbox network policy), not
an invented shortcut, and it satisfies R21–R24 on its own merits.

This is round 2. The one Should-fix and three Nice-to-haves from round 1 have all
been verified fixed in code, by re-reading the changed files and by independently
re-running the test suite and both typechecks (not by trusting the builder's
summary). No new defects were found. What remains open is not a code defect: the
standing, environment-forced absence of any live/integration test, and one
plan-level tradeoff (R7) that was reviewed and deliberately left as-is in round 1 —
both are documented below under Issues/Not covered for transparency, consistent
with this review's brief that they should not block a PASS.

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met | `backend/http.ts:8-16` routes `POST /ingest/readings` to `backend/ingestHttp.ts:67` (`httpAction`). Typechecked clean against real `httpRouter`/`RouteSpec` types (`npx tsc --noEmit -p backend`, re-verified by reviewer this round). |
| R2 | Met | `backend/ingestHttp.ts:73-88`: missing/malformed/unmatched credential → 401 before any `runMutation`. Unit-tested: `backend/lib/ingestAuth.test.ts:69-77`. |
| R3 | Met (caveat) | `backend/ingestAuth.ts` never touches `ctx.auth`; a Convex-Auth-shaped bearer value never matches (`ingestAuth.test.ts:120-125`). Caveat unchanged from round 1: the "cannot read telemetry / manage devices" half of R3's acceptance criterion is currently vacuous, because `backend/devices.ts` and `backend/telemetry.ts` have **no auth gating at all yet** (pre-`auth-roles`) — see "Not covered" below. Spec's own acknowledged dependency ordering, not a builder defect. |
| R4 | Met | `backend/ingest.ts:49` — `recordBatch` is an `internalMutation`. Repo-wide grep confirms no other public `mutation`/`query` writes to `telemetry`. |
| R5 | Met | `backend/lib/ingestAuth.ts:100-104` (zero configured entries ⇒ always refuse, still runs a dummy compare). Unit-tested: `ingestAuth.test.ts:79-83`. `.env.example:24-31` documents "unset/empty ⇒ refuse all", no real token committed. |
| R6 | Met | `parseIngestTokens` (`ingestAuth.ts:33-45`) treats two entries sharing a `sourceId` as both valid. Unit-tested: `ingestAuth.test.ts:85-108` (overlap + immediate retirement, no gap). README §"Credential setup and rotation" matches. |
| R7 | Met | Byte-identical 401 body (`ingestHttp.ts:20`, `UNAUTHORIZED_BODY`); constant-time compare with no early exit and a dummy compare on zero matches (`ingestAuth.ts:62-104`), unit-tested for no-short-circuit at `ingestAuth.test.ts:49-62`. Each failure recorded via structured `console.warn` (`ingestHttp.ts:79-86`) plus an `ingestStats.requestsCredentialFailed` counter — the plan's deliberate, documented tradeoff (log+counter, not a per-attempt DB row), left as-is per round 1's note that it's a plan-level decision. |
| R8 | Met | `backend/lib/ingestValidation.ts:42-76` (required/unexpected-field/type checks). Unit-tested per reason code in `ingestValidation.test.ts`. |
| R9 | Met | `ingestValidation.ts:94-100` (future-skew / backfill-age bounds, strict `>`/`<` so a boundary value is accepted). |
| R10 | Met | `ingestValidation.ts:77-92` (length bounds; `Number.isFinite` on numeric value). |
| R11 | Met | `backend/ingest.ts:102-114`: cache-miss on `by_externalId` ⇒ `unknown_device`; no `ctx.db.insert("devices", ...)` anywhere on the ingestion path. |
| R12 | Met | `ingest.ts:115-118`: `!device.isActive` ⇒ `inactive_device`, checked strictly after the existence check. |
| R13 | Met | `ingest.ts:69-87` (`reject()` inserts one `ingestRejections` row per rejection); invariant assertion at `ingest.ts:133-137` throws (rolling back the transaction) if `stored + rejected.length !== submitted`. |
| R14 | Met | `ingest.ts:89-130`: the loop `continue`s past a rejection without aborting the batch; accepted readings for unrelated devices commit in the same transaction. |
| R15 | Met | `ingestHttp.ts:174-183` response includes `submitted`/`stored`/`rejected[]`; each rejection entry (`ingest.ts:81-86`) carries `index`, `reason`, `externalId?`, `metric?`. |
| R16 | Met | `ingestHttp.ts`: `unauthorized` (401), `malformed_payload` (400, now also covers empty `readings: []` — see round-2 fix below), `batch_too_large`/`payload_too_large` (413), `rate_limited` (429), `internal_error` (500) — every category except `internal_error` returns strictly before `ctx.runMutation(internal.ingest.recordBatch, ...)` (L153) is ever called. |
| R17 | Met | `backend/ingest.ts`'s `recordBatch` is one `internalMutation` (atomic commit); `ingestHttp.ts:153` `await`s it before building the 200 response. Round 1's related fragility (a stats-write failure after this point corrupting the reported outcome) is now fixed — see Issues, "Resolved this round". |
| R18 | Met | `ingestHttp.ts:102-108` (payload bytes) and `L130-134` (`readings.length` vs max), both before parsing/mutation. |
| R19 | Met | `ingest.ts:139-151` + `backend/lib/ingestValidation.ts:105-133` (`computeFreshnessPatches`): only accepted readings contribute; exactly one patch per device with an actual advance. Unit-tested. |
| R20 | Met | `computeFreshnessPatches` (`ingestValidation.ts:126-131`): strict `maxTs > current`. Unit-tested ("an older accepted reading... gets no patch (R20)"). |
| R21 | Met | `backend/lib/ingestRateLimit.ts` (`applyTokenBucket`) + `ingestHttp.ts:92-100` (requests) and `L137-145` (readings), both keyed, `capacity` = configured burst. Unit-tested: `ingestRateLimit.test.ts:56-83`. |
| R22 | Met | `ingestHttp.ts:99,144` → `errorResponse(429, "rate_limited", retryAfterMs)`; `errorResponse` (`L29-42`) now clamps via `clampRetryAfterMs` before setting the body/header — see Issues, "Resolved this round" (was a Nice-to-have edge case in round 1). |
| R23 | Met | Both buckets keyed by `` `ingestRequests:${sourceId}` ``/`` `ingestReadings:${sourceId}` `` (`ingestHttp.ts:93,138`). Unit-tested: `ingestRateLimit.test.ts:116-125`. |
| R24 | Met | `backend/lib/ingestConfig.ts` reads every limit from `process.env` with defaults in `INGEST_CONFIG_DEFAULTS`. README's "Tunable limits" table and `.env.example` independently re-diffed against `INGEST_CONFIG_DEFAULTS` this round — all 14 values still match exactly. |
| R25 | Met | `backend/ingestStats.ts`: `record`, `summary`, documented CLI invocation in README. Round 1's fragility (an unguarded `record` call able to override the primary response) is now fixed via `recordStatsBestEffort` — see Issues, "Resolved this round". |
| R26 | Met | `gateway/simulator/src/index.ts`: bearer auth, chunking to `WAVELINK_MAX_BATCH`, exponential backoff with jitter honoring `retryAfterMs`/`Retry-After`, logs every `rejected[]` entry, never exits on 401/429/5xx/network error. Typechecks clean (re-verified this round). Not live-tested (see Test results). |
| R27 | Met | `README.md`'s "Ingestion" section, `docker-compose.yml`'s `push` service wiring `INGEST_TOKENS`, and the `simulator` service's `WAVELINK_INGEST_*` env vars. No undocumented step found. |

## Test results

**Ran and confirmed personally this round (not just trusting the builder's numbers):**
- `npm test` (`node --test` over `backend/lib/*.test.ts`) → **59/59 pass**, exit 0
  (was 55/55 in round 1; the 4 new cases are the `retryAfter`/`clampRetryAfterMs`
  cases in `backend/lib/ingestRateLimit.test.ts:90-114`, read and confirmed to
  actually exercise the `Infinity`/`NaN`/`-Infinity` clamp and its
  JSON/header-safety, not just the happy path).
- `npx tsc --noEmit -p backend` → clean (exit 0).
- `npx tsc --noEmit -p gateway/simulator` → clean (exit 0).
- Re-read `backend/ingestHttp.ts` end to end and counted call sites: all 8
  `internal.ingestStats.record` invocations now go through the new
  `recordStatsBestEffort` helper (`ingestHttp.ts:54-65`), and exactly one direct
  `ctx.runMutation(internal.ingestStats.record, ...)` call remains — inside that
  helper's own `try/catch` (`L59`). No path can leak an unhandled exception from a
  stats-write failure.
- Re-read `errorResponse` (`ingestHttp.ts:29-42`) and confirmed both call sites
  that pass a `retryAfterMs` (`L99`, `L144`) route through it, and it
  unconditionally clamps via `clampRetryAfterMs` before touching the JSON body or
  the `Retry-After` header — no way for an unclamped `Infinity` to reach a
  response.
- Confirmed the empty-`readings`-array fix (`ingestHttp.ts:121-128`): `readings ===
  null || readings.length === 0` now both return `malformed_payload`; the old
  vacuous 200 response is gone.
- Confirmed `docker-compose.yml:14` now pins
  `ghcr.io/get-convex/convex-backend@sha256:1b0dcd93a3d126400d16e256aea1106a2ee9538882dda545d2c979f28cff1483`
  instead of `:latest`, with the resolution method documented in an adjacent
  comment.

**Not run, and not possible in this environment (unchanged from round 1, confirmed
again rather than assumed):**
- Any live/integration test: no HTTP request has ever hit `ingestHttp.ts`, no
  mutation has ever written to a real `telemetry`/`ingestRejections`/`ingestStats`
  table, and `docker compose up` has never been exercised against real containers.
  This reviewer did not re-attempt `docker compose pull`/`up` — the builder's GHCR
  blob-CDN policy-denial finding (T2) is credible, and the fact that the GHCR
  *manifest* API (used only to resolve the digest) is reachable while the *blob*
  CDN is not is a plausible, narrower exception, not evidence the original finding
  was wrong.
- Whether `@convex-dev/rate-limiter` itself is compatible with the self-hosted
  backend image remains genuinely unverified — the hand-rolled fallback continues
  to be judged on its own merits, per this review's brief.

## Issues

**Blocking**
- None.

**Should-fix**
- None. (Round 1's single Should-fix — unguarded `ingestStats.record` calls able
  to override the primary response under contention — is resolved; see "Resolved
  this round" below.)

**Resolved this round (verified, not just trusted):**
- **Unguarded `ingestStats.record` calls (was Should-fix, R16/R17/R22/R25).** Now
  routed through `recordStatsBestEffort` (`backend/ingestHttp.ts:54-65`), which
  `try`/`catch`es the mutation and only logs on failure. Verified all 8 call sites
  use it and none bypass it.
- **`retryAfter` could become `Infinity` at `rate: 0` (was Nice-to-have, R22).**
  `backend/lib/ingestRateLimit.ts:81-85` adds `MAX_RETRY_AFTER_MS` (24h) and
  `clampRetryAfterMs`; `ingestHttp.ts:37` applies it unconditionally in
  `errorResponse`. Verified with the new unit tests
  (`ingestRateLimit.test.ts:90-114`), including a JSON.stringify round-trip
  assertion that the body no longer serializes to `null`.
- **Empty `readings: []` batch was silently accepted (was Nice-to-have).** Now
  rejected as `malformed_payload` (`ingestHttp.ts:121-128`), matching spec.md's
  Terminology ("one or more readings").
- **`docker-compose.yml` backend image still `:latest` (was Nice-to-have).** Now
  pinned to a digest (`docker-compose.yml:14`), matching plan.md's Risks-section
  suggestion, with the resolution command trail left in a comment for future
  re-pins.

**Nice-to-have**
- **R7's "recorded" remains a log line + counter, not a queryable per-attempt
  row.** Confirmed deliberately left as-is per the coordinator's note and round
  1's own conclusion that this is the plan's documented tradeoff (avoiding an
  unauthenticated write-amplification vector), not a builder gap. No action
  needed from the builder; flagged only in case a future stakeholder wants an
  auditable per-failure row, which would be a planner-level conversation.

## Not covered

- **R3's "cannot read telemetry / manage devices / manage users" half** still has
  no meaningful test, because `backend/devices.ts` and `backend/telemetry.ts`
  carry zero auth gating yet (confirmed again this round). This is the spec's own
  acknowledged dependency ordering ("must not require end-user auth to be
  finished first"), not a builder gap — re-verify once `auth-roles` lands its
  `requireAuth`/`requireRole` checks.
- **All end-to-end/integration behavior** (a real HTTP POST reaching
  `ingestHttp.ts`, a real write landing in `telemetry`/`ingestRejections`/
  `ingestStats`, real cron execution, real credential rotation, real rate-limiter
  behavior under concurrent load, real `docker compose up`) has never been
  exercised, in this build or in either review pass, because GHCR blob pulls and
  Convex's anonymous dev-mode endpoint are both policy-blocked in this sandbox.
  What stands in for it: 59/59 passing pure-logic unit tests covering every
  requirement's core logic, plus a real `tsc` typecheck against actually-generated
  Convex types for every call site. This is a materially weaker guarantee than a
  live integration test for a security-hardening feature and should be exercised
  for real the first time an environment with unblocked registry/deployment
  access is available, before this feature is trusted in a real deployment.
