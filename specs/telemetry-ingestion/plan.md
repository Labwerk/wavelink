# Plan: Hardened telemetry ingestion

> Written by planner. HOW, backed by research. No implementation code, no task list.
> Realizes [`spec.md`](./spec.md) R1–R27. Fits the stack fixed by
> [`../foundation/plan.md`](../foundation/plan.md) (self-hosted Convex, Docker Compose,
> `backend/` function root) and coexists with [`../auth-roles/plan.md`](../auth-roles/plan.md).

## Decision summary

Four decisions this plan makes up front, because everything else hangs off them:

1. **Entry point:** a Convex **HTTP Action** (`backend/http.ts` → `POST /ingest/readings`,
   served on the deployment's `.site` origin = port `3211` self-hosted). The existing
   public `ingest.recordBatch` mutation becomes an **`internalMutation`**, which Convex
   does not expose to clients — that is the mechanism for R4.
2. **Credential model: several credentials, one env var.** `INGEST_TOKENS` holds a
   comma-separated list of `<sourceId>.<secret>` tokens. Two tokens sharing a `sourceId`
   = a rotation overlap window (R6); different `sourceId`s = genuinely separate sources
   with separate rate-limit allowances (R23). Resolves spec's *"One credential or
   several"* open question.
3. **Rate limiting: the official `@convex-dev/rate-limiter` component** (v0.4.0,
   token-bucket kind), keyed by `sourceId`, not a hand-rolled limiter. Requires bumping
   `convex` from `^1.17.0` to `^1.46.0` (the component's peer dep is `convex@^1.43.0`).
4. **Rejection records: a dedicated `ingestRejections` table** (one row per rejected
   reading, R13) **plus a per-minute `ingestStats` rollup table** (counters, R25), both
   with a TTL enforced by an hourly cron. Request-level failures (bad credential,
   throttle, oversize) are **counted** in `ingestStats` and **logged** as structured
   console lines rather than getting one row each, so an unauthenticated flood cannot
   convert into unbounded row growth. Resolves spec's *"Where rejection records live"*
   open question.

## Architecture

```
gateway/simulator (container)                       ┌─ env INGEST_TOKENS (deployment env var)
   │ POST {CONVEX_SITE_ORIGIN}/ingest/readings      │  "simulator-1.s3cr3t,simulator-1.n3ws3cr3t"
   │ Authorization: Bearer <sourceId>.<secret>      │
   │ {"readings":[{externalId,ts,metric,value},…]}  │
   ▼                                                │
Convex self-hosted backend, HTTP actions port 3211  │
  backend/http.ts  ── httpRouter()                  │
        ├─ POST /ingest/readings → ingestHttp.ingestReadings (httpAction)
        └─ (later) auth.addHttpRoutes(http)   ← added by auth-roles, same router
                    │
  ┌─────────────────┴───────────────────────────────┴──────────────────────┐
  │ httpAction pipeline — ActionCtx: no ctx.db, has ctx.runMutation        │
  │  1. authenticate(request)  → sourceId | 401 uniform body               │
  │  2. rateLimiter.limit(ctx,"ingestRequests",{key:sourceId,config})      │
  │  3. read body bytes, enforce MAX_PAYLOAD_BYTES, JSON.parse             │
  │  4. enforce MAX_READINGS_PER_BATCH                                     │
  │  5. rateLimiter.limit(ctx,"ingestReadings",{key:sourceId,count:n})     │
  │  6. ctx.runMutation(internal.ingest.recordBatch, {sourceId,batchId,…}) │
  │  7. ctx.runMutation(internal.ingestStats.record, {...}) + console log  │
  │  → 200 {outcome:"accepted",stored,submitted,rejected:[…]}              │
  │  → 401/400/413/429 {outcome:"error",category,retryAfterMs?}            │
  └─────────────────┬──────────────────────────────────────────────────────┘
                    ▼
  internal.ingest.recordBatch  (internalMutation — ONE transaction)
     for each reading: validateReading() → insert telemetry | record rejection
     device lookup cached per externalId (incl. negative results)
     then ONE devices.patch per device: lastSeenAt = max(current, maxAcceptedTs)
                    │
                    ▼
  tables: telemetry, devices, ingestRejections, ingestStats
                    ▲
  backend/crons.ts  ── hourly → internal.ingestStats.prune (TTL + hard row cap)
```

New/changed files (for the builder's orientation only — no code here):

| Path | Change |
|---|---|
| `backend/convex.config.ts` | **new** — `defineApp()` + `app.use(rateLimiter)` |
| `backend/http.ts` | **new** — `httpRouter()`, routes `POST /ingest/readings` |
| `backend/ingestHttp.ts` | **new** — the `httpAction` pipeline above |
| `backend/ingest.ts` | `mutation` → `internalMutation`; validation + monotonic freshness |
| `backend/lib/ingestConfig.ts` | **new** — reads all limits from `process.env` with defaults |
| `backend/lib/ingestAuth.ts` | **new** — parse `INGEST_TOKENS`, constant-time match |
| `backend/lib/ingestValidation.ts` | **new** — pure `validateReading()`, reason codes |
| `backend/ingestStats.ts` | **new** — `record`, `prune`, `summary` (internal) |
| `backend/schema.ts` | **+2 tables** `ingestRejections`, `ingestStats` |
| `backend/crons.ts` | **new** — hourly prune |
| `gateway/simulator/src/index.ts` | HTTP client + auth header + chunking + backoff |
| `docker-compose.yml`, `.env.example`, `README.md` | credential + limits plumbing/docs |

## Tech decisions

| Decision | Choice | Rationale | Rejected alternative |
|---|---|---|---|
| Ingestion entry point | Convex **HTTP Action** at `POST /ingest/readings`, served from `CONVEX_SITE_ORIGIN` (`:3211`) | Matches foundation §8 ("gateway pushes batches via an HTTP Action"). HTTP actions take a raw `Request`, so we own header parsing and can return non-Convex status codes/bodies — required for R15/R16 response shapes. Already exposed by `docker-compose.yml`. | Keeping a public mutation (fails R1/R4); a separate Node sidecar proxy (extra service, extra failure mode, no gain) |
| Old mutation's fate | `ingest.recordBatch` → **`internalMutation`**, called only via `ctx.runMutation` | Convex internal functions "can only be called by other functions and cannot be called directly from a Convex client" — that is exactly R4, enforced by the platform rather than by our code. | Leaving it public and checking a token inside it (any client could still call it; also cannot read HTTP headers) |
| Credential transport | `Authorization: Bearer <sourceId>.<secret>`, compared against `INGEST_TOKENS` | Standard header, works from any HTTP client. The route never calls `ctx.auth`, so a Convex Auth end-user JWT presented here simply fails to match a configured token → R3 holds in both directions. | Custom header (no benefit); query-string token (leaks into logs/proxies); mTLS (out of scope per spec non-goals) |
| One credential or several (**open question resolved**) | **Several.** `INGEST_TOKENS="src.secretA,src.secretB,other.secretC"`; `sourceId` is the rate-limit key and the attribution key | Gives R23 real meaning (per-source allowance), gives targeted revocation, and makes R6 rotation a same-`sourceId` second entry — one mechanism covers both. A single-gateway deployment just configures one entry, so nothing is harder for the simple case. | One shared token (collapses R23 to per-deployment; rotation would need a second env var anyway) |
| Credential comparison | Constant-time compare in plain JS over the UTF-8 bytes, evaluated against **every** configured entry with no early exit; unknown `sourceId` still runs one dummy compare | Prevents prefix/timing oracles and keeps R7's "reveal nothing" true of timing as well as of the body. No dependency on runtime crypto APIs, so it works identically in the Convex default runtime. | `===` (timing oracle); SHA-256 via `crypto.subtle` (fine, but adds a runtime-API dependency for no extra safety here) |
| Config source | Deployment **env vars** read via `process.env` in `backend/lib/ingestConfig.ts`; set with `npx convex env set` (the `push` compose service already has the admin key) | Docs confirm `process.env` works in HTTP actions. Deployment env vars are *not* the backend container's env, so the compose `push` step must set them — writing that down now avoids the classic self-hosted trap. Satisfies R5 (absent ⇒ refuse) and R24 (no code change). | Hardcoded constants (fails R24); a Convex `config` table (needs a write path + admin UI we don't have yet) |
| Rate limiting | **`@convex-dev/rate-limiter` v0.4.0** component, `kind: "token bucket"`, two named limits, `key: sourceId`, **inline `config` built from env at call time** | Official, transactional, storage not proportional to request count, with sharding available later. Token bucket's `capacity` **is** the burst allowance R21 asks for, and `limit()` returns `{ok, retryAfter}` → R22's retry hint for free. Inline config keeps limits env-tunable (R24) rather than frozen at module load. | Hand-rolled bucket in a table (we'd re-implement OCC-safe accounting and sharding); an edge proxy (nginx `limit_req`) — not part of the compose topology and cannot see `sourceId` or reading counts |
| Where rate limiting runs | In the **httpAction** (ActionCtx), before `runMutation` | The component's `limit()` accepts `MutationCtx \| ActionCtx`. Running it in the action means the token spend **commits independently**, so a later validation failure or crash cannot roll back the throttle accounting — the right bias for an abuse control. | Inside the ingest mutation (a failing batch would refund its own rate-limit tokens — a free flood) |
| Argument validation style | Internal mutation takes `readings: v.array(v.any())`; per-reading validation is hand-written | A Convex object validator rejects the **whole** argument when one element is wrong-typed or carries an extra field — that would break partial success (R14) and make R8's per-reading reasons impossible. Hand validation is also what lets us emit stable reason codes. | `v.array(v.object({...}))` (all-or-nothing, incompatible with R14/R15) |
| Where per-reading validation runs | All of it inside the internal mutation | Device existence/active checks need `ctx.db`, which the action doesn't have. Keeping shape/bounds checks next to them avoids two drifting validators and one extra pass over the batch. The action only enforces what it can see: credential, rate, payload bytes, reading count. | Split validation across action + mutation (drift risk, double work) |
| Rejection records (**open question resolved**) | `ingestRejections` row per rejected reading (R13) + `ingestStats` per-minute counters (R25); request-level failures → counters + structured `console.warn`, not one row each | Reading-level rejection volume is already hard-capped by the readings rate limit, so rows/day is bounded and a TTL cron bounds it further. Credential failures are *unauthenticated* — giving them a row each would hand an attacker a write amplifier, so they get a log line (free, visible in the self-hosted dashboard) and a counter. | One row per event for everything (unbounded write/storage DoS); logs only (fails R25's "retrieve counts"); an aggregate component (extra dependency for a 1-doc/minute rollup) |
| Retention | `INGEST_REJECTION_RETENTION_MS` default **7 days**, `INGEST_STATS_RETENTION_MS` default **90 days**; hourly cron deletes in bounded pages and also trims `ingestRejections` to a hard max row count | Answers the spec's "does not let a malicious flood become unbounded storage growth" with two independent bounds (age **and** count), so a burst inside the rate limit still cannot grow without limit. | Never delete (unbounded); delete inline per batch (adds deletes to the latency path) |
| Observability read path | `ingestStats.summary` as an **`internalQuery`** for now (dashboard / `npx convex run`), with a public admin-gated wrapper added when `auth-roles` lands | The spec forbids depending on end-user auth being finished. An internal query adds **no** unauthenticated read surface today, and R25's "an operator can determine" is satisfied via the operator-only dashboard/CLI. | A public query now (new unauthenticated read path, contradicts R3's spirit); waiting for auth-roles (violates the dependency boundary) |
| Response codes | 200 accepted (incl. partial success) · 401 `unauthorized` · 400 `malformed_payload` · 413 `payload_too_large` / `batch_too_large` · 429 `rate_limited` (+ `Retry-After`) · 500 `internal_error` | Status code gives senders a coarse retry/permanent split without parsing; the JSON `category` gives the machine-distinguishable value R16 requires. | Always-200 with a body code (breaks ordinary HTTP client retry logic); bare status codes (R16 wants an explicit category) |

## Data model

### Unchanged

`devices` and `telemetry` keep their current shape and indexes — no migration. Ingestion
still writes `telemetry` rows `{deviceId, ts, metric, value}` and still denormalizes
`devices.status` / `devices.lastSeenAt`, only with the monotonic, once-per-batch rule below.

### New: `ingestRejections` — one row per rejected reading (R13)

| Field | Type | Notes |
|---|---|---|
| `ts` | number | when the rejection happened (server clock) |
| `sourceId` | string | authenticated ingestion source |
| `batchId` | string | groups rejections from one request; minted by the httpAction |
| `index` | number | position in the submitted `readings` array (R15) |
| `reason` | string union | one of the reason codes below |
| `externalId` | optional string | claimed device id, truncated to the length bound |
| `metric` | optional string | claimed metric, truncated |
| `claimedTs` | optional number | only when the payload carried a numeric `ts` |

Indexes: `by_ts` (`["ts"]`) for the prune cron and time-window queries;
`by_reason_and_ts` (`["reason","ts"]`) for the R25 breakdown.

Fields are optional where a malformed payload may not have supplied them — a rejection row
must never itself fail to write because the input was garbage.

### New: `ingestStats` — per-minute counters (R25)

| Field | Type | Notes |
|---|---|---|
| `minuteStart` | number | epoch ms floored to the minute |
| `sourceId` | string | `"unauthenticated"` sentinel for credential failures |
| `readingsAccepted` | number | |
| `readingsRejected` | number | |
| `rejectedByReason` | `record<string, number>` | reason code → count |
| `requestsAccepted` | number | |
| `requestsCredentialFailed` | number | R7/R25 |
| `requestsRateLimited` | number | R22/R25 |
| `requestsOversize` | number | R18 |
| `requestsMalformed` | number | unparseable body |

Index: `by_source_and_minuteStart` (`["sourceId","minuteStart"]`) — one doc is
read-modify-written once **per batch** (never per reading), so contention stays at the
request rate, not the reading rate.

### Rejection reason codes (stable, machine-readable — R15)

| Code | Trigger | Req |
|---|---|---|
| `missing_field` | a required key absent | R8 |
| `unexpected_field` | a key outside `{externalId, ts, metric, value}` | R8 |
| `wrong_type` | key present with the wrong JS type (e.g. boolean value, string ts) | R8 |
| `timestamp_too_far_future` | `ts > now + MAX_FUTURE_SKEW_MS` | R9 |
| `timestamp_too_old` | `ts < now - MAX_BACKFILL_AGE_MS` | R9 |
| `value_not_finite` | numeric value is NaN / ±Infinity | R10 |
| `external_id_too_long` | exceeds `MAX_EXTERNAL_ID_LENGTH` | R10 |
| `metric_too_long` | exceeds `MAX_METRIC_LENGTH` | R10 |
| `string_value_too_long` | exceeds `MAX_STRING_VALUE_LENGTH` | R10 |
| `unknown_device` | no `devices` row with that `externalId` | R11 |
| `inactive_device` | device exists, `isActive === false` | R12 |

Evaluation order per reading is fixed — shape → bounds → timestamp → device — and stops at
the first failure, so exactly one reason is reported per rejected reading and
`stored + rejected.length === submitted` always holds (R13 acceptance).

Request-level failure categories (R16), a disjoint set: `unauthorized`,
`malformed_payload`, `batch_too_large`, `payload_too_large`, `rate_limited`,
`internal_error`.

### Response shape

```
200  {"outcome":"accepted","batchId":"…","submitted":9,"stored":8,
      "rejected":[{"index":4,"reason":"inactive_device","externalId":"sim-agv-01","metric":"temperature_c"}]}
4xx  {"outcome":"error","category":"rate_limited","retryAfterMs":1420}
```

The 401 body is a byte-identical constant (`{"outcome":"error","category":"unauthorized"}`)
for every credential failure regardless of what the request claimed (R7).

### Freshness update rule (R19/R20 — the bug fix)

Today `recordBatch` patches `status`/`lastSeenAt` *inside the loop, from every reading*, so
a late-arriving reading rewinds `lastSeenAt` and an N-reading batch does N patches. New rule,
applied after the whole batch is validated:

- accumulate `maxAcceptedTs` per device from **accepted readings only** (rejected readings
  contribute nothing — R19);
- after the loop, for each device, patch **once** (R19) and only if
  `maxAcceptedTs > (device.lastSeenAt ?? 0)`, setting `lastSeenAt = maxAcceptedTs` and
  `status = "online"`;
- if it would not advance, patch nothing at all — the telemetry row is still stored, but
  neither `lastSeenAt` nor `status` moves (R20).

A device whose readings were all rejected is therefore never touched and goes stale on the
normal schedule, which is the spec's "rejected data must not make a device look fresh" goal.

### Configurable limits and defaults (R24)

All read from deployment env vars; every default below is documented in `.env.example` and
the README, and the README table is the same list the code defaults to.

| Env var | Default | Basis |
|---|---|---|
| `INGEST_TOKENS` | *(unset → all ingestion refused)* | R5: no usable default in the build |
| `INGEST_MAX_READINGS_PER_BATCH` | `500` | Convex allows 16,000 writes/txn but only **1s of user code** per mutation; 500 readings ≈ ≤1,000 writes with wide margin on both |
| `INGEST_MAX_PAYLOAD_BYTES` | `1048576` (1 MiB) | ~20× the 500-reading worst case; far under the 20 MiB HTTP-action ceiling |
| `INGEST_MAX_FUTURE_SKEW_MS` | `120000` (2 min) | absorbs NTP-less gateway clock skew |
| `INGEST_MAX_BACKFILL_AGE_MS` | `604800000` (7 days) | allows gateway store-and-forward after an outage |
| `INGEST_MAX_EXTERNAL_ID_LENGTH` | `128` | ≫ `sim-cnc-01`-style ids |
| `INGEST_MAX_METRIC_LENGTH` | `64` | ≫ `temperature_c` |
| `INGEST_MAX_STRING_VALUE_LENGTH` | `512` | keeps telemetry docs small per foundation §7 |
| `INGEST_REQUESTS_PER_MINUTE` | `120` | simulator does 30/min at the 2s default → 4× headroom |
| `INGEST_REQUEST_BURST` | `60` | token-bucket `capacity` = burst allowance |
| `INGEST_READINGS_PER_MINUTE` | `6000` | simulator does 270/min → ~22× headroom |
| `INGEST_READING_BURST` | `3000` | |
| `INGEST_REJECTION_RETENTION_MS` | `604800000` (7 days) | |
| `INGEST_REJECTION_MAX_ROWS` | `200000` | second, count-based bound |
| `INGEST_STATS_RETENTION_MS` | `7776000000` (90 days) | ≤1 doc/minute/source |

These are "simulator volume plus headroom" as the spec's open question instructs; they are
explicitly provisional until real device counts exist (foundation §14).

### Gateway/simulator changes (R26)

Stops calling `anyApi.ingest.recordBatch` through `ConvexHttpClient` (that path is closed by
R4) and instead `fetch`es the HTTP endpoint with `Authorization: Bearer $INGEST_TOKEN`, using
new env vars `WAVELINK_INGEST_URL` (compose default `http://backend:3211/ingest/readings`),
`WAVELINK_INGEST_TOKEN`, `WAVELINK_MAX_BATCH`. It chunks readings to `WAVELINK_MAX_BATCH`,
logs every `rejected[]` entry it receives, and on 429/5xx/network error backs off
exponentially with jitter (honouring `retryAfterMs` / `Retry-After` when present) up to a
cap, never exiting and never tight-looping. 401/400/413 are logged as configuration errors
and retried at the capped interval, so correcting `INGEST_TOKENS` server-side lets it resume
with no restart.

Its *device registration* step still calls `devices.register` over the Convex client — that
call belongs to `auth-roles` (which gates it to admin) and is deliberately untouched here;
see Risks.

## Requirement coverage

| Req | Addressed by |
|---|---|
| R1 | `backend/http.ts` router + `ingestHttp.ingestReadings` httpAction at `POST /ingest/readings` on `CONVEX_SITE_ORIGIN` (`:3211`); simulator posts to it with no backend-internal access |
| R2 | Step 1 of the pipeline: missing/malformed/unmatched `Authorization: Bearer` → 401 `unauthorized`, returned **before** the body is parsed and before any `runMutation`, so nothing is written |
| R3 | The route never consults `ctx.auth`, so a Convex Auth session token matches no configured `INGEST_TOKENS` entry → 401; and the ingest credential is consumed by this one route only — it is never converted into a Convex identity, so it cannot satisfy `auth-roles`' `requireAuth`/`requireRole` on any other function |
| R4 | `ingest.recordBatch` converted to `internalMutation` (Convex internal functions are not callable from clients); no other public function writes `telemetry` |
| R5 | `INGEST_TOKENS` read from deployment env; empty/unset ⇒ zero configured credentials ⇒ every request 401. No default token value exists in source; `.env.example` ships a placeholder only |
| R6 | `INGEST_TOKENS` is a **list**: two entries with the same `sourceId` are both valid simultaneously (overlap window); removing an entry and re-running `npx convex env set` takes effect on the next request with no restart and no gap |
| R7 | Constant 401 body + constant timing (compare every entry, no early exit, dummy compare on unknown `sourceId`); each failure increments `ingestStats.requestsCredentialFailed` for the minute and emits a structured `console.warn` with timestamp, claimed `sourceId`, `user-agent` and forwarded-for hint |
| R8 | `validateReading()`: required-key presence, exact key-set check (extra key ⇒ `unexpected_field`), and per-field `typeof` checks ⇒ `missing_field` / `unexpected_field` / `wrong_type`. Hand-rolled precisely because a Convex validator would fail the whole array |
| R9 | Timestamp window check against `MAX_FUTURE_SKEW_MS` / `MAX_BACKFILL_AGE_MS` ⇒ `timestamp_too_far_future` / `timestamp_too_old`; non-numeric `ts` is caught earlier as `wrong_type` |
| R10 | Length bounds on `externalId` / `metric` / string `value`, and `Number.isFinite` on numeric values ⇒ `external_id_too_long` / `metric_too_long` / `string_value_too_long` / `value_not_finite` |
| R11 | `by_externalId` lookup inside the mutation (result cached per batch, negative results cached too); miss ⇒ `unknown_device`, and no `devices.insert` exists anywhere on this path |
| R12 | Device found but `isActive === false` ⇒ `inactive_device`, a distinct code checked after existence so the two can never be conflated |
| R13 | Every rejection — all of R8–R12 — inserts an `ingestRejections` row `{ts, sourceId, batchId, index, reason, externalId?, metric?, claimedTs?}` in the same transaction as the accepted inserts; the `continue` in today's loop is deleted. Invariant `stored + rejected.length === submitted` is asserted before responding |
| R14 | Validation is per reading; a rejection records a row and moves on. Accepted readings from other devices are inserted in the same committed transaction |
| R15 | 200 body carries `submitted`, `stored`, and `rejected[]` of `{index, reason, externalId?, metric?}` — `index` is the input-array position and `reason` is from the fixed code list, so no prose parsing |
| R16 | Each request-level failure returns its own status + `category` (`unauthorized`/`malformed_payload`/`batch_too_large`/`payload_too_large`/`rate_limited`/`internal_error`) and returns **before** `runMutation` is ever called, so no partial write is possible |
| R17 | The single `internalMutation` is one Convex transaction — "all database writes get committed together"; `ctx.runMutation` resolves only after that commit, and only then does the action build the 200 response |
| R18 | Action-level guards before the mutation: body byte length vs `INGEST_MAX_PAYLOAD_BYTES` ⇒ 413 `payload_too_large`; `readings.length` vs `INGEST_MAX_READINGS_PER_BATCH` ⇒ 413 `batch_too_large`. The `category` names which bound was hit |
| R19 | Per-device `maxAcceptedTs` accumulated from accepted readings only, then exactly one `devices.patch` per device after the loop; a device with zero accepted readings is never patched |
| R20 | The patch is conditional on `maxAcceptedTs > (lastSeenAt ?? 0)`; otherwise the telemetry row is stored and freshness is left untouched — `lastSeenAt` is monotonic by construction |
| R21 | Two `@convex-dev/rate-limiter` token buckets: `ingestRequests` (requests/min) and `ingestReadings` (`count: readings.length`), each with `rate`/`period`/`capacity`; `capacity` is the configured burst allowance so normal batch bursts pass |
| R22 | A `{ok:false, retryAfter}` from either bucket short-circuits to 429 with `category:"rate_limited"`, `retryAfterMs` in the body and a `Retry-After` header; returned before any mutation, so nothing is written, and the category is distinct from validation/credential failures |
| R23 | Both limits are called with `key: sourceId` from the presented credential, so buckets are per source; saturating one `sourceId` leaves others untouched. This is why the credential model is per-source (Tech decisions) |
| R24 | Every limit above comes from `backend/lib/ingestConfig.ts` reading `process.env`; rate-limit values are passed as **inline `config`** at call time so an env change applies without editing code. Values documented in `.env.example` + README, generated from the same default table |
| R25 | `ingestStats` per-minute rows carry accepted/rejected readings, `rejectedByReason`, credential failures, rate-limited and oversize/malformed request counts; `ingestStats.summary(fromTs,toTs)` aggregates them, plus `ingestRejections` `by_reason_and_ts` for drill-down to individual readings |
| R26 | Simulator rewritten to `fetch` the endpoint with the bearer token, chunk to `WAVELINK_MAX_BATCH`, log every returned rejection, and back off exponentially with jitter (honouring `retryAfterMs`) on 429/5xx/network without exiting or tight-looping; a server-side credential fix resumes it with no restart |
| R27 | README gains an "Ingestion" section: endpoint URL and payload/response shapes, how `INGEST_TOKENS` is generated/set/rotated via the compose `push` service (`npx convex env set`), the full tunable-limits table, and the reason-code list. `.env.example` and `docker-compose.yml` gain `INGEST_TOKENS` + `WAVELINK_INGEST_*` wiring so a clean checkout ingests authenticated batches with no undocumented step |

## Risks & unknowns

- **`convex` must be bumped `^1.17.0` → `^1.46.0`** (root + `gateway/simulator`), because
  `@convex-dev/rate-limiter@0.4.0` peer-depends on `convex@^1.43.0`. `@convex-dev/auth@0.0.95`
  peer-depends on `convex@^1.17.0`, whose caret range admits 1.46, so `auth-roles` is not
  blocked — but the bump touches a shared dependency and should land as its own step with a
  `convex dev` typecheck before anything else in this feature is built.
- **Components on the self-hosted backend image.** The compose file pins
  `ghcr.io/get-convex/convex-backend:latest`, and component support depends on the backend
  build being recent enough. *Mitigation:* first task is a spike — add
  `backend/convex.config.ts` with `app.use(rateLimiter)` and push it; if the push fails,
  fall back to a hand-rolled token bucket in an `ingestRateLimits` table keyed by
  `sourceId` (same call sites, same `{ok, retryAfter}` shape, so only the implementation of
  one module changes). Also pin the backend image to a digest while you're in there — `latest`
  is not reproducible.
- **Deployment env vars ≠ container env vars.** On self-hosted Convex, `process.env` inside
  functions reads *deployment* environment variables, not the `backend` service's Docker env.
  Someone will put `INGEST_TOKENS` in `docker-compose.yml`'s `backend.environment` and it will
  silently not work. *Mitigation:* the `push` service (which already holds the admin key) runs
  `npx convex env set INGEST_TOKENS "$INGEST_TOKENS"` before `convex dev --once`, and the README
  says this explicitly.
- **R7 "each failure is recorded" vs. flood resistance.** Credential failures get a structured
  log line each (unbounded, free) plus a per-minute counter, but not a database row each —
  deliberately, so unauthenticated traffic cannot drive writes. If the reviewer reads R7 as
  requiring a queryable row per failure, the fix is a bounded `ingestAuthFailures` table with
  its own write budget; flag it rather than silently adding an unauthenticated write path.
- **Simulator's `devices.register` bootstrap will break under `auth-roles`.** That plan gates
  `devices.register` to admin, but the simulator calls it unauthenticated at startup. Out of
  scope here (this feature only closes the *telemetry write* path), but it is a real
  cross-feature collision — it needs an admin-run seed step or an internal seeding function.
  Raise with whoever builds `auth-roles`.
- **`backend/http.ts` is shared with `auth-roles`.** Both features add routes to the same
  `httpRouter()`. Whoever lands second must add to the existing file, not replace it
  (`auth.addHttpRoutes(http)` alongside the ingest route).
- **Rate-limit tokens spent in the action are not refunded** if the subsequent mutation throws.
  Intentional (see Tech decisions), but it means a backend-side failure consumes a sender's
  allowance. Acceptable at the chosen headroom; revisit with `reserve` if it ever bites.
- **Counter contention at higher volume.** `ingestStats` is one doc per (minute, source),
  written once per batch. At ~30 batches/min/source that is trivial; with many sources or much
  faster batching, OCC conflicts become possible. *Mitigation path:* shard the counter doc the
  way the rate limiter shards buckets, or move to an aggregate component. Not needed for v1.
- **Default limits are guesses with headroom.** Sized from the simulator (9 readings / 2 s),
  not from real device counts, which foundation §14 still lists as unknown. They are env-tunable
  by design; re-derive them when a real device population exists.
- **Duplicate readings on retry remain accepted** (spec's own unresolved item): backoff/retry in
  the simulator plus all-or-nothing request failures means an ambiguous timeout can double-write.
  v1 accepts this; a `(deviceId, metric, ts)` dedup index or idempotency key is the follow-up.
- **`docs.convex.dev` is unreachable from this environment** (egress-blocked), so every Convex
  claim above is cited from the docs' source in `get-convex/convex-backend` or from the package
  registry instead. The builder should re-verify API details against the installed package
  version rather than against this plan if anything fails to typecheck.

## Sources

- HTTP actions (definition, `httpRouter`, `.site` origin, raw `Request`, no arg validation, 20 MB limit) — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/docs/docs/functions/http-actions.mdx>
- `HttpRouter.route` / `httpRouter()` signatures and routable methods — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/server/router.ts>
- Internal functions "can only be called by other functions and cannot be called directly from a Convex client" (R4) — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/docs/docs/functions/internal-functions.mdx>
- Mutations run transactionally; all writes commit together (R17) — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/docs/docs/functions/mutation-functions.mdx>
- Actions: `ctx.runMutation`, separate transactions per call, no automatic retry — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/docs/docs/functions/actions.mdx>
- Environment variables: `npx convex env set`, `process.env.KEY` in functions and HTTP actions, `CONVEX_SITE_URL` — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/docs/docs/production/environment-variables.mdx>
- Limits: 32,000 docs scanned / 16 MiB read / 16,000 docs written / 16 MiB written per transaction, 1 s user-code limit for queries & mutations — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/docs/docs/production/state/limits.mdx>
- Backend knobs confirming those defaults (`TRANSACTION_MAX_NUM_USER_WRITES`, `TRANSACTION_MAX_USER_WRITE_SIZE_BYTES`, `MAX_BACKEND_PUBLIC_API_REQUEST_SIZE`, `DATABASE_UDF_USER_TIMEOUT`) — <https://raw.githubusercontent.com/get-convex/convex-backend/main/crates/common/src/knobs.rs>
- Rate limiter component README: install, `app.use(rateLimiter)`, token bucket vs fixed window, `key`/`count`/`throws`/`reserve`/`config`, `{ok, retryAfter}`, sharding — <https://raw.githubusercontent.com/get-convex/rate-limiter/main/README.md>
- Rate limiter client source confirming `limit()` accepts `MutationCtx | ActionCtx` (so it is callable from an HTTP action) — <https://raw.githubusercontent.com/get-convex/rate-limiter/main/src/client/index.ts>
- `@convex-dev/rate-limiter` **v0.4.0**, peer dep `convex@^1.43.0` — <https://registry.npmjs.org/@convex-dev/rate-limiter/latest>
- `convex` current version **1.46.0** (engines: node >= 20) — <https://registry.npmjs.org/convex/latest>
- `@convex-dev/auth` **0.0.95**, peer dep `convex@^1.17.0` (compatibility check for the bump) — <https://registry.npmjs.org/@convex-dev/auth/latest>
- Cron jobs: `cronJobs()` in `convex/crons.ts`, `crons.interval(...)` — <https://raw.githubusercontent.com/get-convex/convex-backend/main/npm-packages/convex/src/server/cron.ts>
- Self-hosted topology: backend on 3210, HTTP actions on 3211, `CONVEX_CLOUD_ORIGIN` vs `CONVEX_SITE_ORIGIN` — <https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/advanced/hosting_on_own_infra.md> and <https://raw.githubusercontent.com/get-convex/convex-backend/main/self-hosted/README.md>
- Convex Auth adds its routes to the shared `httpRouter` via `auth.addHttpRoutes(http)` (coexistence with the ingest route) — <https://raw.githubusercontent.com/get-convex/convex-auth-example/main/convex/http.ts>

---

## Summary

Ingestion moves behind a Convex HTTP Action on the `.site` origin that authenticates a
`<sourceId>.<secret>` bearer token from a rotatable `INGEST_TOKENS` list, rate-limits per
source with the official `@convex-dev/rate-limiter` token buckets, then hands the batch to
the old `recordBatch` — now an `internalMutation` — which validates every reading, stores the
good ones, rows every rejection with a stable reason code, and advances each device's
`lastSeenAt` at most once per batch and never backwards.
Observability lands in two new tables (`ingestRejections` per rejected reading,
`ingestStats` per-minute counters) with age- and count-bounded retention, while
unauthenticated failures are logged and counted rather than rowed, so a flood cannot grow
storage.
All 27 requirements are covered above; the main build risks are a required `convex`
`^1.17 → ^1.46` bump for the rate-limiter component and confirming that the self-hosted
backend image accepts components at all.

### Please confirm before building

1. **Multiple per-source credentials** (`INGEST_TOKENS` as a list of `<sourceId>.<secret>`)
   rather than one shared token — this is the deployment-model call the spec left open, and
   it decides whether R23's per-source limits are real or nominal.
2. **The `convex` upgrade to `^1.46.0` across the workspace** (and pinning the
   `convex-backend` image to a digest), accepted as this feature's first task, with the
   hand-rolled-limiter fallback if components don't push to the self-hosted backend.
3. **Credential failures are logged + counted, not stored one row each** (R7), as the
   deliberate anti-flood tradeoff — say so now if an auditable per-failure row is required.
4. **Provisional default limits** (500 readings/batch, 1 MiB payload, 120 req/min,
   6,000 readings/min per source, 7-day rejection retention) — sized off the simulator with
   headroom, to be re-derived when real device counts exist.
