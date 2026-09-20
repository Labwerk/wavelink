# wavelink

Realtime dashboard for monitoring industrial robots/machines, built on [Convex](https://convex.dev).

> 📄 Full spec: [`specs/foundation/spec.md`](specs/foundation/spec.md) · Build plan: [`specs/foundation/plan.md`](specs/foundation/plan.md) · SDD workflow: [`specs/README.md`](specs/README.md)

## Status

✅ Schema, telemetry simulator, and the device registry (connectivity state, filtering/grouping, admin
management UI, audit trail — see [`specs/device-registry/`](specs/device-registry/)) are working.
🚧 Not yet built: auth/roles (a sign-in flow — see the permissive-admin-default warning below),
alerting, historical playback, production deployment profile. See the
[foundation plan](specs/foundation/plan.md) for details.

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

    SIM -- "ingest.recordBatch()" --> FN
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

**3. (Optional) seed live data**, in a separate terminal:

```sh
cd gateway/simulator
CONVEX_URL=<same URL as step 2> npm run dev
```

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

# terminal 3 (optional) — simulator
cd gateway/simulator && CONVEX_URL=<url from terminal 1> npm run dev
```

</details>

## Docker deployment

Runs everything against a **self-hosted** Convex backend instead of Convex Cloud — use this to verify the self-hosted path, or as a base for a self-hosted production deploy. Not needed for day-to-day development.

**1. Set up env** (one-time):

```sh
cp .env.example .env
# set INSTANCE_SECRET in .env, e.g. via: openssl rand -hex 32
```

**2. Start everything:**

```sh
docker compose up
```

That's it. Under the hood, `backend` generates its own admin key on startup and a one-shot `push` service uses it to push `backend/`'s schema/functions automatically — no manual key copying or separate push command. `frontend` waits for `push` to finish before it starts. Open [http://localhost:3000](http://localhost:3000).

**3. (Optional) seed live telemetry**, in a separate terminal:

```sh
docker compose --profile simulator up simulator
```

Registers a few fake devices and posts a telemetry batch every `SIMULATOR_INTERVAL_MS` (default 2s). The dashboard updates live — no refresh needed. Note the simulator calls `devices.register` with no session, so its self-registration relies on the permissive `DEVICE_REGISTRY_REQUIRE_ADMIN=false` default (see "Device registry function env vars" above) — flipping that flag also stops the simulator from auto-registering new devices.

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
| `DEVICE_REGISTRY_REQUIRE_ADMIN` | `false` | **See the warning below before deploying anywhere but a local machine.** |

> ⚠️ **`DEVICE_REGISTRY_REQUIRE_ADMIN` defaults to `false`, which makes the device registry's
> register/edit/decommission/reactivate operations callable by anyone** — this branch has no sign-in
> flow (auth-roles is a separate, unmerged feature) to produce a real admin session, so the permissive
> default is what makes the feature usable at all today. The enforcement path itself is real and fully
> tested (`tests/devices.test.ts` runs the full role matrix with the flag set to `true`). **Set this to
> `true` before any deployment reachable by anyone other than its developer.** See
> `backend/lib/access.ts` and `specs/device-registry/plan.md` ("Auth seam") for the full design and the
> mechanical swap to real role checks once auth-roles merges.

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
