# Plan: Device registry

> Written by planner. Realizes `specs/device-registry/spec.md` (R1–R31). HOW + research.
> No implementation code here; the builder turns this into `tasks.md` and code.
> Branch context: `sdd-agent-tools`. **`backend/lib/` does not exist on this branch** and the
> auth-roles implementation is not being merged in — see "Auth seam" below for how R16/R17/R31
> are met standing alone.

## Decision summary

Answers to the spec's open questions, decided here so the builder never has to guess:

| Open question | Decision |
|---|---|
| Heartbeat window default | **60 s**, env-configurable (`DEVICE_HEARTBEAT_WINDOW_MS`). Sweep every **15 s**, so the documented worst-case visibility delay is **window + 15 s (≤ 75 s)**. |
| Per-device-type window override | **Not in v1.** One resolver function owns the window so adding an override later is a one-place change. |
| Hard delete | **No** (R27 stands). No delete path is exposed, and a test asserts its absence. |
| Identifier normalization | **Trim, then lowercase.** The as-entered (trimmed) value is displayed; the normalized value is what uniqueness compares. No character-set constraint in v1. |
| Zone/type vocabulary | **Free text, trimmed.** The admin form offers existing values as suggestions to discourage fragmentation. A controlled vocabulary is deferred (it would be a new entity, a non-goal). |
| Filtering UX | Persistent filter bar above a paginated table, plus a grouping toggle in the same view. Filter state lives in the URL query string so a filtered view is shareable/bookmarkable. |
| Audit trail scope | **General `auditLog` table**, device-scoped API surface in v1. Cheap now, expensive to retrofit — as spec-writer noted. No retention policy in v1 (documented as a known gap). |
| "Seen but unregistered" list | Out of scope, as specified. The counter infrastructure R26 introduces makes it a small follow-up. |

Plus two decisions the spec did not ask for but the implementation forces:

- **`isActive: boolean` becomes `lifecycle: "in_service" | "decommissioned"`** on `devices`, via a
  two-phase schema migration. R28 requires lifecycle to read distinctly from connectivity; a boolean
  named `isActive` sitting next to a `status` field is exactly the confusion R28 exists to prevent.
- **Connectivity state stays a stored, denormalized field** (not computed at read time). This is not a
  preference — see "The one hard constraint" below.

## The one hard constraint (read this first)

Convex freezes `Date.now()` for the whole execution of a function, and query results are cached and
re-pushed to subscribers **only when data the query read changes**. A query that derives
online/offline by comparing `Date.now()` against `lastSeenAt` would therefore return a correct value
when first run and then **never update again** while no telemetry arrives — which is precisely the
R3 case ("transitions to offline with no further telemetry"). R6 and R10 would fail the same way,
silently, and would look fine in any test that does not hold a subscription open across the window.

The documented remedy is to have a scheduled function write the state into the document, so the
subscription is invalidated by a real data change. Every architectural choice below follows from that.

## Architecture

```
gateway/simulator ──ingest.recordBatch──┐
                                        │  normalizes externalId, looks up by
                                        │  externalIdKey, writes telemetry,
                                        │  patches devices.status="online" + lastSeenAt
                                        ▼
                         ┌──────────────────────────────┐
  crons.ts (every 15s)   │        devices table         │
  devices.sweepOffline ─▶│  status  lifecycle  lastSeen │◀── devices.register / update /
  (internalMutation)     └──────────────────────────────┘    decommission / reactivate
   index scan:                     │         │               (each: validate → patch → audit,
   lifecycle=in_service            │         │                one transaction)
   status=online                   │         └──────────▶ auditLog table
   lastSeenAt < now-window         │                          (entity, actor, at, changes[])
   → patch status="offline"        │
                                   ▼ reactive subscriptions (websocket push)
                    devices.list (paginated) · devices.get · devices.facets
                    devices.changeHistory (admin) · access.currentActor
                                   │
                                   ▼
                    frontend /devices — filter bar + grouped/paginated table,
                    detail panel (lifecycle badge ≠ connectivity badge),
                    admin register/edit/decommission forms, history tab
```

Three writers touch `devices.status`: ingest (→ online), the sweeper (→ offline), and reactivate
(recomputes once). Nothing else. Readers never compute it. That is what makes R5 true by
construction: list, detail and `status=` filter all read the same stored field, so they cannot
disagree.

## Tech decisions

| Decision | Choice | Rationale | Rejected alternative |
|---|---|---|---|
| Offline transition | Cron `crons.interval` every 15 s running an `internalMutation` sweeper | Convex crons support seconds-level granularity; a write is the only thing that invalidates a subscription, so this is the only mechanism that satisfies R3/R6/R10. Bounded, documented delay. | Compute at read time from `Date.now()` (breaks R3/R6/R10 — frozen clock + data-only cache invalidation); `scheduler.runAfter` per device per batch (thousands of scheduled jobs, churn, no natural dedupe) |
| Sweeper scan | Index `by_lifecycle_status_lastSeenAt`, range `lifecycle=in_service AND status=online AND lastSeenAt < cutoff`, `take(500)` per run, re-schedule if the page was full | Exact index-prefix usage, so the scan touches only devices that are actually crossing. Far inside the 32,000-doc / 16,000-write transaction limits at the §7 target of low hundreds. Patches only devices that change, so idle sweeps push nothing. | Scan all devices and compare in JS (wasted reads, and an unbounded scan as the fleet grows — the exact anti-pattern foundation §7 calls out) |
| Heartbeat window config | `process.env.DEVICE_HEARTBEAT_WINDOW_MS`, read through one resolver in `backend/lib/config.ts`, default 60000 | Convex env vars are settable from the dashboard or `npx convex env set` with no redeploy — literally "changeable without a code change" (R4). One resolver keeps R2/R4 in a single place. | Hard-coded constant (fails R4); typed `env` from `_generated/server` (available in convex 1.46, but needs a new `convex.config.ts`; optional upgrade, not required) |
| Sweep interval | Code constant, **not** env | `crons.ts` is evaluated at push time, so an env-driven interval would not take effect without a redeploy anyway. R4 only requires the *window* to be configurable. Document the 15 s constant. | Env-driven interval (misleading — looks configurable, isn't) |
| Uniqueness (R19/R20) | Store `externalIdKey` = `trim().toLowerCase()`; index `by_externalIdKey`; read-then-insert inside the mutation | Convex has no unique constraint, but mutations are serializable with automatic conflict-retry, so a read-then-write uniqueness check is genuinely race-free here — unlike in most databases. | Rely on the existing `by_externalId` exact index (lets `robot-01` and `ROBOT-01` coexist; fails R20) |
| Immutable externalId (R21) | `devices.update` simply does not declare `externalId` in its args validator | Convex arg validators reject undeclared fields, so an attempt to supply one is refused by the platform before the handler runs. Free enforcement, trivially testable. | Accept-and-ignore (silently drops an intent the caller had; harder to test) |
| List bounding (R11) | `paginationOptsValidator` + `.paginate()`, default page 50, `usePaginatedQuery` on the client | Paginated queries stay fully reactive, which R10 needs. Cursor-based, so navigation has no duplicates or omissions. | `.collect()` (today's `listActive`, unbounded); cap + "more exist" flag (allowed by R11 but fails its "navigating retrieves the remainder" clause) |
| Multi-dimension filtering (R7) | Narrow on the most selective active filter via an index, apply the residual predicates in JS within the same query | Convex indexes only range over a prefix, so no single index serves every zone/type/status combination. Convex's own guidance is that `.filter()`-style narrowing is fine below a few thousand rows; foundation §7 targets low hundreds. | One composite index per combination (index explosion, write overhead, still wouldn't cover every order); a search index (wrong tool — these are exact-match facets) |
| Facets & counts (R8/R9) | Separate `devices.facets` query: index-narrowed read of the filtered set (hard cap 1000 + truncation flag), tallied in memory | Derives choices from data that actually exists (R9) with no hard-coded list, and counts respect the active filters (R8). Bounded and cheap at the target fleet size. | Denormalized counter table maintained on every write (premature, and a second source of truth that can drift from R5's consistency promise) |
| Lifecycle field | `lifecycle` union replacing `isActive`, plus `decommissionedAt` / `decommissionedBy` | R28 needs lifecycle legible as its own concept. A union is self-documenting, extensible, and makes the sweeper's index prefix natural. | Keep `isActive` (reads as a second status field; R28 hazard) |
| Schema migration | Two phases: add `lifecycle` optional + backfill via a one-off `internalMutation`, then make it required and drop `isActive` | Convex validates the whole table against the schema on push, so adding a required field to a table with existing rows fails the push. Two-phase is the safe path even though this deployment's data is simulated. | Single-shot rename (push fails against any non-empty `devices` table); wipe the volume (works locally, not a procedure to document) |
| Audit trail | General `auditLog` table (`entityTable` + `entityId` + `action` + actor + `changes[]`), written in the same mutation as the change | Convex mutations are atomic transactions, so "succeeded ⇒ audited, failed ⇒ no trace" (R30) is free — validation throws before any write, and a throw rolls the whole transaction back. Generic shape so role changes and alert-rule edits reuse it later. | A `deviceChanges` table (retrofitting generality later means migrating rows and rewriting readers); a Convex Triggers component (adds a dependency; we need the actor and the intent, which a trigger doesn't see) |
| Auth (R16/R17/R31) | Local `backend/lib/access.ts` seam — see below | Self-contained, honestly testable, one file to swap when auth-roles lands | Depend on auth-roles landing first (blocks this feature on another branch); no gating at all (R17/R31 become untestable assertions) |
| Tests | `convex-test` + `vitest` | Official harness for Convex functions; `t.withIdentity()` is what makes the R17/R31 allow/deny matrix testable without a UI. Same choice auth-roles/plan.md made, so the two merge cleanly. | Manual/e2e only (can't cheaply assert per-role deny, can't advance time for R3) |

### Auth seam (R16/R17/R31 without auth-roles)

`backend/lib/access.ts` is the **single** place that answers "who is calling and are they an admin".
Nothing else in this feature touches identity.

- `getActor(ctx)` — if `ctx.auth.getUserIdentity()` returns an identity, resolve it to a row in the
  existing `users` table (which already carries the four-role union in `backend/schema.ts`) and
  return `{ userId, label, role }`. If there is no identity, consult the escape hatch below.
- `requireAdmin(ctx)` — returns the actor when `role === "admin"`, otherwise throws a single opaque
  error that does not distinguish "forbidden" from "not found" (matches auth-roles R6, so behaviour
  doesn't change when the real helpers arrive).
- Escape hatch: `DEVICE_REGISTRY_REQUIRE_ADMIN` (default **false** on this branch). When false and
  no identity is present, `getActor` returns a synthetic actor `{ userId: undefined, label:
  "unauthenticated-dev", role: "admin" }`. When true, no identity means denied.
- `access.currentActor` query returns `{ role }` for the frontend to gate controls on (R16).

Why this is defensible rather than a fudge:

- The **enforcement path is real and fully tested today**. `convex-test`'s `t.withIdentity()` seeds a
  `users` row with each role, and the R17/R31 matrix (every registry operation × viewer/operator/
  maintenance/admin) runs green with `DEVICE_REGISTRY_REQUIRE_ADMIN=true`. Only the *deployed default*
  is permissive, because this branch has no sign-in flow to produce a session at all.
- The swap when auth-roles merges is mechanical: `access.ts` delegates to `requireRole(ctx, "admin")`
  and the flag is deleted. No call site changes. Note auth-roles/plan.md drops `users.authId`, which is
  exactly why identity resolution is confined to this one file.
- The audit trail stays honest meanwhile: `actorUserId` is optional and `actorLabel` records
  `"unauthenticated-dev"`, so a change made without a session is visibly marked as such rather than
  attributed to a real person.

**Flagged to spec-writer**: R16/R17/R31's acceptance criteria are met at the function-test level but
**cannot be demonstrated end-to-end in the running app on this branch**, because no sign-in exists to
create a viewer/operator/maintenance session. R16's "in a viewer session, no control is rendered" is
verifiable only against a mocked role in a component test until auth-roles merges.

The spec now records this under "Verification note — R16, R17, R31 on this branch" (requirement text
and IDs unchanged) and calls it *a known gap, not a satisfied criterion*. The reviewer should treat
those three as **partially verified**, and the auth-roles merge must re-check all three end-to-end and
flip `DEVICE_REGISTRY_REQUIRE_ADMIN` to strict.

**Resolved (auth-roles merged):** the swap predicted above happened, mechanically as expected but with
different real names than guessed here — `requireRole(ctx, "admin")` doesn't exist; the actual system is
capability-based (`specs/auth-roles/plan.md`'s "Decisions" table), so every device write and
`changeHistory` became `authedMutation`/`authedQuery({capability: "device.manage", ...})`
(`backend/lib/functions.ts` + `backend/lib/permissions.ts`), and reads became
`authedQuery({capability: "data.read", ...})`. `access.ts`, `access.currentActor`, and
`DEVICE_REGISTRY_REQUIRE_ADMIN` (plus `backend/lib/config.ts`'s `deviceRegistryRequireAdmin()`) are
deleted — there is no flag left to flip. Full accounting of the merge is in
`specs/auth-roles/plan.md`'s "What changes against the current implementation" (post-merge note under
the `devices.ts`/`telemetry.ts` bullet) and `specs/auth-roles/tasks.md` T9.

## Data model

### `devices` (modified)

| Field | Type | Notes |
|---|---|---|
| `externalId` | string | Trimmed, as entered. Displayed. Immutable after registration (R21). |
| `externalIdKey` | string | `externalId.trim().toLowerCase()`. The uniqueness key (R20). Never shown. |
| `name` | string | Required, non-empty after trim (R18). |
| `type` | string | Required, non-empty after trim (R18). Free text. |
| `zone` | optional string | Trimmed; omitted when blank. |
| `status` | `"online" \| "offline" \| "unknown"` | Connectivity only (R1). Written by ingest, sweeper, reactivate. |
| `lastSeenAt` | optional number | ms epoch. Absent ⇒ never seen ⇒ `status` is `unknown` (R1/R2). |
| `lifecycle` | `"in_service" \| "decommissioned"` | Replaces `isActive` (R24/R25/R28). |
| `decommissionedAt` | optional number | Set on decommission, cleared on reactivate. |
| `decommissionedBy` | optional `Id<"users">` | Nullable — see auth seam. |
| `metadata` | optional `record<string,string>` | Bounded: ≤ 20 entries, key ≤ 64 chars, value ≤ 256 chars (R22). |
| `rejectedReadingCount` | optional number | Cumulative telemetry readings refused because the device is decommissioned (R26). |
| `lastRejectedReadingAt` | optional number | ms epoch of the most recent such refusal (R26). |

Indexes (replacing `by_externalId` and `by_zone_and_status`):

| Index | Fields | Serves |
|---|---|---|
| `by_externalIdKey` | `["externalIdKey"]` | Uniqueness check (R19/R20), ingest lookup |
| `by_lifecycle_status_lastSeenAt` | `["lifecycle","status","lastSeenAt"]` | Sweeper range scan; `status=` filter; default list |
| `by_lifecycle_and_zone` | `["lifecycle","zone"]` | `zone=` filter, zone grouping |
| `by_lifecycle_and_type` | `["lifecycle","type"]` | `type=` filter, type grouping |

Four indexes on a table of a few hundred small rows is negligible write overhead — unlike `telemetry`,
where foundation §9 rightly keeps the index count minimal.

Because ingest now resolves devices through `externalIdKey`, a gateway sending `SIM-CNC-01` matches a
device registered as `sim-cnc-01`. That is intentional and follows from R20; it must be in the README.

### `auditLog` (new)

| Field | Type | Notes |
|---|---|---|
| `entityTable` | string | `"devices"` in v1. Generic so role/alert-rule changes reuse it. |
| `entityId` | string | Stringified document id — generic across tables. |
| `action` | string | `"device.register" \| "device.update" \| "device.decommission" \| "device.reactivate"`. |
| `actorUserId` | optional `Id<"users">` | Absent when no session (see auth seam). |
| `actorLabel` | string | Display name, email, or `"unauthenticated-dev"`. |
| `at` | number | ms epoch. |
| `changes` | array of `{ field, before?, after? }` | Values JSON-stringified, each capped at 512 chars. Empty array for `register` (the whole record is new) with the created values recorded as `after`. |

Indexes: `by_entity` `["entityTable","entityId","at"]` (device history, R29/R31), `by_at` `["at"]`
(future retention pruning).

Relationships: `auditLog.entityId` → `devices._id` (by convention, not a typed reference, which is the
price of genericity); `auditLog.actorUserId` → `users._id`. `telemetry.deviceId` and `alerts.deviceId`
are untouched — that is what makes R24's "history remains queryable" true for free, since decommission
only patches the device row.

### Configuration (`backend/lib/config.ts`)

| Variable | Default | Requirement |
|---|---|---|
| `DEVICE_HEARTBEAT_WINDOW_MS` | `60000` | R2, R4 |
| `DEVICE_METADATA_MAX_ENTRIES` | `20` | R22 |
| `DEVICE_METADATA_MAX_KEY_LENGTH` | `64` | R22 |
| `DEVICE_METADATA_MAX_VALUE_LENGTH` | `256` | R22 |
| `DEVICE_LIST_PAGE_SIZE` | `50` | R11 |
| `DEVICE_REGISTRY_REQUIRE_ADMIN` | `false` (this branch) | R16, R17, R31 |

Sweep interval (15 s) is a constant in `backend/crons.ts`, deliberately not an env var. All of the
above belong in `.env.example` and the README env table.

Why 60 s: the simulator reports every 2 s (`SIMULATOR_INTERVAL_MS=2000`), so 60 s tolerates ~30 missed
intervals — enough to ride out a gateway restart or a batching hiccup without flapping, while keeping
"machine is dead" visible inside a shift-relevant timescale. It is a documented default to revisit once
foundation §14's real telemetry cadence is known, not a derived number.

## Function surface

| Function | Kind | Gate | Purpose |
|---|---|---|---|
| `devices.list` | query (paginated) | none | Filters (`zone`, `type`, `status`, `includeDecommissioned`), reactive, bounded |
| `devices.get` | query | none | Detail: registry fields + lifecycle + connectivity |
| `devices.facets` | query | none | Distinct zones/types/statuses with counts under the active filter |
| `devices.changeHistory` | query | `requireAdmin` | Audit entries for one device, newest first |
| `devices.register` | mutation | `requireAdmin` | Validate → insert → audit |
| `devices.update` | mutation | `requireAdmin` | Validate → diff → patch → audit (no `externalId` arg) |
| `devices.decommission` | mutation | `requireAdmin` | Patch lifecycle → audit; non-destructive |
| `devices.reactivate` | mutation | `requireAdmin` | Patch lifecycle, recompute `status` from `lastSeenAt` vs window → audit |
| `devices.sweepOffline` | internalMutation | cron only | `online` → `offline` past the window |
| `devices.backfillLifecycle` | internalMutation | one-off | Migration phase 1 |
| `ingest.recordBatch` | mutation (modified) | service token (unchanged) | Normalized lookup; decommissioned ⇒ count + log, no state change |

`internalMutation` is not callable from any client, which is what keeps the sweeper and the backfill
off the public API surface (and out of R17's enumeration).

`devices.listActive` is **removed**; `frontend/app/page.tsx` moves to `devices.list`. Note there is no
`isActive` consumer left afterwards — the builder must update `ingest.recordBatch` in the same change.

## Frontend

- `app/devices/page.tsx` — filter bar (zone / type / status selects + "include decommissioned",
  admin-only) over a paginated table via `usePaginatedQuery`; grouping toggle (none / zone / type /
  status) rendering `devices.facets` as collapsible group headers with counts. Filter state is mirrored
  into the URL query string so a filtered view is shareable (R7/R8/R10/R11).
- Detail panel — a **lifecycle badge** (In service / Decommissioned) rendered separately and more
  prominently than the **connectivity badge** (Online / Offline / Unknown), plus last-seen. A
  decommissioned device shows its lifecycle badge and a muted connectivity badge, never "offline"
  alone (R28).
- Admin forms — register and edit as modal forms with per-field errors mapped from a structured
  validation error the mutations throw (field name + message), so R15 can highlight the offending
  field rather than showing a toast. Decommission/reactivate as confirm actions.
- History tab — `devices.changeHistory`, admin-only, rendered from `access.currentActor` (R31).
- All admin affordances are hidden when `access.currentActor().role !== "admin"` (R16), with the
  server check as the real boundary (R17).
- **Next.js 16 caveat**: `frontend/AGENTS.md` warns that APIs differ from training data. The builder
  must read `node_modules/next/dist/docs/` before writing routing/layout code.

## Requirement coverage

| Req | Addressed by |
|---|---|
| R1 | `devices.status` union + optional `lastSeenAt`; absent when never seen |
| R2 | `status` written by ingest (→online), sweeper (→offline past `DEVICE_HEARTBEAT_WINDOW_MS`); `unknown` is the registration default, never overwritten until first telemetry |
| R3 | `crons.interval` 15 s → `devices.sweepOffline` patches the row; the write invalidates subscriptions. Documented bound: window + 15 s |
| R4 | `DEVICE_HEARTBEAT_WINDOW_MS` via `backend/lib/config.ts`; changeable with `npx convex env set` / dashboard, no redeploy |
| R5 | Single stored field read by `devices.list`, `devices.get` and the `status=` filter — no read-time derivation anywhere, so disagreement is structurally impossible |
| R6 | Convex reactive queries; both ingest and sweeper mutate the device row, so both directions push |
| R7 | `devices.list` args `zone`/`type`/`status` combined with AND: index-narrow on the most selective, residual predicates in-query |
| R8 | `devices.facets` groups by zone/type/status with counts, computed over the same filtered set |
| R9 | Facets derived from stored device values — no hard-coded list; a new zone/type appears as soon as a device uses it |
| R10 | Paginated queries are reactive; when the sweeper flips a status, a device that no longer matches `status=online` leaves the client's list with no user action |
| R11 | `.paginate()` with `DEVICE_LIST_PAGE_SIZE` (50) + cursor navigation; replaces today's unbounded `listActive().collect()` |
| R12 | `devices.register` + admin register form (externalId, name, type, zone, metadata) |
| R13 | `devices.update` + edit form (name, type, zone, metadata) |
| R14 | `devices.decommission` / `devices.reactivate` + UI confirm actions |
| R15 | Mutations throw a structured `{ field, message }[]` validation error; the form maps each to its input. Validation runs before any write, so the transaction never partially commits |
| R16 | `access.currentActor` drives conditional rendering of all admin affordances |
| R17 | `requireAdmin` first line of every registry mutation + `devices.changeHistory`; a test enumerates the public `api.devices` surface and fails on any entry not classified as read-or-gated, so a newly added operation cannot be forgotten. **Caveat: real enforcement pending auth-roles — see Auth seam** |
| R18 | Shared validator: trim then reject empty for `externalId`, `name`, `type`; trimmed values are what gets stored |
| R19 | `by_externalIdKey` lookup before insert, across **all** lifecycle states; error names the conflicting device |
| R20 | `externalIdKey = trim().toLowerCase()` is the only comparison basis, applied identically in register and ingest |
| R21 | `externalId` absent from `devices.update`'s args validator ⇒ Convex rejects it before the handler runs |
| R22 | Metadata bounds from config, enforced in the shared server validator; over-bound ⇒ validation failure, never truncation |
| R23 | All validation lives in one server-side module called by every mutation; the UI only mirrors it for fast feedback. Tests submit the invalid payloads directly to the functions |
| R24 | Decommission patches `lifecycle` (+`decommissionedAt`/`By`) only; every other field and all `telemetry`/`alerts` rows are untouched, so reactivate restores by construction |
| R25 | `devices.list` defaults to `lifecycle=in_service`; `includeDecommissioned` is admin-only and returns them marked |
| R26 | `ingest.recordBatch` resolves the device, and on `lifecycle=decommissioned` skips the telemetry insert and the status/lastSeenAt patch, instead incrementing `rejectedReadingCount` / `lastRejectedReadingAt` (aggregated once per batch per device) and emitting a `console.warn` |
| R27 | No delete function is defined; the enumeration test from R17 also asserts no exposed operation removes a device and that no `ctx.db.delete` targets `devices` |
| R28 | Distinct lifecycle badge rendered separately from the connectivity badge; the sweeper skips non-`in_service` devices so a decommissioned device is never re-labelled "offline" |
| R29 | `auditLog` row per change with actor, `at`, entity, and `changes[]` carrying per-field before/after |
| R30 | The audit insert happens in the same Convex mutation as the patch; mutations are atomic and serializable, and validation throws before any write, so success ⇒ exactly one entry and failure ⇒ none |
| R31 | `devices.changeHistory` behind `requireAdmin`; UI tab hidden for non-admins. **Same caveat as R17** |

## Risks & unknowns

- **The frozen-clock trap (highest risk).** If the builder implements connectivity as a read-time
  computation, R1/R2/R5 tests pass and R3/R6/R10 fail only under a held subscription — the kind of bug
  that ships. Mitigation: the sweeper is the architecture, not an optimization; the reviewer should
  reject any read-time `Date.now()` comparison in a query.
- **Auth is a seam, not a wall.** With `DEVICE_REGISTRY_REQUIRE_ADMIN=false` (this branch's default),
  any caller can invoke the registry mutations. Mitigation: the enforcement path is fully tested with
  the flag on; the flag and the swap to `requireRole` are called out in the README and in the audit
  trail's `actorLabel`. This must be flipped before any non-local deployment — the builder should make
  that a loud README warning, not a footnote.
- **Two-phase migration must actually be two phases.** Pushing a required `lifecycle` against existing
  simulator-seeded rows fails schema validation. Mitigation: optional field → `backfillLifecycle` →
  required + drop `isActive`, with `ingest.recordBatch` updated in the same step so nothing reads
  `isActive` afterwards. Verify with `npx convex dev --once` against a deployment that has rows.
- **Post-filter page shrinkage.** Residual in-JS filtering means a page of 50 can return fewer rows.
  Convex documents that page sizes can change anyway and the cursor remains gap-less, so R11's "no
  duplicates or omissions" holds — but the UI must not infer "end of list" from a short page.
- **Heartbeat window default is an assumption.** 60 s is reasoned from the simulator's 2 s cadence, not
  from field data; foundation §14 leaves real cadence open. Mitigation: it is env-configurable (R4), so
  correcting it is a config change. Too-short windows will flap; the sweeper only writes on an actual
  transition, so flapping costs writes and subscription churn rather than correctness.
- **Free-text zone/type will fragment** (`agv` vs `AGV`). Accepted for v1 per the decision above and
  mitigated by suggesting existing values in the form. If fragmentation shows up in practice, a
  controlled vocabulary is a new entity and a new spec, not a patch.
- **Audit log grows unbounded.** No retention policy in v1. Low-volume (registry edits, not telemetry),
  so it is not an operational risk at this horizon; `by_at` exists so a pruning cron is a small
  follow-up. Flagged because the spec asked about retention and this plan defers it.
- **`convex-test` is not yet in the repo.** Neither auth-roles nor this feature has landed it. Whoever
  builds first adds `convex-test` + `vitest`; the second should reuse rather than duplicate the config.
- **Test execution is local.** Time-advance tests for R3 (`vi.useFakeTimers` plus explicitly invoking
  the sweeper) and the R17 allow/deny matrix must be run in the project's own toolchain by the builder
  and re-run by the reviewer.

## Sources

- [Convex runtimes — `Date.now()` is frozen for the function's execution](https://docs.convex.dev/functions/runtimes)
- [Convex queries — results are cached and reactive to data changes](https://docs.convex.dev/functions/query-functions)
- [Convex cron jobs — `crons.interval`, seconds-level granularity](https://docs.convex.dev/scheduling/cron-jobs)
- [Convex environment variables — dashboard / `npx convex env set`, no redeploy](https://docs.convex.dev/production/environment-variables)
- [Convex pagination — `paginationOptsValidator`, `.paginate()`, `usePaginatedQuery`, page sizes may change](https://docs.convex.dev/database/pagination)
- [Convex argument validation — extra undeclared fields are rejected](https://docs.convex.dev/functions/validation)
- [Convex OCC & atomicity — serializable mutations with automatic conflict retry](https://docs.convex.dev/database/advanced/occ)
- [Convex filters vs indexes — `.filter()` acceptable below a few thousand rows](https://docs.convex.dev/database/reading-data/filters)
- [Convex limits — 32,000 docs scanned / 16 MiB read / 16,000 docs written per transaction](https://docs.convex.dev/production/state/limits)
- [Convex best practices — avoid unbounded `.collect()`, denormalize hot-path state](https://docs.convex.dev/understanding/best-practices/)
- Local: `convex` 1.46.0 installed (`node_modules/convex/package.json`); typed `env` export confirmed at `backend/_generated/server.d.ts:115`

## Summary

Connectivity state must be **written** by a 15-second cron sweeper rather than computed at read time —
Convex freezes `Date.now()` and invalidates query subscriptions only on data change, so a read-time
derivation would satisfy R1/R2 and silently fail R3/R6/R10.
Everything else is conventional: a normalized `externalIdKey` for uniqueness, `lifecycle` replacing
`isActive` (two-phase migration), paginated index-narrowed listing, and a general `auditLog` written
inside the same atomic mutation as each change.
R16/R17/R31 are met through a self-contained `backend/lib/access.ts` seam whose enforcement path is
fully tested but defaults to permissive on this branch, to be swapped for `requireRole` when auth-roles
merges.

**Decisions to confirm before building:**
1. **`DEVICE_REGISTRY_REQUIRE_ADMIN` defaults to `false` on this branch.** The registry is effectively
   ungated at runtime until auth-roles merges. Per the coordinator's resolution this is expected, but
   it is the one irreversible-feeling call here: it ships a write path anyone can reach.
2. **`isActive` → `lifecycle` is a breaking schema change** to `devices` requiring a two-phase push and
   a matching edit to `ingest.recordBatch`. Say so now if you would rather keep `isActive` and accept
   the R28 ambiguity.
3. **Heartbeat window 60 s / sweep 15 s** (worst-case 75 s to show offline). Confirm this is "short and
   predictable" enough for the operator story, or name a different pair.
