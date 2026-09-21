# wavelink

Realtime dashboard for monitoring industrial robots/machines, built on [Convex](https://convex.dev).

> 📄 Full spec: [`specs/foundation/spec.md`](specs/foundation/spec.md) · Build plan: [`specs/foundation/plan.md`](specs/foundation/plan.md) · SDD workflow: [`specs/README.md`](specs/README.md)

## Status

| Feature | State |
|---|---|
| Schema, live device/telemetry view, telemetry simulator | ✅ Working |
| Device registry — connectivity state, filtering/grouping, admin management UI, audit trail | ✅ Working ([details](specs/device-registry/)) |
| Auth & roles — invite-only accounts, server-side RBAC, audit log | ✅ Working ([details](#authentication)) |
| Hardened telemetry ingestion — authenticated, validated, rate-limited, observable | ✅ Working ([details](#ingestion)) |
| Alerting, historical playback, production deployment profile | ⬜ Not started |

See the [foundation plan](specs/foundation/plan.md) for what each milestone covers, and
[`specs/auth-roles/`](specs/auth-roles/) / [`specs/telemetry-ingestion/`](specs/telemetry-ingestion/) /
[`specs/device-registry/`](specs/device-registry/) for each feature's spec, plan and review.

## Architecture

```mermaid
flowchart LR
    SIM["Telemetry Simulator<br/>gateway/simulator/"]

    subgraph BE["Convex Backend — backend/"]
        FN["Functions & Schema"]
        DB[("Realtime Database")]
    end

    FE["Next.js Dashboard<br/>frontend/"]
    Browser["Browser<br/>(operator / admin / viewer)"]

    SIM -- "POST /ingest/readings\n(Authorization: Bearer)" --> FN
    FN <--> DB
    DB -- "live subscription\n(no polling)" --> FE
    FE --> Browser
    Browser -- "queries & mutations" --> FN
```

`backend/` runs as either a **Convex Cloud dev deployment** (Quickstart, no Docker) or a **self-hosted Convex container** (Docker deployment, below) — same schema and functions either way, just a different `CONVEX_URL` for the frontend and simulator to point at.

## Project layout

| Path | What it is |
|---|---|
| `backend/` | Convex schema (`schema.ts`) + functions. Convex CLI commands run from the **repo root**, which finds this folder via `convex.json`. |
| `frontend/` | Next.js dashboard app. Imports generated types from `../backend/_generated/`. |
| `gateway/simulator/` | Standalone telemetry simulator — stands in for a real device-protocol adapter until one is built. |
| `tests/` | Backend function tests (`convex-test` + Vitest). Kept outside `backend/` so test-only tooling never risks being bundled into a deployment. Run with `npm test`. |
| `specs/` | SDD artifacts, one folder per feature (`spec.md` → `plan.md` → `tasks.md` → `review.md`). See [`specs/README.md`](specs/README.md). Foundation docs live in [`specs/foundation/`](specs/foundation/). |
| `.claude/agents/` | The four SDD agents (spec-writer, planner, builder, reviewer) that drive the workflow. |

## Development workflow (Spec-Driven Development)

Features are built through four specialized agents in [`.claude/agents/`](.claude/agents/),
each with its own isolated context, handing off to the next through files under
`specs/<feature-slug>/`:

```
spec-writer  ──spec.md──▶  planner  ──plan.md──▶  builder  ──tasks.md + code──▶  reviewer  ──review.md
   WHAT / WHY              HOW + web research      break down + implement          verify vs spec
```

| Agent | Produces | Can it touch code? |
|---|---|---|
| `spec-writer` | `spec.md` — goals, non-goals, user stories, numbered requirements `R1…Rn` | No (read/write docs only) |
| `planner` | `plan.md` — architecture, tech decisions, data model, sources; **researches the web** | No (docs + web only) |
| `builder` | `tasks.md` then the implementation, one task at a time with tests | Yes (only agent with shell) |
| `reviewer` | `review.md` — PASS/FAIL, per-requirement coverage, test results | No (read-only on source) |

**Load the agents** (after cloning, or when they change): run `/agents` in Claude
Code, or restart the session.

**Run a feature** — review the output file between each step:

```
Use the spec-writer subagent for: <feature idea>
Use the planner subagent for specs/<feature-slug>
Use the builder subagent for specs/<feature-slug>
Use the reviewer subagent for specs/<feature-slug>
```

If the reviewer returns FAIL or PASS WITH ISSUES, hand `review.md` back to the
builder, fix, and review again — that loop is the quality gate.

**Start a new feature** by copying the templates:

```sh
cp -r specs/_template specs/<feature-slug>
```

Full details and the artifact convention live in [`specs/README.md`](specs/README.md).

## Prerequisites

- Node.js 20+ and npm
- A free [Convex](https://dashboard.convex.dev) account (only for Quickstart — `npx convex dev` prompts a browser login on first run)
- Docker Desktop with Compose v2 (only for the "Docker deployment" section)

## Quickstart

No Docker needed — the backend runs as a free Convex Cloud dev deployment.

**1. Install everything** (root `npm install` covers `frontend/` and `gateway/simulator/` too, via npm workspaces):

```sh
npm install
```

**2. Start backend + frontend together:**

```sh
npm run dev
```

First run opens a browser to log in and link a Convex project. This single command runs both:
- `backend`: `convex dev` — watches `backend/`, pushes schema/function changes live, generates `backend/_generated/`
- `frontend`: `next dev` — the dashboard at [http://localhost:3000](http://localhost:3000)

> If `frontend/.env.local` doesn't already have the right `NEXT_PUBLIC_CONVEX_URL`, copy it from `frontend/.env.local.example` and set it to the `CONVEX_URL` printed by step 2 above, then restart `npm run dev`.

**3. One-time auth setup** — the dashboard requires signing in ([details](#authentication)). Run all of this **once per deployment**:

```sh
# a) signing keys — interactive, asks before overwriting
npx @convex-dev/auth --web-server-url http://localhost:3000

# b) the admin bootstrap variable this app adds
npx convex env set INITIAL_ADMIN_EMAIL you@example.com
```

Everything above is stored *on the Convex deployment* (via `npx convex env set`), not
in a file in the repo — so there's no secret to accidentally commit. Step (a) sets
`JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` against whichever deployment `npm run dev`
linked in step 2.

**4. Create the first admin** — accounts are invite-only, so the first one is made from
the CLI ([why](#first-admin-bootstrap)):

```sh
npx convex run users:bootstrapAdmin '{"email":"you@example.com","password":"<choose, 8+ chars>"}'
```

Then sign in at [http://localhost:3000](http://localhost:3000). From there you can create
other accounts under **Manage users**.

**5. (Optional) seed live data**, in a separate terminal — the simulator posts authenticated
batches to the ingestion HTTP endpoint (see [Ingestion](#ingestion) below) rather than calling
a backend mutation directly, so it needs a credential:

```sh
# One-time: give the deployment a credential (skip if already set)
npx convex env set INGEST_TOKENS "simulator.$(openssl rand -hex 24)"

cd gateway/simulator
WAVELINK_INGEST_URL=<same URL as step 2, with .convex.cloud replaced by .convex.site>/ingest/readings \
WAVELINK_INGEST_TOKEN=<the same simulator.<secret> value you just set> \
npm run dev
```

> ⚠️ The simulator does **not** register devices, since `devices.register` is admin-only.
> Sign in as your admin first and register `sim-cnc-01`, `sim-agv-01` and `sim-arm-01` via
> **Register device**. (Telemetry posted for a device that doesn't exist yet is rejected
> with reason `unknown_device` and recorded — not stored, but not silently dropped either;
> see [Ingestion](#ingestion).)

That's it for day-to-day development. Use **Docker deployment** below only when you need to test the self-hosted path itself.

**Run the backend test suite** (Convex functions, via [`convex-test`](https://www.npmjs.com/package/convex-test) + [Vitest](https://vitest.dev), no running deployment needed):

```sh
npm test
```

<details>
<summary><strong>Running backend/frontend separately instead of <code>npm run dev</code></strong></summary>

```sh
# terminal 1 — backend
npx convex dev

# terminal 2 — frontend
cd frontend && npm run dev

# terminal 3 (optional) — simulator (see step 3/5 above for setup)
cd gateway/simulator && \
WAVELINK_INGEST_URL=<terminal 1's URL, .convex.cloud -> .convex.site>/ingest/readings \
WAVELINK_INGEST_TOKEN=<sourceId>.<secret> \
npm run dev
```

</details>

## Docker deployment

Runs everything against a **self-hosted** Convex backend instead of Convex Cloud — use this to verify the self-hosted path, or as a base for a self-hosted production deploy. Not needed for day-to-day development.

**1. Set up env** (one-time):

```sh
cp .env.example .env
# set INSTANCE_SECRET in .env, e.g. via: openssl rand -hex 32
# set INITIAL_ADMIN_EMAIL — the `push` service copies it onto the Convex
# deployment (see "One-time auth setup" below)
# set INGEST_TOKENS and WAVELINK_INGEST_TOKEN in .env to the same value,
# e.g.: TOKEN="simulator.$(openssl rand -hex 24)"; then set both vars to
# "$TOKEN" — see the Ingestion section below. Only needed if you'll run the
# simulator profile in step 5; the dashboard and frontend work without it.
```

**2. Start everything:**

```sh
docker compose up
```

That's it. Under the hood, `backend` generates its own admin key on startup and a one-shot `push` service uses it to push `backend/`'s schema/functions automatically — no manual key copying or separate push command. `frontend` waits for `push` to finish before it starts. Open [http://localhost:3000](http://localhost:3000).

**3. One-time auth setup** — same as Quickstart step 3, but pointed at the self-hosted
backend. `INITIAL_ADMIN_EMAIL` and `INGEST_TOKENS` already came from `.env` via
the `push` service in step 1, so only the signing keys are left:

```sh
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=$(docker compose exec backend cat /convex/data/admin_key.txt)
npx @convex-dev/auth --web-server-url http://localhost:3000
```

**4. Create the first admin** — same command as Quickstart step 4 (the two `export`s
above must still be set in your shell):

```sh
npx convex run users:bootstrapAdmin '{"email":"you@example.com","password":"<choose, 8+ chars>"}'
```

**5. (Optional) seed live telemetry**, in a separate terminal:

```sh
docker compose --profile simulator up simulator
```

Posts a telemetry batch every `SIMULATOR_INTERVAL_MS` (default 2s) to the backend's
HTTP-actions port (3211) using `WAVELINK_INGEST_TOKEN`.

> ⚠️ Same caveat as Quickstart step 5: registering devices is admin-only, so sign in
> and add the demo devices from the dashboard first, then watch telemetry update live.

> **Upgrading an existing environment:** this version removes the `users.authId` column (the row's own id is now the identity), which breaks any deployment that already holds user rows. There is no migration because the table has only ever held dev data — reset with `docker compose down -v` (Docker) or clear the `users`/`auth*` tables from the Convex dashboard (Cloud dev deployment), then run the first-admin bootstrap again.

<details>
<summary><strong>What's actually happening on <code>docker compose up</code></strong></summary>

1. `backend` starts, generates its own admin key (deterministic given `INSTANCE_NAME`/`INSTANCE_SECRET`), writes it to the shared `convex-data` volume.
2. `push` (one-shot) waits for that key, sets `INGEST_TOKENS` as a *deployment* env var via `npx convex env set` (if you configured it in `.env`), then runs `npx convex dev --once` against the backend — pushes `backend/schema.ts` + functions, writes `backend/_generated/` back to the repo on disk (it bind-mounts the repo, same as `frontend` does).
3. `frontend` waits for `push` to exit successfully, then starts — by then `backend/_generated/` already exists, so it compiles cleanly on the first request.
4. `dashboard` just waits for `backend` to be healthy.

</details>

<details>
<summary><strong>Running the old manual steps instead</strong></summary>

```sh
docker compose up -d backend dashboard
npm install
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=<run: docker compose exec backend ./generate_admin_key.sh>
npx convex dev --once
docker compose up frontend
```

</details>

## Convex dashboard (dev tool)

Schema/data inspection and function logs — *not* the product's own operator dashboard:

| Flow | URL |
|---|---|
| Quickstart (Convex Cloud) | [dashboard.convex.dev](https://dashboard.convex.dev), under your linked project |
| Docker deployment (self-hosted) | [http://localhost:6791](http://localhost:6791) once `docker compose up` is running |

The self-hosted dashboard prompts for an **admin key** to log in. `backend` generates one automatically on startup (that's what `push` also uses internally), but doesn't print it anywhere — fetch it with:

```sh
docker compose exec backend cat /convex/data/admin_key.txt
```

Regenerates fresh each time you start from a clean volume (`docker compose down -v`).

## Ingestion

Telemetry reaches the backend through one authenticated HTTP endpoint — the gateway/simulator posts batches to it; there is no other way to write telemetry from outside the deployment (`backend/ingest.ts`'s mutation is `internal`, unreachable from any client).

**Endpoint:** `POST {CONVEX_SITE_ORIGIN}/ingest/readings` (self-hosted default `http://127.0.0.1:3211/ingest/readings`; on Convex Cloud, the same subdomain as your deployment URL with `.convex.cloud` replaced by `.convex.site`).

**Request:**

```
POST /ingest/readings
Authorization: Bearer <sourceId>.<secret>
Content-Type: application/json

{"readings":[{"externalId":"sim-cnc-01","ts":1700000000000,"metric":"temperature_c","value":54.2}, ...]}
```

**Response (200, partial success is normal):**

```json
{"outcome":"accepted","batchId":"…","submitted":9,"stored":8,
 "rejected":[{"index":4,"reason":"inactive_device","externalId":"sim-agv-01","metric":"temperature_c"}]}
```

**Response (4xx, request-level failure — nothing was written):**

```json
{"outcome":"error","category":"rate_limited","retryAfterMs":1420}
```

| Status | `category` | Meaning |
|---|---|---|
| 401 | `unauthorized` | Missing, malformed, or non-matching credential. Body is byte-identical for every cause. |
| 400 | `malformed_payload` | Body isn't valid JSON, or has no `readings` array. |
| 413 | `batch_too_large` / `payload_too_large` | Over `INGEST_MAX_READINGS_PER_BATCH` or `INGEST_MAX_PAYLOAD_BYTES`. |
| 429 | `rate_limited` | Over the per-source rate limit; retry after `retryAfterMs` (also sent as `Retry-After`). |
| 500 | `internal_error` | Unexpected failure; safe to retry. |

**Reading-level rejection reasons** (one per rejected reading, in the 200 response's `rejected[]` and in the `ingestRejections` table):

| Reason | Cause |
|---|---|
| `missing_field` | A required key (`externalId`, `ts`, `metric`, `value`) is absent, or an identifier is an empty string. |
| `unexpected_field` | A key outside `{externalId, ts, metric, value}`. |
| `wrong_type` | A field has the wrong JS type (e.g. boolean `value`, string `ts`, non-finite `ts`). |
| `timestamp_too_far_future` | `ts` is more than `INGEST_MAX_FUTURE_SKEW_MS` ahead of server time. |
| `timestamp_too_old` | `ts` is older than `INGEST_MAX_BACKFILL_AGE_MS`. |
| `value_not_finite` | Numeric `value` is `NaN` or ±Infinity. |
| `external_id_too_long` / `metric_too_long` / `string_value_too_long` | Exceeds the configured length bound. |
| `unknown_device` | No registered device has that `externalId` (ingestion never auto-creates devices). |
| `inactive_device` | The device exists but has been deactivated. |

### Credential setup and rotation

`INGEST_TOKENS` is a comma-separated list of `<sourceId>.<secret>` entries, set as a **deployment** environment variable (not the `backend` container's OS env — see the comment in `docker-compose.yml`'s `push` service). With it unset or empty, every ingestion request is refused.

```sh
# Generate a token and set it (self-hosted: via the push service and .env —
# see Docker deployment above; Quickstart / Convex Cloud: directly)
npx convex env set INGEST_TOKENS "simulator.$(openssl rand -hex 24)"
```

Multiple entries are comma-separated (`"simulator.secretA,gateway-2.secretB"`); two entries sharing a `sourceId` are both accepted at once, which is how you rotate a credential without downtime:

```sh
# 1. Add the new value alongside the old one (both work now)
npx convex env set INGEST_TOKENS "simulator.oldSecret,simulator.newSecret"
# 2. Switch senders over to simulator.newSecret
# 3. Retire the old one (old stops working immediately, no gap for the new one)
npx convex env set INGEST_TOKENS "simulator.newSecret"
```

Each `sourceId` also gets its own rate-limit allowance (below), so one misbehaving source can't consume another's.

### Tunable limits

All deployment-configurable via env vars (`backend/lib/ingestConfig.ts`), no code change required. Defaults are sized from the bundled simulator's volume with headroom; revisit once real device counts are known (see `specs/telemetry-ingestion/plan.md`).

| Env var | Default | What it bounds |
|---|---|---|
| `INGEST_MAX_READINGS_PER_BATCH` | `500` | Readings per request. |
| `INGEST_MAX_PAYLOAD_BYTES` | `1048576` (1 MiB) | Request body size. |
| `INGEST_MAX_FUTURE_SKEW_MS` | `120000` (2 min) | How far a timestamp may be ahead of server time. |
| `INGEST_MAX_BACKFILL_AGE_MS` | `604800000` (7 days) | How old a timestamp may be. |
| `INGEST_MAX_EXTERNAL_ID_LENGTH` | `128` | Device external-id length. |
| `INGEST_MAX_METRIC_LENGTH` | `64` | Metric name length. |
| `INGEST_MAX_STRING_VALUE_LENGTH` | `512` | String telemetry value length. |
| `INGEST_REQUESTS_PER_MINUTE` | `120` | Per-source request rate. |
| `INGEST_REQUEST_BURST` | `60` | Per-source request burst allowance. |
| `INGEST_READINGS_PER_MINUTE` | `6000` | Per-source reading-throughput rate. |
| `INGEST_READING_BURST` | `3000` | Per-source reading-throughput burst allowance. |
| `INGEST_REJECTION_RETENTION_MS` | `604800000` (7 days) | How long `ingestRejections` rows are kept. |
| `INGEST_REJECTION_MAX_ROWS` | `200000` | Secondary, count-based cap on `ingestRejections` (see note below). |
| `INGEST_STATS_RETENTION_MS` | `7776000000` (90 days) | How long `ingestStats` per-minute counters are kept. |

> `INGEST_REJECTION_MAX_ROWS` is only *exactly* enforced when set below ~4000 — Convex transactions cap how many documents one query can scan, which is well under realistic large values of this cap. Age-based retention (`INGEST_REJECTION_RETENTION_MS`) is the primary, always-exact bound; the row cap is a secondary backstop. See `specs/telemetry-ingestion/tasks.md`'s Deviations section for the full reasoning.

### Observability

Accepted/rejected/throttled counts are queryable (not yet a public dashboard — see `specs/telemetry-ingestion/plan.md`'s "Observability read path" decision):

```sh
npx convex run ingestStats:summary '{"fromTs": 0, "toTs": 9999999999999}'
```

## Authentication

Signing in is required to see anything. Accounts are email + password via
[Convex Auth](https://labs.convex.dev/auth) — self-hosted, no external identity
provider. Full design: [`spec.md`](specs/auth-roles/spec.md) · [`plan.md`](specs/auth-roles/plan.md).

### Who can do what

Each role includes everything the ones above it can do.

| Role | Adds |
|---|---|
| `viewer` | View dashboards and history |
| `operator` | + Acknowledge alerts, add notes |
| `maintenance` | + History export, device diagnostics |
| `admin` | + Manage devices, alert rules, and users |

The role → capability map is a single table in `backend/lib/permissions.ts`.
(Alerts and history don't exist yet, so today only `admin` is behaviourally
distinct from `viewer`.)

### Getting an account

**Invite-only — there is no public sign-up.** It's disabled at the provider
(`backend/lib/provisioning.ts`) and the sign-in page offers no sign-up option.

An admin creates accounts from **Manage users → Create user**, handing over a
temporary password out-of-band. New accounts always start as `viewer`; an admin
promotes from there. The very first admin is a special case — see
[First admin](#first-admin-bootstrap) below.

An admin can also deactivate/reactivate accounts there (`users.setActive`), taking
effect on that user's next call. Guard rails: you can't deactivate yourself, and
neither `setActive` nor `setRole` will remove the last active admin.

### Where it's enforced

**Server-side, deny-by-default.** Protected functions are declared with
`authedQuery`/`authedMutation`/`authedAction` (`backend/lib/functions.ts`), each
requiring a capability. The role is read from the stored user row on every single
call — never from the client.

Two things back that up:

- A meta-test over `backend/**` fails if an exported function uses a raw
  `query`/`mutation`/`action` without being on the explicit allow-list in
  `backend/lib/publicEntryPoints.ts` — so a new function can't accidentally ship unguarded.
- The UI only *hides* controls (`users.me` → `capabilities`), and `frontend/proxy.ts`
  (Next.js 16's renamed `middleware.ts`) only *redirects* signed-out visitors to
  `/signin`. Neither is a security boundary; calling the backend directly still gets refused.

Every denial returns the same generic error, so a refused request never reveals
whether the thing you asked for exists.

### Who did what (audit log)

Every state change — role change, activate/deactivate, user creation, device
register/update/deactivate, first-admin bootstrap — appends a row to the `auditLog`
table recording who, what, which target, and when. Admins see recent entries on the
**Manage users** page.

The row is written **in the same transaction** as the change itself, so nothing can
happen unattributed. That holds for account creation too: the role decision and audit
row are written inside Convex Auth's `createOrUpdateUser` callback, atomically with the
account insert.

> One exception: `users:setPassword` (see [Break-glass](#break-glass-operations-deployment-admin-key-only))
> has no acting user, so its row carries no `actorId` and is marked
> `via: deployment-admin-key` — and it's written just after the credential change
> rather than atomically.

Alert acknowledgement will record `acknowledgedBy`/`acknowledgedAt` plus an audit row
once alerting ships.

### Ingestion is not a user

The gateway/simulator posts to `POST /ingest/readings` (the HTTP-actions URL) with
`Authorization: Bearer <sourceId>.<secret>`, a credential drawn from `INGEST_TOKENS`. It
holds a *service* credential, not a role — user sessions and the four roles have nothing
to do with it, and a user's session token simply fails to match any configured ingestion
token if presented here.

`ingest.recordBatch` is an internal mutation, so no user session can call it at all — the
only way in is the authenticated HTTP endpoint. A missing, malformed, or non-matching
credential gets a uniform `401`; if `INGEST_TOKENS` is unset or empty, everything is
rejected. Full detail — request/response shapes, credential rotation, rate limiting,
rejection reasons — is in [Ingestion](#ingestion) above.

### First admin (bootstrap)

Sign-up is invite-only and only an admin can invite — so a fresh deployment, which has
no admin yet, would deadlock. A one-time **internal** function breaks that tie:

```sh
npx convex env set INITIAL_ADMIN_EMAIL you@example.com     # once per deployment
npx convex run users:bootstrapAdmin '{"email":"you@example.com","password":"<choose, 8+ chars>"}'
```

It is not callable from the browser or by any client — it runs only through the Convex
CLI, holding the **deployment admin key**. That key, not the email address, is what
protects first-admin creation:

- **Quickstart (Convex Cloud):** `npm run dev` already logged in and linked the CLI, so
  the two commands above are all you need.
- **Docker (self-hosted):** export the admin key first, then run the same two commands:
  ```sh
  export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
  export CONVEX_SELF_HOSTED_ADMIN_KEY=$(docker compose exec backend cat /convex/data/admin_key.txt)
  ```

`INITIAL_ADMIN_EMAIL` and the "no users exist yet" rule are **defence in depth, not the
security boundary** — they stop an operator from bootstrapping the wrong account on a
deployment that's already in use. Both are re-checked inside the account-creation
transaction, where the `admin` role and the audit row are written atomically with the
account: it either completes fully or leaves nothing behind.

Then sign in at [http://localhost:3000](http://localhost:3000).

### Break-glass operations (deployment admin key only)

There is no email channel, so there is no self-service password reset. These internal functions are the recovery paths; there is no UI for them.

```sh
# Forgotten password (admin or anyone): replaces the credential, signs the user out everywhere, audited
npx convex run users:setPassword '{"email":"someone@example.com","newPassword":"<8+ chars>"}'

# A deployment that holds exactly ONE user, who is not an admin (e.g. a half-finished bootstrap
# from before bootstrap became atomic, or a restore): promote them. Refuses otherwise.
npx convex run users:promoteBootstrapAdmin '{"userId":"<users _id>"}'
```

For a dev environment the simpler recovery is a reset (`docker compose down -v`) followed by the bootstrap again.

### Session policy

| | |
|---|---|
| Access token (JWT) | 1 hour, refreshed automatically |
| Idle timeout | 8 hours |
| Hard cap | 7 days, then sign in again |
| Browser cookie | Session cookie — closing the browser signs you out |

Page reloads keep the session. Role changes and deactivation take effect on the very
next call, because the role is read from the database rather than the token.
Configured in `backend/auth.ts` and `frontend/proxy.ts`.

> **Pinned dependency:** `@convex-dev/auth` is pinned to exactly `0.0.95`. On that
> version, an expired or invalid session made the proxy answer `200` + a `location`
> header (i.e. a blank page) instead of redirecting, so
> `frontend/lib/normalizeRedirect.ts` restores a real 307 to `/signin`. Re-verify that
> workaround before upgrading the library.

### Role-change notification

None in v1 (no email infrastructure). The change is visible immediately instead: `users.me` is a live query, so the affected user's role badge and controls update within about a second without a reload, and admins can see who changed whom and when in the audit list.

### Tests

Run `npm test` (Vitest + `convex-test`). It covers:

- **Access control** — per-role allow/deny for all four roles, capability inheritance
  against the spec table, deny-by-default (unknown capability, plus the meta-test over
  `backend/**`), and non-leakage (forbidden-existing vs. non-existent target).
- **User management** — `setRole` authorization, last-admin protection, audit rows,
  `setActive`, `setPassword` and recovery.
- **Account creation** — sign-up blocked, default role `viewer`, first-admin bootstrap,
  admin provisioning, and atomicity (forged `createdBy`, forged role, and missing
  creator are all rejected leaving nothing behind).
- **Ingestion** — the full `POST /ingest/readings` pipeline (credential match/rotation,
  partial success, every rejection reason, rate limiting, freshness monotonicity) via
  `convex-test`'s `t.fetch(...)`, which actually executes the httpAction end to end — see
  [Ingestion](#ingestion) above and `tests/ingest.test.ts`.
- **Everything else** — the proxy redirect fix.

> `convex-test` can't sign real JWTs, so the browser path (sign in → reload → sign out)
> and the UI gating are a **manual** smoke check:
> [`specs/auth-roles/smoke-checklist.md`](specs/auth-roles/smoke-checklist.md).

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `INSTANCE_NAME` | backend | Name for this Convex deployment instance. |
| `INSTANCE_SECRET` | backend | Secret key for the instance (`openssl rand -hex 32`). |
| `CONVEX_CLOUD_ORIGIN` | backend, frontend | Public URL clients use to reach the Convex API. Defaults to `http://127.0.0.1:3210`. |
| `CONVEX_SITE_ORIGIN` | backend | Public URL for Convex HTTP actions. Defaults to `http://127.0.0.1:3211`. |
| `DO_NOT_REQUIRE_SSL` | backend (local dev only) | Relaxes SSL requirement for local Postgres connections. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres (`--profile production` only) | Production storage credentials. Unused with the default SQLite setup. |
| `SIMULATOR_INTERVAL_MS` | simulator (`--profile simulator` only) | How often the simulator posts a telemetry batch, in ms. |
| `INITIAL_ADMIN_EMAIL` | Convex deployment (`npx convex env set`; Docker `push` copies it from `.env`) | The email the first-admin bootstrap will accept, and only while no users exist. Defence in depth; the deployment admin key is what protects `users:bootstrapAdmin`. |
| `JWT_PRIVATE_KEY` / `JWKS` / `SITE_URL` | backend (Convex Auth) | Signing key pair + your web app's URL, set **on the Convex deployment itself** via `npx @convex-dev/auth` (see [Authentication](#authentication)) — never stored in a `.env` file or committed. |
| `INGEST_TOKENS` | backend (deployment env, set by `push`) | Ingestion credential(s) — see [Ingestion](#ingestion) above. Unset/empty refuses all ingestion. |
| `WAVELINK_INGEST_TOKEN` | simulator | One `<sourceId>.<secret>` entry from `INGEST_TOKENS`, used to authenticate. |
| `WAVELINK_INGEST_URL` | simulator | The ingestion endpoint URL (compose default: `http://backend:3211/ingest/readings`). |
| `WAVELINK_MAX_BATCH` | simulator | Readings per ingestion request the simulator sends (default `50`); must not exceed `INGEST_MAX_READINGS_PER_BATCH`. |
| *(14 more `INGEST_*` tunables)* | backend | See [Ingestion → Tunable limits](#tunable-limits) above. |

### Device registry function env vars

These are **not** consumed by `docker-compose.yml` or `.env` — Convex functions read `process.env`
from the deployment's own env store, set with `npx convex env set <NAME> <VALUE>` (Quickstart) or the
self-hosted dashboard's "Settings > Environment Variables" (Docker deployment). Changing one takes
effect immediately, no redeploy required.

| Variable | Default | Purpose |
|---|---|---|
| `DEVICE_HEARTBEAT_WINDOW_MS` | `60000` (60s) | Staleness threshold past which a device reads `offline`. Reasoned from the simulator's 2s cadence, not real field data — revisit once real telemetry cadence is known. |
| `DEVICE_METADATA_MAX_ENTRIES` | `20` | Max metadata entries per device; exceeding it is a validation failure, not truncation. |
| `DEVICE_METADATA_MAX_KEY_LENGTH` | `64` | Max metadata key length. |
| `DEVICE_METADATA_MAX_VALUE_LENGTH` | `256` | Max metadata value length. |
| `DEVICE_LIST_PAGE_SIZE` | `50` | Default page size for the paginated device list. |

Device reads need the `data.read` capability (every role); register/update/decommission/
reactivate/change-history need `device.manage` (admin only) — enforced the same way as every
other protected function, via `authedQuery`/`authedMutation` (see [Authentication](#authentication)).
The device registry no longer has an auth escape hatch of its own: the temporary
`backend/lib/access.ts` seam it shipped with (before `auth-roles` merged) has been removed.

The sweep interval (15s, bounding how quickly a stale device is marked `offline` — see
`DEVICE_HEARTBEAT_WINDOW_MS` above) is a code constant in `backend/crons.ts`, not an env var:
`crons.ts` is evaluated at Convex push time, so an env-driven interval would not take effect without a
redeploy anyway.

**Identifier normalization**: a device's external identifier is compared for uniqueness (and matched by
incoming telemetry) after trimming whitespace and lowercasing — so a gateway sending `SIM-CNC-01`
matches a device registered as `sim-cnc-01`, and registering `ROBOT-01` when `robot-01` already exists
is refused. The as-entered (trimmed only) value is what's displayed and stored in `externalId`; the
normalized form lives only in `externalIdKey`.

### Migrating an existing deployment's `devices` table

This feature replaced `devices.isActive: boolean` with `devices.lifecycle: "in_service" |
"decommissioned"`. A fresh deployment (no existing `devices` rows) needs no extra step — `lifecycle` is
simply required on every newly-inserted row. A deployment that already has `devices` rows from before
this change must migrate in two steps, because Convex validates every existing row against the schema
on push and a straight rename/add-required-field push will fail:

1. Temporarily relax `backend/schema.ts` so `lifecycle` is `v.optional(...)` (keep `isActive` too), and
   push.
2. Run `npx convex run devices:backfillLifecycle` — a one-off `internalMutation` that sets `lifecycle`
   from each row's legacy `isActive` (`false` → `decommissioned`, otherwise `in_service`).
3. Re-tighten `lifecycle` to required and remove `isActive` from the schema (the state already
   committed to this repo), and push again.

## Production (self-hosted, Postgres-backed)

Same as **Docker deployment** above, but with the `postgres` service backing the Convex backend instead of local SQLite. There's no separate database migration tool to run — the self-hosted backend runs its own internal migration automatically on startup once it can connect (you'll see `model::migrations: Migration complete` in its logs).

**1. Configure `.env`** — beyond the base setup in Docker deployment step 1, set:

```sh
POSTGRES_PASSWORD=<a password>
POSTGRES_URL=postgres://convex:<same password>@postgres:5432
```

> ⚠️ `INSTANCE_NAME` and `POSTGRES_DB` must match (hyphens → underscores) — the backend connects to a Postgres database *named after* `INSTANCE_NAME`, and that database must already exist. The `postgres:17-alpine` image creates it automatically via `POSTGRES_DB`, but only on a **fresh volume** — if you change `INSTANCE_NAME` later, either run `docker compose down -v` to reset the Postgres volume, or create the database manually: `psql $POSTGRES_URL -c "CREATE DATABASE <name>;"`. Defaults (`wavelink_local` / `wavelink_local`) already match, so you only need to touch this if you rename the instance.
>
> Also note: `POSTGRES_URL` must **not** include a database name or query params — just `postgres://user:pass@host:port`.

**2. Start everything:**

```sh
docker compose --profile production up
```

Same one-command flow as Docker deployment above — Postgres becomes healthy before the backend starts (wired via `depends_on: ... required: false` in `docker-compose.yml`, so the same file still works without `--profile production` for the plain SQLite flow), then `push` and `frontend` proceed exactly as before.

Still open: SQLite-vs-Postgres and self-hosted-vs-Cloud-Cloud choices for an actual production pilot deployment (not just local verification) — see the "Self-hosted storage choice" open question in [`specs/foundation/plan.md`](specs/foundation/plan.md), which also tracks Phase M5's remaining scope.
