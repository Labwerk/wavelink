# Initial Specification: Realtime Robot/Machine Dashboard

**Status:** Draft v0.1 — Spec-Driven Development (SDD) initial spec
**Owner:** Engineering team
**Last updated:** 2026-08-17

---

## 1. Overview

This system is a realtime dashboard for monitoring and controlling industrial robots and machines on a factory floor (or similar operational environment). It ingests high-frequency telemetry and status events from connected devices, stores and indexes that data using Convex (a TypeScript-native reactive database with built-in serverless functions and realtime subscriptions), and streams live updates to operators, maintenance engineers, and administrators through a web dashboard. The system is being built to replace manual/periodic polling of machine state with a live, low-latency operational picture — including alerting on anomalies and historical playback for incident review — while remaining deployable in self-hosted, on-premises environments common in industrial settings (via Docker Compose), not just cloud-hosted ones.

## 2. Goals

- Provide a live view of device status and key telemetry metrics with sub-few-second update latency to connected dashboard clients.
- Support alerting on anomaly/failure conditions (threshold breaches, device offline, error codes) with visible, actionable notifications.
- Support historical playback/review of a device's telemetry and event history over a bounded retention window.
- Support role-based access (operator, maintenance engineer, admin, viewer) so users see and can act only within their permission scope.
- Be deployable end-to-end via `docker-compose up` in a self-hosted environment, with README instructions that a new engineer can follow without prior Convex experience.
- Handle a moderate number of concurrent devices and dashboard viewers (see §7) without requiring architecture changes for the v1 scope.

## 3. Non-Goals (for this initial version)

- Not building a full MES (Manufacturing Execution System) or MDC (Machine Data Collection) product — no production scheduling, OEE rollups, or ERP integration in v1.
- Not implementing bidirectional device *control* (e.g., sending stop/start/reconfigure commands to machines) in v1 — v1 is monitoring/observability only. Control is a possible v2 direction (see Open Questions).
- Not building a custom mobile app — the dashboard is a responsive web app only.
- Not supporting arbitrary third-party protocol adapters (OPC-UA, Modbus, proprietary PLC protocols) directly inside Convex — protocol translation happens in an external ingestion/gateway service, out of scope for this spec's detailed design.
- Not implementing multi-tenant SaaS billing/org-isolation infrastructure — this spec assumes a single deployment serves one organization/site (multi-site federation is a later concern).
- Not guaranteeing hard real-time (sub-100ms, deterministic) control-loop latency — this is an operational dashboard, not a safety-critical control system.

## 4. Users & Roles

| Role | Description | Typical actions |
|---|---|---|
| **Viewer** | Read-only stakeholder (e.g., plant manager, visiting engineer) | View live dashboards, view historical data. No alert-ack, no config changes. |
| **Operator** | Floor operator watching live machine state during a shift | View live dashboards, acknowledge/clear alerts, add operational notes. |
| **Maintenance Engineer** | Diagnoses issues, reviews history after an alert | Everything Operator can do, plus historical playback/export, view device diagnostic detail. |
| **Admin** | Manages devices, users, and system configuration | Everything above, plus register/edit/decommission devices, manage users and roles, configure alert rules. |

Assumption to validate: exact role names/boundaries above are a reasonable starting taxonomy for a factory-floor context; confirm against the actual customer/organization's operational hierarchy before implementation.

## 5. Core Use Cases / User Stories

- As an **operator**, I want to see the live status of all machines on my line in one view, so that I can immediately notice when a machine goes offline or enters an error state.
- As an **operator**, I want to acknowledge an active alert, so that my team knows someone is already responding to it.
- As a **maintenance engineer**, I want to scrub through a machine's telemetry history around the time of a failure, so that I can diagnose the root cause.
- As a **maintenance engineer**, I want to export a time range of telemetry for a device, so that I can share it with a vendor or include it in an incident report.
- As an **admin**, I want to register a new device with a unique identifier and metadata (name, location, type), so that its telemetry starts appearing on dashboards.
- As an **admin**, I want to define alert rules (e.g., "temperature > X for Y seconds"), so that the system notifies the right people automatically.
- As an **admin**, I want to assign roles to users, so that access is scoped appropriately across the team.
- As a **viewer**, I want to see a summary dashboard of overall factory health, so that I can report status without needing operational access.
- As any authenticated user, I want the dashboard to update in realtime without manual refresh, so that I'm always looking at current state.

## 6. Functional Requirements

### 6.1 Device Management
1. Admins can register a device with: unique device ID, display name, type/model, location/zone, and optional metadata (JSON-ish key/value).
2. Admins can edit device metadata and decommission (soft-delete/deactivate) a device.
3. The system tracks device connectivity state (online/offline/unknown) derived from telemetry heartbeat recency.
4. Devices list view supports filtering/grouping by zone, type, and status.

### 6.2 Live Telemetry View
5. Dashboard shows current values for each device's key metrics (e.g., temperature, cycle count, error code, uptime) updated in realtime.
6. Dashboard shows per-device connectivity status (online/offline) with last-seen timestamp.
7. Users can drill into a single device's detail view showing all current metrics and recent event log.
8. Telemetry updates propagate to subscribed clients without manual polling/refresh (Convex reactive queries).

### 6.3 Alerting
9. System supports admin-defined alert rules per device or device type (threshold-based, offline-duration-based, error-code-based).
10. When a rule condition is met, the system creates an alert record and surfaces it in realtime to relevant dashboard users.
11. Operators/maintenance engineers can acknowledge an alert (recording who/when) and later resolve/close it.
12. Alert history is retained and viewable per device.
13. (Assumption — validate) Notification delivery in v1 is in-dashboard only; external channels (email/SMS/Slack/webhook) are a v1.1+ candidate, not required for initial ship.

### 6.4 Historical Playback
14. Users with appropriate role (maintenance engineer, admin) can select a device and a time range to view historical telemetry as a chart/timeline.
15. Historical view supports scrubbing/zooming within the retained window (see §7 retention policy).
16. Users can export a selected time range of telemetry as CSV/JSON for a single device.

### 6.5 Auth & Access Control
17. All dashboard access requires authentication.
18. Every Convex query/mutation/action that reads or writes protected data enforces role checks server-side (never trust client-supplied role claims).
19. Role assignment is managed by Admins only.
20. Unauthorized access attempts (role mismatch) fail closed (deny by default) and do not leak data existence.

### 6.6 Ingestion
21. The system accepts telemetry from an external ingestion/gateway service (not directly from raw device protocols) via authenticated HTTP or a Convex action/mutation entry point.
22. Ingestion supports batched writes (multiple readings per call) to control Convex function-call volume from high-frequency sources.
23. Ingestion validates payloads (device ID exists and is active, values within schema-defined shape) and rejects/logs malformed data rather than silently dropping it.

## 7. Non-Functional Requirements

All numeric targets below are **initial assumptions to validate** during implementation/load testing, not committed SLAs.

- **Realtime update latency**: target end-to-end (device reading → dashboard render) latency in the low single-digit seconds under normal load. *(Assumption — validate with load testing; depends on ingestion batching interval, which trades latency for call-volume efficiency.)*
- **Data retention**: raw high-frequency telemetry retained for a rolling window (assumption: 30–90 days); an optional downsampled/aggregated rollup could be retained longer. Exact window is a business decision to confirm.
- **Concurrent devices**: initial target on the order of tens to low hundreds of devices per deployment. *(Assumption — validate against actual site device count; this materially affects ingestion batching design.)*
- **Concurrent dashboard users**: initial target on the order of tens of concurrent viewers per deployment.
- **Uptime**: no formal SLA for v1 self-hosted deployments; system should degrade gracefully (dashboard shows "stale data" indicator) rather than fail silently if ingestion or backend is temporarily unavailable.
- **Document size / query limits**: design must respect Convex's per-document and per-transaction read/write limits (see §11); telemetry documents must stay small and queries must be bounded (indexed, paginated, or time-windowed) rather than unbounded `.collect()` calls.

## 8. System Architecture (high level)

```mermaid
flowchart LR
    subgraph Floor["Factory Floor"]
        M1[Machine / Robot]
        M2[Machine / Robot]
        M3[Machine / Robot]
    end

    subgraph Gateway["Ingestion / Gateway Service"]
        PA[Protocol Adapter\nMQTT / OPC-UA / vendor API]
        BQ[Batching Buffer]
    end

    subgraph ConvexBE["Convex Backend (self-hosted or cloud)"]
        ACT[HTTP Action / Mutation\ningestTelemetryBatch]
        DB[(Convex Tables:\ndevices, telemetry,\nalerts, alertRules, users)]
        Q[Reactive Queries]
    end

    subgraph Client["Dashboard (React/Next.js)"]
        UI[Live Views, Alerts,\nHistorical Playback]
    end

    M1 & M2 & M3 -->|raw protocol| PA
    PA --> BQ
    BQ -->|batched HTTP POST| ACT
    ACT --> DB
    DB -->|reactive subscription| Q
    Q -->|websocket push| UI
    UI -->|queries/mutations\n(auth'd)| ConvexBE
```

Data flow summary:
1. Machines emit telemetry over their native protocol (MQTT, OPC-UA, vendor-specific, etc. — protocol TBD per deployment).
2. An external **ingestion/gateway service** (outside Convex) speaks the device protocol, normalizes readings, and batches them.
3. The gateway pushes batches into Convex via an HTTP Action or mutation endpoint, authenticated with a service credential (not end-user auth).
4. Convex writes telemetry/alert records to its tables and evaluates alert rules.
5. Dashboard clients hold reactive Convex queries; Convex pushes updates automatically over the existing websocket connection whenever underlying data changes — no client polling.

## 9. Data Model (Convex schema draft)

This is a **draft** to validate during implementation, not a final schema. Field names/types are illustrative.

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  devices: defineTable({
    externalId: v.string(),        // stable device identifier from the field (e.g. serial/tag)
    name: v.string(),
    type: v.string(),              // e.g. "cnc-mill", "agv", "robot-arm"
    zone: v.optional(v.string()),  // physical location / line grouping
    status: v.union(
      v.literal("online"),
      v.literal("offline"),
      v.literal("unknown"),
    ),
    lastSeenAt: v.optional(v.number()), // ms epoch, updated on heartbeat/telemetry
    isActive: v.boolean(),          // soft-delete / decommission flag
    metadata: v.optional(v.record(v.string(), v.string())),
  })
    .index("by_externalId", ["externalId"])
    .index("by_zone_and_status", ["zone", "status"]),

  // High-frequency readings. Kept intentionally narrow/flat to control
  // document size and write volume; avoid nesting large arrays here.
  telemetry: defineTable({
    deviceId: v.id("devices"),
    ts: v.number(),                 // ms epoch of the reading (not insertion time)
    metric: v.string(),             // e.g. "temperature_c", "cycle_count", "error_code"
    value: v.union(v.number(), v.string()),
  })
    // Supports "latest N readings for a device" and time-window queries.
    .index("by_device_and_ts", ["deviceId", "ts"])
    .index("by_device_metric_and_ts", ["deviceId", "metric", "ts"]),

  alertRules: defineTable({
    deviceType: v.optional(v.string()),  // rule applies to a type, or...
    deviceId: v.optional(v.id("devices")), // ...to a specific device
    metric: v.string(),
    condition: v.union(
      v.literal("gt"),
      v.literal("lt"),
      v.literal("eq"),
      v.literal("offline_duration"),
    ),
    threshold: v.number(),
    sustainedForMs: v.optional(v.number()), // e.g. "temp > X for 30s"
    isActive: v.boolean(),
    createdBy: v.id("users"),
  }).index("by_device_and_metric", ["deviceId", "metric"]),

  alerts: defineTable({
    deviceId: v.id("devices"),
    ruleId: v.optional(v.id("alertRules")),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    message: v.string(),
    triggeredAt: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("acknowledged"),
      v.literal("resolved"),
    ),
    acknowledgedBy: v.optional(v.id("users")),
    acknowledgedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_device_and_status", ["deviceId", "status"])
    .index("by_status_and_triggeredAt", ["status", "triggeredAt"]),

  users: defineTable({
    authId: v.string(),             // identifier from the auth provider
    name: v.string(),
    email: v.string(),
    role: v.union(
      v.literal("viewer"),
      v.literal("operator"),
      v.literal("maintenance"),
      v.literal("admin"),
    ),
    isActive: v.boolean(),
  })
    .index("by_authId", ["authId"])
    .index("by_role", ["role"]),
});
```

Indexing / design notes:
- `telemetry` is the highest-write-volume table; indexes are limited to what live queries and playback actually need (`by_device_and_ts`, `by_device_metric_and_ts`) — extra indexes cost write overhead and storage, per Convex's own guidance to avoid redundant indexes ([Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)).
- Consider a separate `telemetryRollup` table (e.g., 1-minute or 5-minute aggregates) for historical playback beyond a short raw-data window, to bound query size and support longer retention without scanning raw rows. Marked as an open design question in §14.
- `devices.status`/`lastSeenAt` is a denormalized "current state" field updated on ingestion, so live dashboard queries can read one small indexed row per device instead of scanning `telemetry` for "most recent reading" on every render — this is the Convex-recommended denormalization pattern for avoiding expensive aggregate queries in hot paths ([Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)).
- Convex enforces limits on per-transaction rows/bytes read and document size ([Convex Limits docs](https://docs.convex.dev/production/state/limits)); this schema is designed so hot-path queries hit narrow indexed ranges rather than unbounded scans.

## 10. Convex Function Plan

| Function | Type | Reactive? | Purpose |
|---|---|---|---|
| `devices.listActive` | query | Yes (subscribed) | List active devices with current status, for dashboard overview. |
| `devices.get` | query | Yes (subscribed) | Single device detail (metadata + current status). |
| `devices.register` | mutation | No | Admin creates a new device record. |
| `devices.update` | mutation | No | Admin edits device metadata. |
| `devices.deactivate` | mutation | No | Admin soft-deletes/decommissions a device. |
| `telemetry.latestForDevice` | query | Yes (subscribed) | Current metric values for a device's live view. |
| `telemetry.rangeForDevice` | query | No (one-off, paginated) | Historical playback: telemetry within a time range for a device. |
| `telemetry.exportRange` | action | No (one-off) | Generate a CSV/JSON export for a device + time range (may call `telemetry.rangeForDevice` internally in pages). |
| `ingest.recordBatch` | mutation (via HTTP action wrapper) | No | Gateway service writes a batch of telemetry readings; updates `devices.status`/`lastSeenAt`; evaluates alert rules inline or triggers a follow-up check. |
| `alertRules.list` | query | Yes (subscribed) | Admin view of configured alert rules. |
| `alertRules.create` / `update` / `deactivate` | mutation | No | Admin manages alert rule configuration. |
| `alerts.listActive` | query | Yes (subscribed) | Realtime feed of active/unacknowledged alerts for dashboard banner. |
| `alerts.listForDevice` | query | Yes (subscribed) | Alert history for a specific device. |
| `alerts.acknowledge` | mutation | No | Operator/maintenance acknowledges an alert. |
| `alerts.resolve` | mutation | No | Marks an alert resolved. |
| `users.me` | query | Yes (subscribed) | Current authenticated user's profile + role, for client-side UI gating (server still re-checks role per call). |
| `users.list` | query | Yes (subscribed) | Admin view of all users. |
| `users.setRole` | mutation | No | Admin changes a user's role. |

Reactive (subscribed) functions back the live dashboard views; one-off queries/mutations/actions back administrative actions, historical range fetches, and exports where a live subscription isn't needed or would be wasteful.

## 11. Best Practices Applied

| Area | Best practice (source) | How it's reflected in this design |
|---|---|---|
| Schema for high-frequency data | Keep hot-write tables narrow; avoid unnecessary indexes ([Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)) | `telemetry` table has only two purpose-built compound indexes, not one-per-field. |
| Avoid over-fetching in queries | Avoid unbounded `.collect()`; prefer indexed/paginated reads ([Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)) | Live queries read narrow, indexed slices (`latestForDevice`, `listActive`); historical range queries are explicitly paginated. |
| Denormalization for hot paths | Use denormalized "current state" fields instead of aggregating on every read ([Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)) | `devices.status`/`lastSeenAt` updated on ingest rather than derived from scanning `telemetry` per dashboard render. |
| Batching high-frequency ingestion | Application-layer rate limiting / batching to control function-call volume ([Convex Rate Limiter component](https://www.convex.dev/components/rate-limiter); [Rate Limiting at the Application Layer](https://stack.convex.dev/rate-limiting)) | Gateway service batches readings before calling `ingest.recordBatch`; a rate limiter component is a candidate for protecting ingestion from bursty/misbehaving sources. |
| Action timeouts & concurrency | Actions time out at 10 minutes and support up to ~1000 concurrent operations ([Convex Limits](https://docs.convex.dev/production/state/limits)) | Bulk operations (exports, large historical scans) are implemented as actions that page through data rather than one giant transaction. |
| Document/transaction size limits | Convex enforces per-transaction read/write and document size limits ([Convex Limits](https://docs.convex.dev/production/state/limits)) | Telemetry documents are flat and small (one metric per row) rather than large nested blobs, keeping individual writes and reads cheap. |
| Role-based access control | Server-side role checks on every function; deny-by-default ([Convex Auth RBAC example](https://github.com/get-convex/convex-auth-with-role-based-permissions)) | Every mutation/query in §10 that touches protected data re-validates the caller's role from `users` table, never trusting client-supplied role claims. |
| Self-hosted deployment topology | Self-hosting requires backend + dashboard + your own frontend as separate services; SQLite by default, Postgres for production ([Convex self-hosted README](https://github.com/get-convex/convex-backend/tree/main/self-hosted); [Self-Hosting with Convex](https://stack.convex.dev/self-hosted-develop-and-deploy)) | Docker Compose plan in §12 mirrors this exact topology and calls out the SQLite-vs-Postgres tradeoff explicitly. |
| Realtime architecture | Convex reactive queries push updates over an existing subscription automatically — no manual polling needed ([Convex Realtime docs](https://docs.convex.dev/realtime)) | All "live" dashboard views in §10 are implemented as subscribed queries, not polled fetches. |

## 12. Deployment Plan (Docker Compose)

### Topology

- **backend** — self-hosted Convex backend (`ghcr.io/get-convex/convex-backend`), exposes the Convex API (default `3210`) and HTTP actions (default `3211`).
- **dashboard** — Convex's own admin dashboard UI (`ghcr.io/get-convex/convex-dashboard`), for inspecting data/functions during development and operations (default `6791`). This is the *Convex* dashboard (dev tool), distinct from the product's own operator-facing dashboard app.
- **postgres** (optional, production profile) — persistent SQL storage backing the Convex backend, in place of the default local SQLite file, per Convex's self-hosted guidance for production-grade storage.
- **app** — the product's frontend (React/Next.js), built separately, configured to talk to `backend`'s public origin.
- **gateway** (optional/future) — ingestion/protocol-adapter service that speaks to machines and batches writes into Convex; may not exist in the earliest milestone if telemetry is seeded/simulated first.
- **reverse proxy** (optional) — if TLS termination / single-origin routing is needed for a production-like deployment; not required for local dev.

### Persistent volumes

- `convex-data` — backend storage (SQLite file or state dir) when not using Postgres.
- `postgres-data` — Postgres data directory, when the production profile is used.

### Key environment variables (draft — confirm exact names against the pinned image version at implementation time)

| Variable | Used by | Purpose |
|---|---|---|
| `INSTANCE_NAME` | backend | Unique name for this Convex deployment instance. |
| `INSTANCE_SECRET` | backend | Secret key for the instance (generate via `openssl rand -hex 32`). |
| `CONVEX_CLOUD_ORIGIN` | backend, app | Public URL clients use to reach the Convex API. |
| `CONVEX_SITE_ORIGIN` | backend, app | Public URL for Convex HTTP actions. |
| `NEXT_PUBLIC_DEPLOYMENT_URL` | app | Frontend-visible Convex deployment URL. |
| `POSTGRES_URL` | backend (production profile only) | Connection string when backing storage with Postgres instead of SQLite. |
| `DO_NOT_REQUIRE_SSL` | backend (local dev only) | Relaxes SSL requirement for local/dev Postgres connections. |

### Draft `docker-compose.yml` skeleton

Skeleton only — service names, images, ports, `depends_on`, and volumes. No full env/config included here; see README plan (§13) for where the real file and its documentation will live.

```yaml
services:
  backend:
    image: ghcr.io/get-convex/convex-backend:latest
    ports:
      - "3210:3210"
      - "3211:3211"
    volumes:
      - convex-data:/convex/data
    # env_file: ./convex.env

  dashboard:
    image: ghcr.io/get-convex/convex-dashboard:latest
    ports:
      - "6791:6791"
    depends_on:
      - backend

  postgres:
    image: postgres:17-alpine
    volumes:
      - postgres-data:/var/lib/postgresql/data
    # profile: production (used only when POSTGRES_URL is configured on backend)

  app:
    build:
      context: ./app
    ports:
      - "3000:3000"
    depends_on:
      - backend

  gateway:
    build:
      context: ./gateway
    depends_on:
      - backend
    # optional in earliest milestones; simulated/seeded data may substitute for this service initially

volumes:
  convex-data:
  postgres-data:
```

### Local dev vs. self-hosted production

- **Local dev**: SQLite-backed `backend` (no `postgres` service needed), no reverse proxy, ports exposed directly to `localhost`, telemetry likely simulated/seeded rather than sourced from real machines.
- **Self-hosted production**: Postgres-backed `backend` for durability, a reverse proxy for TLS/single-origin access, real `gateway` service connected to actual machine protocols, and secrets (`INSTANCE_SECRET`, DB credentials) supplied via a secret store rather than committed env files.
- **Convex Cloud vs. self-hosted divergence to note**: Convex Cloud manages scaling, backups, and the dashboard for you; self-hosted requires operating Postgres (or accepting SQLite's single-node durability characteristics), managing your own backups/upgrades of the `convex-backend` image, and generating admin keys manually via `generate_admin_key.sh` inside the backend container. Some Convex Cloud-only features (e.g., certain integrations/observability tooling) may not have self-hosted equivalents — confirm against the current self-hosted README at implementation time, since this changes across releases.

## 13. README Update Plan

Once implementation starts, `README.md` must be updated to cover (checklist — not final content):

- [ ] Project overview (1–2 paragraphs, links back to this `initial-spec.md`).
- [ ] Prerequisites (Docker, Docker Compose version, Node/pnpm version for local frontend dev if run outside containers).
- [ ] Quickstart: `docker compose up` steps, including admin-key generation (`generate_admin_key.sh`) and first-run setup order (backend → dashboard → app).
- [ ] Environment variable table (mirrors §12, but with actual final variable names/defaults once implemented).
- [ ] Local Convex dashboard access URL (default `http://localhost:6791`) and what it's for (schema/data inspection, function logs) vs. the product's own operator dashboard.
- [ ] How to seed/test data (simulated telemetry generator or sample dataset script, once one exists).
- [ ] How to point the stack at Postgres instead of SQLite for a production-like run.
- [ ] Link(s) back to this spec file and to Convex's own self-hosted docs for deeper reference.
- [ ] Troubleshooting section for common first-run issues (port conflicts, missing admin key, backend not healthy before dashboard/app start).

## 14. Open Questions / Risks

- **Ingestion protocol(s)**: which machine protocol(s) must the gateway support (MQTT, OPC-UA, vendor REST/SDK, Modbus)? Not specified yet — materially changes gateway design. *(Blocking for gateway implementation, not for Convex schema/dashboard work.)*
- **Expected device count and telemetry frequency**: real numbers are needed to size ingestion batching (interval, batch size) and to validate the latency/retention assumptions in §7.
- **Retention window**: exact days/duration for raw telemetry retention is a business decision, not yet confirmed; affects whether a rollup/aggregation table (§9) is needed for v1 or can be deferred.
- **Notification channels beyond in-dashboard alerts**: is email/SMS/Slack/webhook alerting required for v1, or acceptable to defer? Affects scope of §6.3.
- **Frontend framework**: assumed React/Next.js per prompt instruction; not yet confirmed by the team. Also unconfirmed: charting library for telemetry visualization.
- **Auth provider**: not yet chosen (Convex Auth, Clerk, WorkOS, custom OIDC, etc.) — affects the exact shape of `users.authId` and login flow.
- **Device control (v2 candidate)**: if bidirectional control is ever required, this introduces a much larger safety/authorization design space (command acknowledgment, conflict resolution, fail-safes) intentionally excluded from this spec.
- **Self-hosted storage choice**: SQLite is simplest for early development but has single-node durability limits; confirm whether Postgres-backed self-hosting is required before any production pilot, not just local dev.
- **Alert rule evaluation location**: whether rules are evaluated inline inside the ingestion mutation (simplest, but adds latency/complexity to every write) or via a separate scheduled/triggered check — needs a design decision before implementation.
- **Multi-site/multi-tenant future**: explicitly out of scope now (§3), but worth flagging early since retrofitting tenant isolation into a schema is more disruptive than designing for it upfront — team should consciously accept this tradeoff.

## 15. Success Metrics

*(All figures below are targets to validate through implementation/load testing, not committed benchmarks.)*

- End-to-end update latency (device reading ingested → visible on a subscribed dashboard client) stays in the low single-digit seconds under expected load.
- Ingestion pipeline sustains the target device count/frequency (once confirmed, per §14) without dropped or rejected batches under normal operating conditions.
- Zero unauthorized cross-role data access in a manual security pass of all queries/mutations (every function enforces server-side role checks).
- A new engineer can go from a clean checkout to a running stack (`docker compose up` + seeded data visible on the dashboard) by following only the README, with no undocumented steps.
- Historical playback for a single device over the full retention window loads and renders without hitting Convex per-query read limits (validated via paginated queries).

## 16. Milestones (v0 → v1)

- **M0 — Schema & local scaffolding**: Convex project initialized, schema from §9 implemented, self-hosted Docker Compose stack (`backend` + `dashboard`, SQLite) running locally.
- **M1 — Seeded live dashboard**: Simulated/seeded telemetry generator feeding `ingest.recordBatch`; frontend app showing live device list + status via subscribed queries. No auth yet.
- **M2 — Auth & roles**: Authentication wired in; role-based access enforced on all functions per §6.5; role-appropriate UI gating.
- **M3 — Alerting**: Alert rules (§6.3) implemented, live alert feed on dashboard, acknowledge/resolve flow.
- **M4 — Historical playback**: Time-range queries, playback UI, CSV/JSON export (§6.4).
- **M5 — Deployability milestone**: Full stack (`backend`, `dashboard`, `app`, optional `postgres`, optional `gateway`) deployable via `docker compose up`; README quickstart followed end-to-end by someone outside the original implementers, with issues found fixed before sign-off.
- **v1 candidate**: All of the above complete; real (non-simulated) ingestion source connected for at least a pilot set of devices, pending resolution of the ingestion-protocol open question (§14).
