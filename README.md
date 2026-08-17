# wavelink

Realtime dashboard for monitoring industrial robots/machines, built on [Convex](https://convex.dev).

> 📄 Full spec: [`specs/initial-spec.md`](specs/initial-spec.md) · Build plan: [`plans/implementation-plan.md`](plans/implementation-plan.md)

## Status

✅ Schema, live device/telemetry view, and telemetry simulator are working.
🚧 Not yet built: auth/roles, alerting, historical playback, production deployment profile. See the [implementation plan](plans/implementation-plan.md) for details.

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
| `specs/` | SDD specification documents. |
| `plans/` | Phased implementation plans. |

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

Registers a few fake devices and posts a telemetry batch every `SIMULATOR_INTERVAL_MS` (default 2s). Refresh the dashboard to watch it update live.

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

Still open: SQLite-vs-Postgres and self-hosted-vs-Cloud-Cloud choices for an actual production pilot deployment (not just local verification) — see the "Self-hosted storage choice" open question in [`plans/implementation-plan.md`](plans/implementation-plan.md), which also tracks Phase M5's remaining scope.
