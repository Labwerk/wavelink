# wavelink

Realtime dashboard for monitoring industrial robots/machines, built on [Convex](https://convex.dev).

> 📄 Full spec: [`specs/foundation/spec.md`](specs/foundation/spec.md) · Build plan: [`specs/foundation/plan.md`](specs/foundation/plan.md) · SDD workflow: [`specs/README.md`](specs/README.md)

## Status

✅ Schema, live device/telemetry view, and telemetry simulator are working.
✅ Auth/roles (Convex Auth + Password provider, invite-only accounts, role-based
access control, audit log, service-token ingestion — see
[`specs/auth-roles/spec.md`](specs/auth-roles/spec.md)). Not yet built: alerting, historical
playback, production deployment profile. See the [foundation plan](specs/foundation/plan.md) for details.

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

    SIM -- "POST /ingest/telemetry<br/>(service token)" --> FN
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

**3. One-time auth setup** — the dashboard requires signing in (see [Authentication](#authentication) below). Convex Auth needs a signing key pair and your dev server's URL set as environment variables *on the Convex deployment* (not in a `.env` file):

```sh
npx @convex-dev/auth --web-server-url http://localhost:3000
```

This generates a `JWT_PRIVATE_KEY`/`JWKS` pair and sets them plus `SITE_URL` via `npx convex env set` against whichever deployment `npx convex dev` linked in step 2. Run it once per deployment; it's interactive (asks before overwriting existing values) and never prints or stores secrets in the repo.

Then set the two deployment variables this app adds, and create the first admin (see [First admin](#first-admin-bootstrap)):

```sh
npx convex env set INITIAL_ADMIN_EMAIL you@example.com
npx convex env set INGEST_SERVICE_TOKEN "$(openssl rand -hex 32)"
```

**4. (Optional) seed live data**, in a separate terminal:

```sh
cd gateway/simulator
CONVEX_SITE_URL=<HTTP-actions URL, ends in .convex.site> INGEST_SERVICE_TOKEN=<same value as step 3> npm run dev
```

The simulator posts telemetry to `POST /ingest/telemetry` on the deployment's **HTTP-actions (site) URL** — not the API URL — with the `INGEST_SERVICE_TOKEN` bearer credential. It does **not** register devices (`devices.register` is admin-only): sign in as an admin and register `sim-cnc-01`, `sim-agv-01` and `sim-arm-01` from the dashboard's "Register device" form; telemetry for devices that don't exist yet is safely dropped, not stored.

That's it for day-to-day development. Use **Docker deployment** below only when you need to test the self-hosted path itself.

<details>
<summary><strong>Running backend/frontend separately instead of <code>npm run dev</code></strong></summary>

```sh
# terminal 1 — backend
npx convex dev

# terminal 2 — frontend
cd frontend && npm run dev

# terminal 3 (optional) — simulator
cd gateway/simulator && CONVEX_SITE_URL=<site url> INGEST_SERVICE_TOKEN=<token> npm run dev
```

</details>

## Docker deployment

Runs everything against a **self-hosted** Convex backend instead of Convex Cloud — use this to verify the self-hosted path, or as a base for a self-hosted production deploy. Not needed for day-to-day development.

**1. Set up env** (one-time):

```sh
cp .env.example .env
# set INSTANCE_SECRET in .env, e.g. via: openssl rand -hex 32
# also set INITIAL_ADMIN_EMAIL and INGEST_SERVICE_TOKEN (openssl rand -hex 32);
# the `push` service copies both onto the Convex deployment
```

**2. Start everything:**

```sh
docker compose up
```

That's it. Under the hood, `backend` generates its own admin key on startup and a one-shot `push` service uses it to push `backend/`'s schema/functions automatically — no manual key copying or separate push command. `frontend` waits for `push` to finish before it starts. Open [http://localhost:3000](http://localhost:3000).

**3. One-time auth setup**, same as Quickstart step 3 but pointed at the self-hosted backend:

```sh
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=$(docker compose exec backend cat /convex/data/admin_key.txt)
npx @convex-dev/auth --web-server-url http://localhost:3000
```

Then create the first admin ([First admin](#first-admin-bootstrap)).

**4. (Optional) seed live telemetry**, in a separate terminal:

```sh
docker compose --profile simulator up simulator
```

Posts a telemetry batch every `SIMULATOR_INTERVAL_MS` (default 2s) to the backend's HTTP-actions port (3211) using `INGEST_SERVICE_TOKEN`. As noted in Quickstart step 4, device registration is admin-only — sign in as an admin and register the demo devices from the dashboard first, then watch telemetry update live.

> **Upgrading an existing environment:** this version removes the `users.authId` column (the row's own id is now the identity), which breaks any deployment that already holds user rows. There is no migration because the table has only ever held dev data — reset with `docker compose down -v` (Docker) or clear the `users`/`auth*` tables from the Convex dashboard (Cloud dev deployment), then run the first-admin bootstrap again.

<details>
<summary><strong>What's actually happening on <code>docker compose up</code></strong></summary>

1. `backend` starts, generates its own admin key (deterministic given `INSTANCE_NAME`/`INSTANCE_SECRET`), writes it to the shared `convex-data` volume.
2. `push` (one-shot) waits for that key, then runs `npx convex dev --once` against the backend — pushes `backend/schema.ts` + functions, writes `backend/_generated/` back to the repo on disk (it bind-mounts the repo, same as `frontend` does).
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

## Authentication

Sign-in is required to use the dashboard — see [`specs/auth-roles/spec.md`](specs/auth-roles/spec.md) and [`plan.md`](specs/auth-roles/plan.md) for the full design. Summary:

- **Provider:** [Convex Auth](https://labs.convex.dev/auth) with the Password provider (email + password, self-hosted, no external identity provider). Set up once per deployment via `npx @convex-dev/auth`. Convex Auth is beta upstream; its use is confined to `backend/auth.ts`, `backend/lib/` and `frontend/proxy.ts`.
- **Accounts are invite-only.** Public sign-up is disabled at the provider (`backend/lib/provisioning.ts`), and the sign-in page has no sign-up option. An admin creates an account from **Manage users → Create user** with a temporary password handed over out-of-band. Every new account starts as `viewer`; an admin promotes it afterwards.
- **Roles** (each includes everything below it): `viewer` (view dashboards/history) < `operator` (+ acknowledge alerts, notes) < `maintenance` (+ history export, device diagnostics) < `admin` (+ manage devices, alert rules, users). The role → capability map is one table, `backend/lib/permissions.ts`.
- **Enforcement is server-side and deny-by-default.** Every protected function is declared with `authedQuery`/`authedMutation`/`authedAction` (`backend/lib/functions.ts`), which require a capability; the role is read from the stored user row on every call, never from the client. A meta-test fails if an exported function uses a raw `query`/`mutation`/`action` and is not on the explicit allow-list in `backend/lib/publicEntryPoints.ts`. The UI (`users.me` → `capabilities`) only hides controls. `frontend/proxy.ts` (Next.js 16's renamed `middleware.ts`) only redirects signed-out visitors to `/signin`.
- **Attribution:** every state change (role change, activate/deactivate, user creation, device register/update/deactivate, first-admin bootstrap) appends a row to the `auditLog` table — who, what, target, when — inside the same transaction as the change. For account creation this holds too: the role decision and the audit row are written inside Convex Auth's `createOrUpdateUser` callback, in the same transaction as the account insert, so no account can exist unattributed. Admins see recent entries on the **Manage users** page. Alert acknowledgement will record `acknowledgedBy`/`acknowledgedAt` plus an audit row when alerting ships. The one exception is `users:setPassword` (below): it has no acting user, so its row has no `actorId` and says `via: deployment-admin-key`, and it is written just after the credential change rather than atomically.
- **Ingestion is not a user.** The gateway/simulator posts to `POST /ingest/telemetry` (HTTP-actions URL) with `Authorization: Bearer $INGEST_SERVICE_TOKEN`. `ingest.recordBatch` is an internal mutation, so no user session can call it. A missing/invalid token gets a bare `401`; an unset `INGEST_SERVICE_TOKEN` rejects everything.
- **Deactivation:** an admin can deactivate/reactivate an account from **Manage users** (`users.setActive`). It takes effect on that user's next call. You cannot deactivate yourself or the last active admin, and `setRole` likewise refuses to demote the last active admin.

### First admin (bootstrap)

A fresh deployment has no admin to create one, so a one-time **internal** function does it. It is not callable from the browser or by any client: it can only be run with the **deployment admin key**, via the Convex CLI. That key — not any email address — is what protects first-admin creation.

```sh
npx convex env set INITIAL_ADMIN_EMAIL you@example.com     # once per deployment
npx convex run users:bootstrapAdmin '{"email":"you@example.com","password":"<choose, 8+ chars>"}'
```

- **Quickstart (Convex Cloud dev deployment):** the CLI is already logged in and linked by `npm run dev`, so the two commands above are enough.
- **Docker (self-hosted):** export the admin key first, then run the same commands:
  ```sh
  export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
  export CONVEX_SELF_HOSTED_ADMIN_KEY=$(docker compose exec backend cat /convex/data/admin_key.txt)
  ```

`INITIAL_ADMIN_EMAIL` and the "no users exist yet" rule are **defence in depth, not the security boundary**: they stop an operator from bootstrapping the wrong account on a deployment that is already in use, and are re-checked inside the account-creation transaction, where the `admin` role and the audit row are written atomically with the account (it either completes or leaves nothing behind). Then sign in at [http://localhost:3000](http://localhost:3000).

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

Access token (JWT) **1 hour**, refreshed automatically; **8 hours idle timeout**; **7 day hard cap** (then sign in again); the browser cookie is a **session cookie**, so closing the browser signs out. Page reloads keep the session. Role changes and deactivation apply on the very next call because the role is read from the database, not the token. Configured in `backend/auth.ts` and `frontend/proxy.ts`. `@convex-dev/auth` is pinned to exactly `0.0.95`: on that version an expired/invalid session made the proxy answer `200` + a `location` header (a blank page) instead of a redirect, so `frontend/lib/normalizeRedirect.ts` restores a real 307 to `/signin`. Re-verify that workaround when upgrading the library.

### Role-change notification

None in v1 (no email infrastructure). The change is visible immediately instead: `users.me` is a live query, so the affected user's role badge and controls update within about a second without a reload, and admins can see who changed whom and when in the audit list.

### Tests

`npm test` (Vitest + `convex-test`) covers: per-role allow/deny for each of the four roles, capability inheritance against the spec table, deny-by-default (unknown capability; the meta-test over `backend/**`), non-leakage (forbidden-existing vs. non-existent target), `setRole` authorization / last-admin protection / audit rows, sign-up blocked, default role `viewer`, atomic account creation (forged `createdBy`/role/no creator all rejected with nothing left behind), first-admin bootstrap, admin provisioning, `setActive`, `setPassword` and recovery, the proxy redirect fix, and the service-token ingestion route. `convex-test` cannot sign real JWTs, so the browser sign-in → reload → sign-out path (and the R9 UI gating) is a manual smoke check: see [`specs/auth-roles/smoke-checklist.md`](specs/auth-roles/smoke-checklist.md).

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
| `INGEST_SERVICE_TOKEN` | Convex deployment + simulator | Service credential for `POST /ingest/telemetry`. Unset = ingestion rejects everything. |
| `CONVEX_SITE_URL` | simulator | HTTP-actions URL the simulator posts to (self-hosted: `http://backend:3211`; Cloud: `https://<name>.convex.site`). |
| `JWT_PRIVATE_KEY` / `JWKS` / `SITE_URL` | backend (Convex Auth) | Signing key pair + your web app's URL, set **on the Convex deployment itself** via `npx @convex-dev/auth` (see [Authentication](#authentication)) — never stored in a `.env` file or committed. |

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
