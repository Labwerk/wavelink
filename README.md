# wavelink

Realtime dashboard for monitoring industrial robots/machines, built on [Convex](https://convex.dev).

> 📄 Full spec: [`specs/foundation/spec.md`](specs/foundation/spec.md) · Build plan: [`specs/foundation/plan.md`](specs/foundation/plan.md) · SDD workflow: [`specs/README.md`](specs/README.md)

## Status

| Feature | State |
|---|---|
| Schema, live device/telemetry view, telemetry simulator | ✅ Working |
| Auth & roles (sign-in + role-based access control) | 🚧 Implemented, not yet signed off — see [Authentication](#authentication) |
| Alerting, historical playback, production deployment profile | ⬜ Not started |

See the [foundation plan](specs/foundation/plan.md) for what each milestone covers.

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

**3. One-time auth setup** — the dashboard now requires signing in, so Convex needs a signing key before anyone can log in:

```sh
npx @convex-dev/auth --web-server-url http://localhost:3000
```

Run this **once per deployment**. It generates a key pair and stores it *on the Convex deployment itself* (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`) — nothing is written to a file in the repo, so there's no secret to accidentally commit.

**4. Create your admin account** — open [http://localhost:3000](http://localhost:3000) and sign up. **The first account created on a deployment becomes the admin**; everyone after that starts as a read-only `viewer`. See [Authentication](#authentication) for what each role can do.

**5. (Optional) seed live data**, in a separate terminal:

```sh
cd gateway/simulator
CONVEX_URL=<same URL as step 2> npm run dev
```

> ⚠️ Do step 4 first. The simulator tries to register its 3 demo devices on startup, but registering a device is admin-only — with no user session it just logs `Not authorized` and skips. Sign in as your admin, add the devices via the dashboard's **Register device** form, then restart the simulator. (Telemetry for a device that doesn't exist is safely dropped, not stored.)

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

**3. One-time auth setup**, same as Quickstart step 3 but pointed at the self-hosted backend:

```sh
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=$(docker compose exec backend cat /convex/data/admin_key.txt)
npx @convex-dev/auth --web-server-url http://localhost:3000
```

**4. Create your admin account** — open [http://localhost:3000](http://localhost:3000) and sign up. First account on the deployment becomes admin, same as Quickstart step 4.

**5. (Optional) seed live telemetry**, in a separate terminal:

```sh
docker compose --profile simulator up simulator
```

Posts a telemetry batch every `SIMULATOR_INTERVAL_MS` (default 2s). Same caveat as Quickstart: register the demo devices from the dashboard as admin first, otherwise the simulator has nothing to post against.

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

Signing in is required to see anything. Accounts are email + password, handled by
[Convex Auth](https://labs.convex.dev/auth) — no external identity provider or extra
signup needed. Set it up once per deployment with `npx @convex-dev/auth` (Quickstart step 3).

### Who can do what

| | Viewer | Operator | Maintenance | Admin |
|---|:---:|:---:|:---:|:---:|
| View devices & live telemetry | ✅ | ✅ | ✅ | ✅ |
| Register / edit / deactivate a device | ❌ | ❌ | ❌ | ✅ |
| List users, change someone's role | ❌ | ❌ | ❌ | ✅ |

Roles come from [`specs/foundation/spec.md`](specs/foundation/spec.md) §4. Alert
acknowledgement (operator) and historical export (maintenance) are listed there too,
but those features don't exist yet — so today only the admin column is actually
distinguishable from viewer.

### How the first admin happens

A fresh deployment has no admin to promote anyone, so **the first account created
becomes the admin**. Every account after that starts as `viewer`, and an admin
promotes them from there.

> ⚠️ This means that on a deployment reachable by anyone, whoever signs up first gets
> admin. Fine for local dev; **not** something to expose to a network as-is. Sign up
> immediately after deploying, before anyone else can.

### Where it's enforced

Every role check runs **on the server**, in `backend/lib/auth.ts`, on every protected
query and mutation. The UI gating in `frontend/app/page.tsx` only hides buttons — it
is not a security boundary, and calling the backend directly still gets refused.

All denials (not signed in, wrong role, deactivated account) return the same generic
`Not authorized` error, so a refused request never reveals whether the thing you asked
for exists.

### Tests

`npm test` (Vitest + [`convex-test`](https://docs.convex.dev/testing/convex-test))
covers every cell of the table above — allow *and* deny — plus the first-admin rule,
`setRole` authorization, and the identical-error behavior.

### Known gaps

This feature is implemented but **hasn't passed SDD review yet**. Known divergences
from [`specs/auth-roles/plan.md`](specs/auth-roles/plan.md):

- First-admin uses "first account wins" instead of the planned `INITIAL_ADMIN_EMAILS`
  allowlist (the warning above is exactly why the plan chose the allowlist).
- Sign-up is open to anyone; the plan calls for admin-invite-only provisioning.
- Route protection is client-side only — the plan calls for Next.js middleware, so a
  signed-out visitor currently loads the page shell before being shown the sign-in form.
- Never run against a live Convex deployment — verified by typecheck and tests only.

Tracked in [`specs/auth-roles/tasks.md`](specs/auth-roles/tasks.md).

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
