# Plan: Live telemetry view

> Written by planner. Realizes `specs/live-telemetry-view/spec.md` (R1–R8). HOW + research.
> No implementation code here; the builder turns this into `tasks.md` and code.
> Feature slug: `live-telemetry-view`. Realizes M1 / §6.2 of `specs/foundation/`.

## Decision summary

Read this first — these resolve the spec's open questions and one cross-feature dependency.

1. **No new tech.** Everything is built on what the repo already has: Convex reactive
   queries (`convex@1.44.0` installed) + Next.js App Router client components
   (`next@16.3.1`). No charting lib, no state manager, no CSS framework.
2. **Staleness (R6) is computed on the client**, from `lastSeenAt` + a single shared
   ticking clock — never with `Date.now()` inside a Convex query. Convex's own
   guidance is that a query is *not* re-run when wall-clock time advances, and that
   using `Date.now()` in a query churns the query cache
   ([Best Practices](https://docs.convex.dev/understanding/best-practices/)).
3. **Key metrics (R2) come from a server-side config module**, `backend/lib/keyMetrics.ts`,
   keyed by `device.type` with a default fallback. No schema change, no registry change.
4. **Expected reporting interval (R6)**: per-device-type default in
   `backend/lib/freshness.ts` — **10 s expected → stale after 30 s**, i.e. 3× the
   interval — overridable read-only per device via the existing
   `devices.metadata.expectedIntervalMs` string field. *Confirmed 2026-09-20.*
5. **Event log (R4)** = the device's last 50 raw `telemetry` rows (newest first) plus
   client-derived "gap" markers where consecutive readings are further apart than the
   staleness threshold. Explicitly reads nothing from `alerts`/`alertRules`.
6. **R8 is fully enforced via `auth-roles`, which has since landed.** *Updated
   2026-09-20 (post-merge):* this feature originally shipped behind a thin
   `requireAuth(ctx)` stub — a bare `ctx.auth.getUserIdentity()` check — ahead of
   `auth-roles`, with the reviewer instructed to mark R8 `Blocked`. `auth-roles` has since
   merged into `main` and was synced into this branch; every `liveView.*` query now goes
   through `authedQuery` (`backend/lib/functions.ts`) requiring the `data.read`
   capability — held by every role (viewer and up) — via `requireCapability`
   (`backend/lib/auth.ts`). The stub and its file are gone; call sites changed shape only
   at the wrapper (`query({...})` → `authedQuery({ capability: "data.read", ... })`), not
   in the guard's *position* (still the first thing every query does). **R8 is now
   `Met`, not `Blocked`** — see the updated coverage row below. This feature still did
   not choose or build the auth mechanism itself; it only consumes it.

---

## Architecture

```
                         ┌───────────────────────────────────────────┐
                         │ Convex backend  (backend/)                │
  gateway/simulator ───▶ │                                           │
   ingest.recordBatch    │  telemetry ──┐        devices ──┐         │
   (service token,       │  (append)    │        (status,  │         │
    NOT user auth)       │              ▼         lastSeenAt)        │
                         │        ┌─────────────────────────┐        │
                         │        │ backend/liveView.ts     │        │
                         │        │  · overview             │◀── authedQuery
                         │        │  · deviceSnapshot       │   ("data.read",
                         │        │  · recentEvents         │    auth-roles)
                         │        └─────────┬───────────────┘        │
                         │   reads via      │  backend/lib/          │
                         │   by_device_metric_and_ts, by_device_and_ts│
                         └──────────────────┼────────────────────────┘
                                            │ reactive subscription
                                            │ (WebSocket push, no polling)
                                            ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │ Next.js App Router  (frontend/)   ConvexProvider already wired    │
     │                                                                   │
     │  /                       "use client"  useQuery(liveView.overview)│
     │   ├─ FilterBar        ── zone / type / status, state in URL params│
     │   ├─ DeviceGrid       ── group-by headers, client-side filtering  │
     │   └─ DeviceCard[]     ── status + lastSeen + key metrics + Stale  │
     │                                                                   │
     │  /devices/[deviceId]     server shell: `const {deviceId}=await    │
     │                          props.params` → renders client child     │
     │   ├─ DeviceHeader     ── status, lastSeen, Stale treatment        │
     │   ├─ MetricTable      ── useQuery(liveView.deviceSnapshot)        │
     │   └─ EventLog         ── useQuery(liveView.recentEvents)          │
     │                                                                   │
     │  lib/useNow.ts  ── ONE module-level 1 s interval, shared by every │
     │                    component via useSyncExternalStore             │
     │  lib/freshness.ts ── pure (lastSeenAt, expectedIntervalMs, now)   │
     │                      → "live" | "stale" | "never"                 │
     └──────────────────────────────────────────────────────────────────┘
```

Two independent update channels feed the same UI:

- **Data changes** (new telemetry row, `devices.status`/`lastSeenAt` patch) arrive by
  Convex's reactive subscription. The client holds an open WebSocket; Convex tracks the
  read set of each subscribed query and pushes a new result whenever a document in that
  read set changes — no polling, no manual invalidation
  ([Convex React](https://docs.convex.dev/client/react)). This is R5.
- **Time passing** is handled entirely in the browser by the `useNow` tick. Nothing on
  the server needs to re-run for a device to *become* stale. This is R6.

Keeping those two channels separate is the central design idea of this plan: it means
a device going quiet (the case that matters most to an operator) still changes the UI,
even though by definition no write happens when a device goes quiet.

---

## Tech decisions

| Decision | Choice | Rationale | Rejected alternative |
|---|---|---|---|
| Realtime transport | Convex reactive `useQuery` subscriptions, already wired via `ConvexProvider` in `frontend/app/providers.tsx` | The stack's built-in mechanism: read-set tracking + WebSocket push means R5 needs zero extra code. Foundation §11 already commits to this. | Client `setInterval` refetch or SSE endpoint — reintroduces polling, which R5 forbids, and adds a second transport to operate |
| Where the feature's queries live | New `backend/liveView.ts` (`overview`, `deviceSnapshot`, `recentEvents`) | Keeps this feature's read surface in one file the reviewer can audit against R1–R8, instead of growing registry-owned (`devices.ts`) and ingestion-owned (`telemetry.ts`) modules. | Adding view-shaped queries to `devices.ts`/`telemetry.ts` — blurs the feature boundaries the specs deliberately draw |
| Overview data fetch shape | **One** server query returning devices joined with their key metrics | One subscription, one consistent snapshot, one cache entry shared across all viewers. Convex caches identical-argument queries, so N operators cost one recompute. | One `useQuery` per device row (N subscriptions): no cross-row consistency, N× subscription bookkeeping per client, and rows update at different instants |
| Latest-value read pattern | Per `(deviceId, metric)`: `withIndex("by_device_metric_and_ts").order("desc").take(1)`, issued in parallel with `Promise.all` | Exact and bounded: ~3 docs/device instead of the current 200-row scan. 200 devices × 4 metrics = 800 docs, far under the 16 384-doc / 8 MiB / 1 s per-transaction limits ([Limits](https://docs.convex.dev/production/state/limits)). | The existing `.take(200)`-then-reduce heuristic — silently drops a metric that stopped reporting, and reads ~60× more rows per device |
| Staleness computation | Client-side, `lastSeenAt` vs a shared `useNow()` tick | Convex: a query is *not* re-run when `Date.now()` changes, and `Date.now()` in a query invalidates the cache far more than necessary ([Best Practices](https://docs.convex.dev/understanding/best-practices/)). Client-side gives a 1 s-accurate flip at zero backend cost. | (a) `Date.now()` in the query — stale results *and* cache churn; (b) a Convex cron writing a `stale` flag — a write path into `devices`, which is registry/ingestion territory, and coarser than the UI needs |
| Key-metric selection | `KEY_METRICS_BY_TYPE` constant in `backend/lib/keyMetrics.ts`, default `["temperature_c","cycle_count","error_code"]`, cap 4 per type | Resolves the spec's open question without a schema or registry change; server-side so it can bound the read. Matches the metrics the simulator actually emits. | A new `metricConfig` table or `devices.metadata` writes — both are device-metadata management, an explicit non-goal |
| Expected reporting interval | `EXPECTED_INTERVAL_MS_BY_TYPE` (default 10 000 ms), × a `STALE_FACTOR` of 3; per-device override read from `devices.metadata.expectedIntervalMs` (parse the string, ignore if unparseable) | Uses a field the registry already owns without writing to it, and gives a sane default everywhere else. | Hard-coding one global threshold — the spec says the interval is likely per-device-type; a new schema column — registry change |
| Detail-view routing | Real route `frontend/app/devices/[deviceId]/page.tsx` | R3 says "select a device and *reach* a detail view". A route is deep-linkable, back-button correct, and is covered by auth-roles' route gate for R8. | Today's `useState` split-pane in `frontend/app/page.tsx` — not linkable, not shareable, and invisible to route-level auth |
| Next 16 param handling | `page.tsx` stays a server component that does `const { deviceId } = await props.params`, then renders a `"use client"` child | Next.js 16 removed synchronous `params`; they are Promises now ([upgrade guide](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/upgrading/version-16.mdx)). A thin server shell is the least surprising way to satisfy it. | `"use client"` on the route file + `React.use(params)` — works, but mixes concerns and is easy to get wrong on a React 18 runtime |
| Filtering & grouping (R7) | Client-side over the already-subscribed overview list; filter/group state in URL search params | At the spec'd scale (tens–low hundreds of devices) filtering is instant with no extra round trip, keeps one shared cache entry, and URLs become shareable between operators. `type` isn't indexed anyway. | Server-side filtered queries via `by_zone_and_status` — one cache entry *per filter combination*, no `type` coverage, and a round trip per keystroke |
| Overview at scale | Plain DOM rows, server read bounded to 500 devices, "showing first N" notice past the cap | Spec'd ceiling is low hundreds; virtualization is measurable complexity for a problem the deployment doesn't have yet. The cap prevents an unbounded read regression. | `react-window`/virtualization now — new dependency, harder to test, premature |
| Styling | CSS Modules (built into Next.js) for the new components | The app currently uses ad-hoc inline styles; a growing component set needs real class-based styling for the stale treatment, and CSS Modules ship with the framework. | Tailwind (new toolchain + config + build step) or CSS-in-JS (runtime cost, RSC friction) |
| Stale affordance | Badge with **text** ("Stale · 4m ago") + muted metric values + an icon — not colour alone | R6 says "visually distinguished"; colour-only fails for colour-blind operators and is untestable by text assertion. Text makes the acceptance check straightforward. | Red text / red border only |
| Auth gating (R8) | `authedQuery({ capability: "data.read", ... })` (`backend/lib/functions.ts`, auth-roles) wrapping every `liveView.*` query, plus the auth-roles route gate (`frontend/proxy.ts`) | Server-side enforcement on the data path is the only thing that actually satisfies "no telemetry reaches an unauthenticated request"; route gating alone can be bypassed by calling the query directly. `data.read` is the minimum-role capability (every role holds it), matching R8's "any authenticated user" requirement exactly. | Route/middleware gating only, or a client-side redirect — both leave the query callable; a bespoke `requireAuth` stub — superseded once auth-roles landed |

---

## Data model

**No schema changes.** `backend/schema.ts` is untouched by this feature. Everything is
read from tables the registry and ingestion features already own.

### Tables read (existing, read-only here)

| Table | Fields used | How it's read |
|---|---|---|
| `devices` | `_id`, `externalId`, `name`, `type`, `zone`, `status`, `lastSeenAt`, `isActive`, `metadata` | Overview: `isActive === true` only, bounded `.take(500)` (R1 says "every active (non-decommissioned) device"). Detail: `ctx.db.get(deviceId)`; a decommissioned device reached by direct link still renders, labelled "decommissioned", rather than 404-ing — it just never appears in the overview list. |
| `telemetry` | `_id`, `deviceId`, `ts`, `metric`, `value` | Latest-per-metric via `by_device_metric_and_ts` desc `.take(1)`; event log via `by_device_and_ts` desc `.take(limit)`. |

**Never read by this feature:** `alerts`, `alertRules` — R4 requires the event log be
distinct from alert history. `users` is read only indirectly, inside `requireCapability`
(auth-roles' `backend/lib/auth.ts`), to resolve the caller's role for the `data.read`
capability check.

### Configuration (code constants, not stored data)

```
backend/lib/keyMetrics.ts
  KEY_METRICS_BY_TYPE : Record<deviceType, string[]>   // ≤ 4 entries each
  DEFAULT_KEY_METRICS : string[]                        // fallback for unknown types

backend/lib/freshness.ts   (shared shape; the threshold values live server-side,
frontend/lib/freshness.ts   the comparison runs client-side)
  EXPECTED_INTERVAL_MS_BY_TYPE : Record<deviceType, number>   // default 10_000
  STALE_FACTOR = 3                                            // → stale after 30 s
  expectedIntervalMsFor(device) : number
    // devices.metadata.expectedIntervalMs (string) → Number(); NaN/≤0 → type default
```

The server resolves `expectedIntervalMs` per device and returns it with each row, so the
client never needs to know the config — it only compares numbers. That keeps the
threshold in one place and makes it trivially testable.

### Derived view models (function return shapes — the real "data model" of this feature)

```
DeviceOverviewRow
  deviceId: Id<"devices">
  externalId, name, type: string
  zone: string | undefined
  status: "online" | "offline" | "unknown"     // stored value, shown verbatim (R1)
  lastSeenAt: number | undefined               // ms epoch (R1)
  expectedIntervalMs: number                   // resolved server-side (R6)
  keyMetrics: MetricReading[]                  // ≤ 4, in configured order (R2)

MetricReading
  metric: string
  value: number | string
  ts: number

DeviceSnapshot                                 // detail view (R3)
  device: DeviceOverviewRow-ish (same fields, plus metadata, isActive)
  metrics: MetricReading[]                     // ALL current metrics, see below

EventLogEntry                                  // detail view (R4)
  kind: "reading"                              // server-provided
  id: Id<"telemetry">, ts: number, metric: string, value: number | string
  // the client additionally synthesizes { kind: "gap", fromTs, toTs } markers
  // between consecutive entries whose spacing exceeds the staleness threshold

Freshness  (pure client function, never stored)
  "never"  — lastSeenAt is undefined
  "live"   — now - lastSeenAt <= expectedIntervalMs * STALE_FACTOR
  "stale"  — otherwise
```

**"All current metrics" for the detail view (R3).** There is no per-device metric
registry, so the metric set must be discovered. `deviceSnapshot` takes the union of
(a) the configured key metrics for the device type and (b) the distinct metric names
appearing in the most recent 200 telemetry rows for that device, then resolves each one
exactly with a `by_device_metric_and_ts` desc `.take(1)`. Discovery is a bounded scan;
resolution is exact, so a metric that stopped reporting an hour ago still shows its last
value rather than silently disappearing.

### Backend functions this feature adds

| Function | Type | Args | Guard | Requirement |
|---|---|---|---|---|
| `liveView.overview` | authed query (subscribed) | — | `authedQuery`, capability `data.read` | R1, R2, R5, R6, R7, R8 |
| `liveView.deviceSnapshot` | authed query (subscribed) | `deviceId` | `authedQuery`, capability `data.read` | R3, R5, R6, R8 |
| `liveView.recentEvents` | authed query (subscribed) | `deviceId`, `limit?` (default 50, max 200) | `authedQuery`, capability `data.read` | R4, R5, R8 |

Existing functions: `devices.listActive`, `devices.get`, `telemetry.latestForDevice` stay
as they are (other features and `specs/foundation/plan.md` §10 reference them). The
"latest reading per metric" logic should be factored into `backend/lib/latestMetrics.ts`
and reused by `telemetry.latestForDevice` so the exact-`take(1)` improvement lands in one
place rather than being duplicated.

---

## Requirement coverage

| Req | Addressed by |
|---|---|
| **R1** — overview shows status + last-seen for every active device | `liveView.overview` reads active devices (bounded `.take(500)`) and returns `status` and `lastSeenAt` **verbatim from the stored document**; `DeviceCard` renders both. Stale treatment (R6) is layered as a *separate* affordance so the displayed status still matches stored state, as the R1 acceptance criterion requires. |
| **R2** — overview shows current key metric values | `liveView.overview` resolves each device's key metrics (from `KEY_METRICS_BY_TYPE`, ≤4) with an exact `by_device_metric_and_ts` desc `.take(1)` per metric, in parallel. Exact-latest, not a sampled scan, so no stale/placeholder values. `DeviceCard` renders `keyMetrics`; a metric with no reading renders as "—", distinguishable from a zero. |
| **R3** — detail view with all current metrics | Route `frontend/app/devices/[deviceId]/page.tsx` (server shell awaits `params`, client child subscribes). `liveView.deviceSnapshot` returns the union of configured + discovered metrics, each resolved exactly. `DeviceCard` on the overview links to this route. |
| **R4** — recent event log, distinct from alerts | `liveView.recentEvents` reads only `telemetry` via `by_device_and_ts` desc `.take(50)`; the `EventLog` component renders timestamped reading entries plus client-derived gap markers. The function touches neither `alerts` nor `alertRules` — reviewable as a one-line assertion on the file's imports and `ctx.db.query` calls. |
| **R5** — automatic updates, no refresh/poll | All three queries are plain Convex `useQuery` subscriptions. Convex tracks each query's read set and pushes a new result over the existing WebSocket when a document in it changes; `ingest.recordBatch` writes a `telemetry` row *and* patches `devices.lastSeenAt`, both of which are in the read sets above. No `setInterval` refetch, no `router.refresh()`, no revalidation anywhere in the feature. |
| **R6** — stale visually distinguished, overview **and** detail | `frontend/lib/useNow.ts` (one module-level 1 s interval, shared via `useSyncExternalStore`) + `frontend/lib/freshness.ts` pure classifier, using the `expectedIntervalMs` each query returns. Consumed by `DeviceCard` (overview) and `DeviceHeader`/`MetricTable` (detail) so the treatment is identical in both places: text badge ("Stale · 4m ago") + icon + muted metric values, never colour alone. Because the tick is client-side, a device that simply goes quiet flips to stale with no write and no server work. |
| **R7** — filter/group by zone, type, status | `FilterBar` + `DeviceGrid` filter and group the already-subscribed `overview` array client-side; selections are mirrored into URL search params (`?zone=&type=&status=&groupBy=`) so a filtered view is shareable and survives reload. Clearing a filter restores the full list because the underlying subscription is never re-scoped. Fields are exactly the three foundation §6.1 req. 4 names for the device list (`zone`, `type`, `status`) — see the R7 note under "Risks". |
| **R8** — authenticated session required, no data to unauthenticated requests | Every `liveView.*` query is wrapped in `authedQuery({ capability: "data.read", ... })` (`backend/lib/functions.ts`), which resolves the caller via `getAuthUserId`/`requireCapability` (`backend/lib/auth.ts`) and throws the uniform opaque `NOT_AUTHORIZED` error before the handler runs — an unauthenticated or deactivated caller gets no device or telemetry data. The routes `/` and `/devices/[deviceId]` additionally sit behind auth-roles' route gate (`frontend/proxy.ts`). This feature adds no unauthenticated read path. **Status: `Met`** — updated 2026-09-20 after `auth-roles` merged into this branch and the `requireAuth` stub was replaced with the real guard; `backend/liveView.test.ts` now authenticates through `tests/testUtils.ts`'s `createUserFixture` (a real `users` row + Convex Auth identity) instead of a fake identity, and asserts the `NOT_AUTHORIZED` denial. |

---

## Risks & unknowns

- **Resolved 2026-09-20: R8 is fully verified.** `auth-roles` has landed on `main` and was
  merged into this branch. The `requireAuth(ctx)` stub is gone; every `liveView.*` query
  now runs through the real `authedQuery`/`requireCapability` guard (`data.read`
  capability), and `backend/liveView.test.ts` authenticates through
  `tests/testUtils.ts`'s `createUserFixture` — a real `users` row plus a Convex Auth
  identity, not a fake one. No residual risk remains here; this bullet is kept for
  history rather than deleted outright.
- **Next.js 16 + React 18 mismatch.** The repo runs `next@16.3.1` with `react@18.3.1`
  (lockfile), but Next 16's own upgrade guide states Next 16 requires React 19.2
  ([version-16.mdx](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/upgrading/version-16.mdx)).
  It currently works, but new client-component patterns may hit an unsupported path.
  *Mitigation:* `frontend/AGENTS.md` is explicit — the builder must read
  `node_modules/next/dist/docs/` after `npm install` before writing any frontend code.
  If a needed API requires React 19, **stop and escalate** rather than bumping React:
  that upgrade is cross-cutting and also affects auth-roles.
- **Resolved 2026-09-20: `middleware.ts` → `proxy.ts` was correctly handled.** Next 16
  renamed `middleware.ts` to `proxy.ts` (edge runtime unsupported; Node runtime only).
  This was flagged as a risk against `specs/auth-roles/plan.md`'s stale naming before
  that feature landed; the merged `frontend/proxy.ts` confirms auth-roles used the
  correct Next 16 name in the actual implementation (its own `plan.md`'s naming may still
  be stale — out of scope for this spec to fix).
- **Devices never transition back to `offline`.** `ingest.recordBatch` only ever sets
  `status: "online"`; nothing flips a silent device to `offline`. So R1's stored status
  is truthful but practically always "online", and the *operator-visible* signal for a
  dead device is entirely the R6 stale treatment. *Mitigation:* accepted for this
  feature (writing `devices.status` is registry/ingestion territory, an explicit
  non-goal). The "offline reaper" — a scheduled function flipping status after a
  heartbeat timeout, which is also Convex's recommended pattern for time-based state
  ([Best Practices](https://docs.convex.dev/understanding/best-practices/)) — should be
  filed against the device-registry or ingestion feature. Flagging so the reviewer does
  not read "status is always online" as a bug in *this* feature.
- **Clock skew.** `devices.lastSeenAt` is the *device-supplied* `ts` (`ingest.recordBatch`
  patches `lastSeenAt: r.ts`), and freshness compares it against the *browser's* clock. A
  gateway with a skewed clock will read as permanently stale or permanently fresh.
  *Mitigation:* v1 assumes gateway and browser are roughly NTP-synced (reasonable on a
  factory LAN); document the assumption. The durable fix is a server-side `receivedAt`
  written at ingestion — an ingestion-feature change, out of scope here.
- **Staleness threshold default is unconfirmed** (spec open question). 10 s expected /
  30 s stale is a guess that suits the 2 s simulator; a real CNC reporting every 5 min
  would be wrong. *Mitigation:* the value is one constant plus a per-device
  `metadata.expectedIntervalMs` override, so changing it is a one-line edit — but get it
  confirmed (below) before operators rely on it.
- **Overview read amplification.** Convex caps a transaction at 16 384 docs / 8 MiB /
  **1 second** of execution ([Limits](https://docs.convex.dev/production/state/limits)).
  200 devices × 4 metrics = 800 indexed single-row reads is comfortably under the doc
  cap, but the 1 s wall-clock budget is the binding constraint if the reads run
  sequentially. *Mitigation:* issue them with `Promise.all`, cap key metrics at 4, cap
  devices at 500, and have the builder measure the function's duration in the Convex
  dashboard with the simulator running before declaring the task done.
- **Overview re-runs on every ingest batch.** Its read set spans all active devices, so
  any device's reading invalidates the whole query (~2 s cadence with the simulator).
  That is correct behaviour and the cost is shared — Convex serves one recompute to all
  same-argument subscribers — but it does mean overview cost scales with *total* ingest
  rate, not per-viewer. *Mitigation:* measure as above; if it ever becomes the
  bottleneck, the escape hatch is a denormalized latest-value table written at ingest —
  deliberately not done now because it is an ingestion-path change.
- **`devices.listActive` uses an unbounded `.collect()` with a post-hoc `.filter()`**,
  against Convex's guidance to bound reads and prefer indexes
  ([Best Practices](https://docs.convex.dev/understanding/best-practices/)). This
  feature does not use it (the overview reads devices itself, bounded), but the existing
  function remains a latent scaling bug. *Mitigation:* out of scope; worth a note to the
  registry feature. Do **not** let `liveView.overview` copy the pattern.
- **R7 says "consistent with the device list's existing filter/grouping capability" — no
  such capability exists yet** in `frontend/app/page.tsx`. *Resolution taken:* treat the
  overview screen *as* the device list and implement filter/group on the three fields
  foundation §6.1 req. 4 names (zone, type, status). No guessing involved, but noted so
  the reviewer does not go looking for a prior implementation to match.
- **Event log has no true status-change history.** `devices.status` is a single mutable
  field with no audit trail, so "recent telemetry/status activity" is served by readings
  plus derived gap markers. *Mitigation:* documented as the v1 interpretation; a real
  `deviceEvents` table would be a registry/ingestion schema addition.
- **Convex docs were unreachable directly** — `docs.convex.dev`, `stack.convex.dev`,
  `nextjs.org` and `npmjs.com` are all blocked by this session's egress policy. The
  Convex claims above were verified through search result content rather than a direct
  fetch; version numbers were verified directly against GitHub (see Sources). The
  builder, who can install packages, should re-confirm the API details against
  `node_modules` before coding.

---

## Sources

Fetched directly:

- [vercel/next.js — Next.js 16 upgrade guide (canary docs)](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/upgrading/version-16.mdx) — async `params`/`searchParams`, `middleware` → `proxy`, React 19.2 requirement, Node ≥ 20.9.
- [vercel/next.js releases](https://github.com/vercel/next.js/releases/latest) — latest Next.js is **16.3.5** (2026-09-11); repo has 16.3.1.
- [get-convex/convex-js tags](https://github.com/get-convex/convex-js/tags) — latest `convex` is **1.46.0** (2026-09-16); repo lockfile has 1.44.0.
- [get-convex/convex-js CHANGELOG](https://raw.githubusercontent.com/get-convex/convex-js/main/CHANGELOG.md) — confirms 1.46.0 as the top entry.

Consulted via search (direct fetch blocked by egress policy):

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) — avoid unbounded `.collect()`, prefer `.take()`/`.paginate()` and indexes; `Date.now()` in a query does not trigger re-runs and churns the query cache; use a scheduled-function-maintained coarse field or a client-rounded time argument instead.
- [Convex Limits](https://docs.convex.dev/production/state/limits) — 16 384 docs / 8 MiB read and 1 s execution per query or mutation.
- [Convex React client](https://docs.convex.dev/client/react) — `useQuery` holds a live WebSocket subscription; results are pushed on change, no polling.
- [Convex Reading Data / Indexes](https://docs.convex.dev/database/reading-data/indexes/) — indexed range reads instead of `.filter()` for large or unbounded sets.
- [Next.js React version support](https://nextjs.org/docs/messages/react-version) — React 18.2+ still runs on Next 16 but is deprecated; React 19 recommended, required in Next 17.

In-repo context relied on: `specs/foundation/spec.md` §6.1–§6.2, §9–§11; `specs/foundation/plan.md` (M1/M2 status); `specs/auth-roles/plan.md` (`requireAuth`, `backend/lib/auth.ts`); `specs/alerting/spec.md` (alert-history boundary for R4); `backend/schema.ts`, `backend/ingest.ts`, `backend/telemetry.ts`, `backend/devices.ts`, `frontend/app/page.tsx`, `frontend/AGENTS.md`.

---

## Summary

Three lines, as required:

1. The live view is built entirely on what the repo already has — Convex reactive
   subscriptions for data changes, a single client-side 1 s clock for time passing —
   with three new auth-gated queries in `backend/liveView.ts`, a rewritten overview
   page, and a new `/devices/[deviceId]` route. No schema change, no new dependency.
2. The spec's four open questions are resolved here as code-level configuration
   (key metrics per type, 10 s expected interval × 3 = 30 s stale with a per-device
   `metadata` override, a 50-entry telemetry-derived event log, and no virtualization
   below 500 devices) — each a one-constant change if the team disagrees.
3. The remaining load-bearing assumption is that device-supplied timestamps are roughly
   clock-synced with the browser (R6). The other assumption this section originally
   listed — that the `requireAuth` stub would genuinely be filled in when `auth-roles`
   landed — has been resolved: `auth-roles` merged into `main` on 2026-09-20 and was
   synced into this branch, replacing the stub with the real `authedQuery`/
   `requireCapability` guard. **R8 is `Met`.**

**Decisions confirmed 2026-09-20 — none outstanding, the builder is clear to start:**

- **R8 sequencing — superseded 2026-09-20 (post-merge).** The live view shipped first,
  ahead of `auth-roles`, exactly as planned: a thin `requireAuth(ctx)` stub sat at every
  `liveView.*` call site against auth-roles' agreed signature, and the reviewer correctly
  marked R8 `Blocked`, not `Met`, in the first review round. `auth-roles` has since
  landed and was merged into this branch; the stub is gone, replaced by the real
  `authedQuery({ capability: "data.read", ... })` guard, and R8 is now `Met`. Carried
  into Decision summary §6, the R8 coverage row, and the first risk bullet, all updated
  above.
- **Staleness threshold.** 10 s expected reporting interval × 3 = **30 s**, with
  `devices.metadata.expectedIntervalMs` as the per-device override. Proceed with these
  defaults. Still a one-constant change in `EXPECTED_INTERVAL_MS_BY_TYPE` if real device
  types turn out to report on the order of minutes.
- **Overview key metrics.** `temperature_c`, `cycle_count`, `error_code` (what the
  simulator emits), capped at 4 per device type. Proceed with these defaults.
