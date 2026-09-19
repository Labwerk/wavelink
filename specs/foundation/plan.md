# Implementation Plan: Realtime Robot/Machine Dashboard

**Source spec:** [`specs/initial-spec.md`](../specs/initial-spec.md)
**Status:** Draft v0.1
**Last updated:** 2026-08-17

This plan sequences the work described in the initial spec into concrete, buildable phases. Each phase maps to a milestone in spec §16 and lists the tasks, files/services touched, and the exit criteria that gate moving to the next phase. Open questions from spec §14 are called out where they block a phase so they get resolved before that work starts, not during it.

**Next steps (resume here):** M0/M1 (schema, `devices`/`telemetry`/`ingest` functions, Next.js dashboard, simulator container) is implemented and **verified** — schema pushed cleanly (all 9 indexes created), `backend/_generated/` generated, and the dashboard rendered live at `localhost:3000` via `npm run dev` (root, native) and via `docker compose up frontend` (Docker). Next up: M2 (auth & roles).

**Decision (2026-08-17):** README's day-to-day **Quickstart now targets a Convex Cloud dev deployment** (`npx convex dev` with browser login) instead of the self-hosted Docker backend, so local development is two commands with no Docker involved. The self-hosted Docker backend is still fully supported — moved under its own "Docker deployment" README section — and remains the actual production target per spec (self-hosted deployability is a v1 goal, not optional). This only changes which backend day-to-day dev iterates against; M5's self-hosted deployability milestone is unaffected and should still be verified via the Docker deployment path specifically, not Quickstart.

**Decision (2026-08-17):** restructured the repo so **backend and frontend live in separate top-level folders**, superseding Phase 0's original choice to colocate Convex functions inside the Next.js app (`app/convex/`). Layout: Convex functions/schema live at the repo root — Convex CLI runs from the repo root, not from inside a frontend folder; `frontend/` (renamed from `app/`, Next.js only, imports generated types via a relative path into the backend folder); `gateway/simulator/` unchanged. Root `package.json` now declares npm workspaces (`frontend`, `gateway/simulator`) plus its own `convex` dependency, so a single `npm install` at the root covers everything — this also fixed a real bug where `npm install` at the repo root failed with `ENOENT` (no root `package.json` existed). Docker followed suit: `frontend`'s build context moved from `./app` to the repo root (`.`) with `dockerfile: frontend/Dockerfile`, since the image now needs both `frontend/` and the sibling backend folder.

**Decision (2026-08-17):** renamed the backend source folder from `convex/` to **`backend/`**, since Convex's CLI only auto-discovers a folder literally named `convex/` by default. Added `convex.json` (`{"functions": "backend/"}`) at the repo root so the CLI still finds it. Everything that referenced `convex/_generated/` now points at `backend/_generated/` (frontend import path, `.gitignore`, Dockerfile `COPY` steps). Also added a root `npm run dev` script (`concurrently` running `convex dev` + the frontend's `next dev` together) so a single command boots the whole dev stack — verified end-to-end with zero errors after clearing a stale `next dev` lockfile left over from earlier manual testing.

All references to `app/convex/...` or bare `convex/...` in earlier sections below (Phase 0–M1 history) predate these two restructurings and describe what was true when written, not the current layout — see the notes above and the README for the current one.

**Fix (2026-08-17):** the Postgres-backed production path (`--profile production`) was scaffolded but never actually tested, and didn't work. Found and fixed three bugs while verifying it end-to-end against a real self-hosted backend:
1. `backend` had no `depends_on` on `postgres` at all — race condition, backend could start before Postgres was ready. Fixed with `depends_on: postgres: { condition: service_healthy, required: false }` — the `required: false` makes it a no-op on the default SQLite-only run (where `postgres` isn't part of the deployment), so one `docker-compose.yml` still serves both modes.
2. `POSTGRES_URL` in `.env.example` included a database path and would-be query params (`.../convex_self_hosted`) — Convex rejects this outright (`cluster url already contains db name`). Fixed: `POSTGRES_URL` must be host+credentials only, no path.
3. The backend doesn't create its own database — it connects to a Postgres database **named after `INSTANCE_NAME`** (hyphens → underscores) and expects it to already exist. `POSTGRES_DB` (which `postgres:17-alpine` uses to auto-create a database on first boot) must be set to match, or the backend fails with `database "..." does not exist`. Fixed: changed default `INSTANCE_NAME` from `wavelink-local` to `wavelink_local` (underscore, since the sanitized DB name is what actually matters) and default `POSTGRES_DB` to match, so the out-of-the-box defaults just work. Documented in `docker-compose.yml` comments, `.env.example`, and the README's new "Production (self-hosted, Postgres-backed)" section.

Verified after fixing: `docker compose --profile production up -d postgres backend dashboard` → Postgres healthy, backend logs show `model::migrations: Migration complete` and `backend listening on 0.0.0.0:3210`.

**Gap to clarify later:** the `INSTANCE_NAME`/`POSTGRES_DB` match-by-convention requirement (point 3 above) is fragile — nothing enforces they stay in sync, and renaming `INSTANCE_NAME` after the Postgres volume already exists silently breaks the backend until you manually reset the volume or `CREATE DATABASE` yourself. Worth a decision before an actual production pilot (not just local Docker verification): either document this as an accepted runbook step, or script around it (e.g. an init container that runs `CREATE DATABASE IF NOT EXISTS` derived from `INSTANCE_NAME`). Also unresolved: whether to use a colocated Postgres container (current scaffold) or an external managed Postgres (Neon, RDS, etc.) for a real deployment — ties into the existing "Self-hosted storage choice" open question from the spec.

**Decision (2026-08-17):** made `docker compose up` alone start the entire Docker deployment stack with zero manual steps — previously required a 4-step dance (start backend/dashboard, manually run `generate_admin_key.sh`, export env vars, run `convex dev --once`, *then* start frontend). Two changes in `docker-compose.yml`:
1. `backend`'s entrypoint is now overridden (`entrypoint: ["/usr/bin/bash", "-c"]` + inline script) to start the original `run_backend.sh` in the background, poll `/version` until healthy, then run `./generate_admin_key.sh` itself and write the result to the shared `convex-data` volume. This works because the admin key is a pure function of `INSTANCE_NAME`/`INSTANCE_SECRET`/persisted instance state — confirmed by reading `generate_admin_key.sh` and `run_backend.sh` directly out of the image (`docker run --rm --entrypoint sh ghcr.io/get-convex/convex-backend:latest -c "cat ./generate_admin_key.sh"`) rather than assuming.
2. A new one-shot `push` service (built from `frontend/Dockerfile`'s `base` stage, so it has `npx`/`convex` and the repo already `npm install`ed) waits for that key file, then runs `npx convex dev --once` — same as the old manual step, just automated. It bind-mounts the repo (like `frontend` does) so `backend/_generated/` lands back on the host. `frontend` and `simulator` both gained `depends_on: push: {condition: service_completed_successfully}` so they never start before functions actually exist on the backend.

Two real bugs found and fixed while wiring this up (both are footguns for anyone else doing this, not just this repo):
- Compose does its own `$VAR`/`${VAR}` interpolation on `command:` strings *before* the container ever sees them — `$BACKEND_PID` and `$!` in the inline script were silently swallowed (defaulted to empty) until escaped as `$$BACKEND_PID`/`$$!`. `$(cmd)` substitution syntax is unaffected (doesn't match Compose's interpolation pattern), so that didn't need escaping.
- A stale root `.env.local` left over from an unrelated earlier `npx convex dev` run (targeting Convex Cloud, from Quickstart) got bind-mounted into the `push` container and its `CONVEX_DEPLOYMENT` value conflicted with the self-hosted env vars, making the CLI refuse to run (`CONVEX_DEPLOYMENT must not be set when CONVEX_SELF_HOSTED_URL... are set`). Fixed by having `push` unconditionally `rm -f /repo/.env.local` before running — makes `docker compose up` robust regardless of what prior native-dev usage left on the host, rather than relying on the user to remember to clean up.

Verified with a full clean run (`docker compose down -v`, cleared stale `.env.local`/port conflicts from earlier manual testing) — `docker compose up` alone brought up `backend` → `push` (pushed schema, exited 0) → `frontend` (compiled clean, `GET / 200`) → `dashboard`, and `docker compose --profile simulator up` on top of that correctly waited for `push` before registering devices and sending telemetry batches.

---

## Phase 0 — Repo & tooling scaffolding (pre-M0)

Not a spec milestone itself, but required before M0 can start.

- [x] **Decided (2026-08-17):** frontend = Next.js (App Router), package manager = npm, monorepo = plain folders (`app/`, `gateway/simulator/`) without npm workspaces — each service has its own `package.json`/`Dockerfile` since they're built as independent containers anyway. Auth provider is still open, deferred to M2.
- [x] Initialize monorepo layout: `app/convex/` (backend functions + schema, colocated with the Next.js app per standard Convex convention), `app/` (frontend), `gateway/simulator/` (simulator container), root `docker-compose.yml`.
- [ ] Initialize Convex project (`npx convex dev` locally against self-hosted backend) — **blocked**: Docker Desktop's engine wasn't running in the implementing environment, so the backend was never brought up to run codegen/push functions against. Do this first when picking the work back up (see "Next steps" below).
- [ ] Set up the `@convex-dev/no-collect-in-query` ESLint rule from spec §11 — not yet added.

**Exit criteria:** Empty-but-typed Convex project runs locally; repo layout matches what `docker-compose.yml` (Phase M0) will reference. **Not yet met** — pending the Docker verification above.

---

## Phase M0 — Schema & local scaffolding

Maps to spec §16 M0. Implements spec §9 (Data Model) and the local-dev half of §12 (Deployment Plan).

- [x] Implement `app/convex/schema.ts` exactly as drafted in spec §9: `devices`, `telemetry`, `alertRules`, `alerts`, `users` tables with the specified indexes.
- [x] Write `docker-compose.yml` with `backend` + `dashboard` services (SQLite by default); also added `app` and `simulator`/`production` Compose profiles ahead of schedule since they were trivial to include alongside — see M1/M5 below for their actual implementation status.
- [ ] Generate admin key via `generate_admin_key.sh`; confirm dashboard reachable at `http://localhost:6791` and backend at `http://localhost:3210` — **not verified**, same Docker-daemon blocker as Phase 0.
- [x] Document the env vars in `.env.example` at the repo root (not committed — `.env` is gitignored).

**Exit criteria:** `docker compose up` (backend + dashboard only) succeeds; schema pushes cleanly via `convex dev`; dashboard shows the five empty tables. **Not yet verified end-to-end** — `docker compose config` validates the file syntactically and `npx tsc --noEmit` on `app/` shows no errors beyond the expected missing-codegen ones, but nothing has actually been run against a live backend.

---

## Phase M1 — Seeded live dashboard

Maps to spec §16 M1. Implements spec §6.2 (Live Telemetry View) and the reactive half of §10 (Function Plan), without auth.

- [x] Implement `ingest.recordBatch` (mutation) per spec §10: writes telemetry rows, updates `devices.status`/`lastSeenAt` denormalized fields (spec §9 design note). Unknown/inactive `externalId`s are skipped rather than auto-creating a device record.
- [x] Implement `devices.listActive`, `devices.get`, `telemetry.latestForDevice` as subscribed queries. `telemetry.latestForDevice` bounds its read to the 200 most recent rows (`.take(200)`, not `.collect()`) per spec §11's over-fetching guidance, then reduces to one row per metric.
- [x] Implement `devices.register` (mutation) — no role check yet (added in M2), signature kept stable for M2 to layer an auth guard onto without a rewrite. Also implemented `devices.update`/`devices.deactivate` early since they were trivial alongside `register`.
- [x] **Decision (2026-08-17):** ship a telemetry **simulator as its own service/container** (`gateway` module, e.g. `gateway/simulator/`) rather than a throwaway script — it calls `ingest.recordBatch` on an interval with fake readings for a handful of simulated devices, and stands in for real device ingestion through M0–M4. Building it as a proper container now means swapping in real protocol adapters later (M5+) is a drop-in replacement of this one service, not a rewrite of how ingestion is wired into `docker-compose.yml`.
- [x] Built the simulator per the decision above (`gateway/simulator/src/index.ts` + `Dockerfile`); registers 3 fake devices (`sim-cnc-01`, `sim-agv-01`, `sim-arm-01`) and posts a batch of `temperature_c`/`cycle_count`/`error_code` readings every `SIMULATOR_INTERVAL_MS` (default 2s) via `ConvexHttpClient` + `anyApi`, so it has no compile-time dependency on the app's generated Convex types.
- [x] Scaffolded the frontend app (`app/app/page.tsx`) with a device list view and a device detail view, both backed by subscribed `useQuery` calls.
- [x] Added `app` and `simulator` (as an opt-in `--profile simulator` service) to `docker-compose.yml`.

**Exit criteria:** With `docker compose up` running backend + dashboard + app, the seeded simulator produces visible, live-updating device status/telemetry on the dashboard with no polling. **Not yet verified live** — same Docker-daemon blocker as M0; the code path is implemented and type-consistent but has not been run end-to-end. Verify this first when resuming.

---

## Phase M2 — Auth & roles

Maps to spec §16 M2. Implements spec §4 (Users & Roles), §6.5 (Auth & Access Control), and the `users.*` functions in §10.

- [ ] Wire the chosen auth provider (spec §14 open question — must be resolved before this phase starts) into the frontend and Convex.
- [ ] Implement `users` table population on first login, `users.me`, `users.list`, `users.setRole`.
- [ ] Add a shared server-side role-check helper used by every protected query/mutation, per spec §11's "server-side role checks on every function; deny-by-default" practice.
- [ ] Retrofit role checks onto every mutation/query from M0–M1 that spec §6.5 requires (`devices.register`/`update`/`deactivate` → admin only; reads scoped by role where applicable).
- [ ] Add role-appropriate UI gating in the frontend (hide/disable actions a role can't perform), while keeping the server check as the actual enforcement point.
- [ ] Manual security pass: attempt each mutation as each role, confirm unauthorized attempts fail closed without leaking data existence (spec §6.5 req. 20, and success metric in spec §15).

**Exit criteria:** All functions require authentication; a scripted or manual test matrix (role × function) shows correct allow/deny behavior for all four roles.

---

## Phase M3 — Alerting

Maps to spec §16 M3. Implements spec §6.3 and the `alertRules.*`/`alerts.*` functions in §10.

- [ ] Resolve the open design question from spec §14 ("Alert rule evaluation location") before starting: inline-in-ingestion vs. separate scheduled check. Recommendation to validate with the team: start inline (simpler, fewer moving parts) and revisit if ingestion latency becomes a problem — record the decision here once made.
- [ ] Implement `alertRules.list/create/update/deactivate` (admin-only mutations/queries).
- [ ] Implement rule evaluation logic triggered from `ingest.recordBatch` (or its chosen alternative) that creates `alerts` rows when a rule condition is met.
- [ ] Implement `alerts.listActive`, `alerts.listForDevice`, `alerts.acknowledge`, `alerts.resolve`.
- [ ] Build the frontend alert banner/feed (subscribed query) and per-device alert history view.
- [ ] Confirm alert delivery is in-dashboard only for v1 per spec §6.3 req. 13 (assumption) — do not build external notification channels unless the team has since confirmed that's in scope.

**Exit criteria:** Triggering a seeded condition (e.g., simulator emits an out-of-range value) produces a visible realtime alert; acknowledge/resolve flow works and is reflected across connected clients immediately.

---

## Phase M4 — Historical playback

Maps to spec §16 M4. Implements spec §6.4 and the `telemetry.rangeForDevice`/`telemetry.exportRange` functions in §10.

- [ ] Implement `telemetry.rangeForDevice` as a paginated (non-reactive) query using the `by_device_and_ts` / `by_device_metric_and_ts` indexes — enforce bounded reads per spec §7's document/query-limit requirement.
- [ ] Decide whether a `telemetryRollup` aggregate table (spec §9 design note) is needed for v1 based on the retention window decided in spec §14, or can be deferred; record the decision here.
- [ ] Implement `telemetry.exportRange` as an action that pages through `telemetry.rangeForDevice` and produces CSV/JSON output.
- [ ] Build the frontend playback UI: time-range picker, chart/timeline, scrub/zoom within the retained window, export button.
- [ ] Load-test a full-retention-window playback query against Convex's read limits (spec §15 success metric) and confirm pagination holds up.

**Exit criteria:** A maintenance-engineer-role user can select a device, pick a time range spanning the full retention window, view a rendered timeline, and export it, without hitting Convex per-query limits.

---

## Phase M5 — Deployability milestone

Maps to spec §16 M5. Implements the remainder of spec §12 (production topology) and all of §13 (README Update Plan).

- [ ] Add `postgres` service (production profile) to `docker-compose.yml` and verify the backend can be pointed at it via `POSTGRES_URL`.
- [ ] Real protocol adapter deferred past v1 (see decision in M1): the simulator container built in M1 remains the shipped v1 ingestion path. When a real protocol is scoped, add it as a sibling service/module under `gateway/` (e.g. `gateway/mqtt-adapter/`) that also calls `ingest.recordBatch`/the ingestion HTTP action — the simulator can keep running alongside it or be retired at that point, team's call.
- [ ] Finalize all environment variables against the actual pinned image versions used (spec §12 table is a draft to confirm here).
- [ ] Write/update `README.md` against the full checklist in spec §13.
- [ ] Have someone outside the implementing engineer(s) follow the README from a clean checkout and run `docker compose up` end-to-end, fixing any gaps found (spec §15 success metric).

**Exit criteria:** Clean-checkout → `docker compose up` → seeded/live data visible on dashboard, using only README instructions, verified by a second person.

---

## v1 candidate

- [ ] Real (non-simulated) ingestion connected for a pilot set of devices, once the ingestion-protocol open question is resolved — otherwise ship v1 with the simulator/seed path and treat real-protocol ingestion as a fast-follow.
- [ ] Re-review all open questions in spec §14 and either resolve or explicitly defer each one with a note in this plan.

---

## Cross-cutting tracking

Open questions from spec §14 that gate specific phases above (repeated here for visibility, not duplicated ownership — resolve in the spec, reference here):

| Open question | Blocks |
|---|---|
| Ingestion protocol(s) | **Resolved 2026-08-17:** simulator container (`gateway/simulator/`) ships as v1 ingestion path; real protocol adapter is a later, separately-scoped `gateway/` module, not a v1 blocker |
| Frontend framework confirmation | Phase 0 |
| Auth provider choice | M2 |
| Retention window | M4 (rollup-table decision) |
| Alert rule evaluation location | M3 |
| Notification channels beyond in-dashboard | M3 (scope check only — not building unless confirmed) |
| Self-hosted storage choice (SQLite vs. Postgres) | M5 |

This plan should be updated as phases complete and decisions are made — check off tasks and record decisions inline rather than creating a separate status document.
