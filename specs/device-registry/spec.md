# Spec: Device registry

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `device-registry`. Completes section **§6.1 Device Management** of
> [`../foundation/spec.md`](../foundation/spec.md) (items 3 and 4 are unimplemented)
> and builds on the admin gating established in [`../auth-roles/spec.md`](../auth-roles/spec.md).

## Overview

Devices exist in the system today only as records an engineer can create through
backend calls: they can be registered, edited and deactivated, but there is no way
for an admin to do any of that from the product, no way to find a device among
hundreds, and the connectivity state shown on the dashboard is not trustworthy — a
device is marked online the moment telemetry arrives and stays online forever, even
after it stops reporting. Operators therefore cannot tell a running machine from a
dead one, and admins cannot manage the fleet without developer help. This feature
turns ad-hoc device records into a proper registry: connectivity state derived from
heartbeat recency, a device list that can be filtered and grouped by zone, type and
status, an admin-facing management screen, enforced validation and uniqueness,
clear decommission/reactivate semantics, and an audit trail of who changed what.

## Goals

- Show a connectivity state (online / offline / unknown) for every device that
  reflects reality, including devices that have gone silent.
- Let any user narrow the device list to the devices they care about, by zone, type
  and connectivity state, and see fleet counts grouped by those dimensions.
- Let an admin register, edit, decommission and reactivate devices entirely from the
  product UI, with validation errors shown before anything is saved.
- Guarantee that a device identifier is unique and stable, so telemetry is never
  attributed to the wrong machine.
- Define unambiguous decommission semantics: what happens to the device's history,
  to incoming telemetry, and to its identifier.
- Make every registry change attributable to the admin who made it.

## Non-goals

- Changing the telemetry ingestion path itself (batching, rate limiting, payload
  shape) beyond how it must treat decommissioned/unknown devices.
- Alerting on a device going offline — offline-duration alert rules belong to the
  alerting feature; this feature only produces the connectivity state they read.
- First-class group/zone entities (hierarchies, zone management screens, per-zone
  permissions). Zone and type remain simple labels on a device in v1.
- Per-device or per-zone access control — roles stay system-wide (auth-roles non-goal).
- Device control (start/stop/reconfigure) or any write path toward a machine.
- Bulk import/export of the device fleet (CSV upload, sync from an external asset
  system) — see Open questions.
- Automatic self-registration of unknown devices from telemetry — see Open questions.
- Redefining the four roles or the authentication mechanism (owned by `auth-roles`).

## User stories

- As an operator, I want a device that has stopped reporting to show as offline
  within a short, predictable time, so that I notice a dead machine instead of
  trusting a stale "online" badge.
- As an operator, I want to see only the devices in my zone, so that I am not
  distracted by the rest of the plant.
- As an operator, I want to see how many devices in each zone are offline, so that I
  can spot a whole line going down rather than one machine at a time.
- As a maintenance engineer, I want to find every device of a given type, so that I
  can check whether a fault is model-wide.
- As an admin, I want to register a new device from the UI with its identifier, name,
  type and zone, so that its telemetry starts appearing without developer help.
- As an admin, I want to be told immediately if the identifier I typed is already in
  use or the form is incomplete, so that I don't create a broken or duplicate record.
- As an admin, I want to decommission a machine that has left the floor and know its
  history is preserved, so that past incidents remain reviewable.
- As an admin, I want to bring a decommissioned device back into service, so that a
  temporary removal doesn't force me to recreate it and lose its history.
- As an admin, I want to see who changed a device record and when, so that an
  unexpected configuration change can be traced to a person.

## Requirements

Each is a single, independently testable statement. IDs are stable — the planner
and reviewer reference them.

### Connectivity state (foundation §6.1 item 3)

- **R1** — Every device exposes exactly one connectivity state: `online`, `offline`
  or `unknown`, together with its last-seen timestamp (absent when never seen).
- **R2** — A device is `online` when telemetry has been received from it within the
  configured heartbeat window, `offline` when its most recent telemetry is older than
  that window, and `unknown` when no telemetry has ever been received from it.
- **R3** — A device transitions from `online` to `offline` without any further
  telemetry arriving, and the change becomes visible to subscribed clients within a
  bounded, documented delay of the window elapsing.
- **R4** — The heartbeat window is a deployment-level configuration value with a
  documented default, changeable without a code change.
- **R5** — Connectivity state is consistent across every view that shows it: the
  device list, the device detail view, and any filter or grouping by status all
  reflect the same state for the same device at the same moment.
- **R6** — Connectivity state and last-seen timestamp update live on subscribed
  clients, with no manual refresh.

### Filtering and grouping (foundation §6.1 item 4)

- **R7** — The device list can be filtered by zone, by type, and by connectivity
  state; filters on different dimensions combine so only devices matching all
  selected criteria are returned.
- **R8** — The device list can be grouped by zone, by type, or by connectivity state,
  showing each group with its device count; counts reflect the filters currently
  applied.
- **R9** — The set of zones and types offered as filter choices is derived from the
  devices that actually exist — no hard-coded list, and a newly used zone or type
  becomes selectable without a code change.
- **R10** — Filtered and grouped results update live as device state changes, and a
  device that no longer matches the active filter leaves the list on its own.
- **R11** — Device listing returns a bounded result set (paged or capped with a
  clear indication that more exist) rather than growing without limit as the fleet
  grows, and remains usable at the foundation §7 target of low hundreds of devices.

### Admin device management UI

- **R12** — An admin can register a device from the UI by supplying its external
  identifier, display name, type, optional zone and optional metadata key/values.
- **R13** — An admin can edit an existing device's display name, type, zone and
  metadata from the UI.
- **R14** — An admin can decommission an in-service device and reactivate a
  decommissioned one from the UI.
- **R15** — Validation failures (missing required field, duplicate identifier,
  out-of-bounds value) are reported in the UI against the offending field, and no
  partial change is saved.
- **R16** — Device management entry points are visible only to admins; non-admin
  users see the device list without any create/edit/decommission controls.
- **R17** — Every device create, edit, decommission and reactivate operation is
  refused by the server for non-admin callers, independently of whether the UI hid
  the control (this binds to auth-roles R3/R5 and must remain true for any new
  registry operation added here).

### Validation, uniqueness and identity

- **R18** — External identifier and display name are required and must be non-empty
  after trimming surrounding whitespace; type is required.
- **R19** — External identifiers are unique across all devices, including
  decommissioned ones; a registration that collides is refused with a message naming
  the conflict.
- **R20** — Identifier comparison for uniqueness is defined and applied consistently
  (a single documented normalization rule, e.g. case and whitespace handling), so two
  identifiers that differ only by that normalization cannot both exist.
- **R21** — A device's external identifier is immutable after registration; no edit
  path changes it.
- **R22** — Metadata is bounded: a documented maximum number of entries and maximum
  key/value length, enforced on the server; exceeding a bound is a validation failure
  (R15), not a truncation.
- **R23** — Every device write validates the same rules on the server regardless of
  entry point, so a call that bypasses the UI cannot create an invalid record.

### Lifecycle semantics

- **R24** — Decommissioning is reversible and non-destructive: the device record and
  all of its historical telemetry and alerts are retained, and reactivating restores
  it to the state it had (identifier, name, type, zone, metadata) before
  decommissioning.
- **R25** — Decommissioned devices are excluded from operational views by default and
  are reachable by admins through an explicit "include decommissioned" filter or an
  equivalent view.
- **R26** — Telemetry received for a decommissioned device is not recorded as new
  device state and does not silently resurrect the device; the occurrence is
  observable (counted or logged) rather than dropped without trace.
- **R27** — Permanent deletion of a device is not offered in v1; the only removal
  path is decommissioning (see Open questions — if the answer changes, this becomes
  the requirement that flips).
- **R28** — A device's detail view states its lifecycle state (in service /
  decommissioned) distinctly from its connectivity state, so a decommissioned device
  is never merely shown as "offline".

### Audit trail

- **R29** — Every registry change (register, edit, decommission, reactivate) records
  the acting user, the timestamp, the affected device, and which fields changed with
  their before/after values.
- **R30** — The audit record is written in the same operation as the change: a change
  that succeeds always has an audit record, and a change that fails leaves none.
- **R31** — Admins, and only admins, can view a device's change history.

## Acceptance criteria

- **R1** — For any device, exactly one of the three states is reported, alongside a
  last-seen timestamp that is absent for a never-seen device.
- **R2** — Three fixtures — telemetry just now, telemetry older than the window, no
  telemetry ever — report `online`, `offline`, `unknown` respectively.
- **R3** — With time advanced past the window and no telemetry sent, a previously
  online device reads `offline`, and a subscribed client observes the change within
  the documented delay.
- **R4** — Changing the configured window (without editing code) moves the
  online/offline boundary accordingly, verified with the same fixture at two settings.
- **R5** — For a device whose telemetry has gone stale, the list view, the detail
  view and a `status=offline` filter all agree on `offline` in the same observation.
- **R6** — A subscribed client's rendered status and last-seen value change after new
  telemetry arrives, with no refresh or manual re-fetch.
- **R7** — Filtering by zone Z and status `offline` returns exactly the devices that
  are both in Z and offline; devices matching only one criterion are absent.
- **R8** — Grouping by zone over a known fixture returns each zone once with a count
  equal to the number of matching devices; applying a filter reduces the counts
  correspondingly.
- **R9** — Registering a device with a previously unused zone/type makes that value
  appear as a filter choice without any deploy or code edit.
- **R10** — With a `status=online` filter active, a device that crosses the heartbeat
  window disappears from the client's list without user action.
- **R11** — With a fleet exceeding the page/cap size, the list returns at most one
  page and signals that more exist; navigating retrieves the remainder without
  duplicates or omissions.
- **R12** — An admin completes the register form and the new device appears in the
  device list with the supplied values.
- **R13** — An admin edits name, type, zone and a metadata entry; the device detail
  view shows the new values after save.
- **R14** — An admin decommissions a device (it leaves the default list), then
  reactivates it (it returns) through UI controls only.
- **R15** — Submitting a form with a blank name and a duplicate identifier shows an
  error on each offending field, and a subsequent read shows no new or changed record.
- **R16** — In a viewer, operator and maintenance session, no register/edit/
  decommission control is rendered or enabled on any device view.
- **R17** — Each registry operation invoked directly by a non-admin session is
  refused; the same call by an admin succeeds. A test enumerates every registry
  operation so a newly added one cannot be forgotten.
- **R18** — Registering with an empty, whitespace-only or missing identifier, name or
  type is refused; leading/trailing whitespace on accepted values is not stored.
- **R19** — Registering an identifier already held by an in-service device is refused;
  registering one held by a decommissioned device is also refused, with a message
  identifying the conflict.
- **R20** — Two identifiers differing only by the documented normalization (e.g.
  `robot-01` vs `ROBOT-01 `) cannot both be registered; the second attempt is refused.
- **R21** — No supported operation changes an existing device's external identifier;
  an attempt to supply a different one on edit is rejected or ignored, verified by test.
- **R22** — Metadata exceeding the entry-count or length bound is refused with a
  validation error, and the previously stored metadata is unchanged.
- **R23** — The same invalid payloads from R18/R19/R20/R22 are refused when submitted
  directly to the server, not only through the UI form.
- **R24** — After decommission and reactivate, the device's identifier, name, type,
  zone and metadata are unchanged, and its telemetry and alert history remain queryable.
- **R25** — The default device list omits decommissioned devices; an admin enabling
  the explicit option sees them, marked as decommissioned.
- **R26** — Posting telemetry for a decommissioned device leaves its lifecycle state
  and connectivity state unchanged, and produces an observable record (count or log
  entry) of the rejected reading.
- **R27** — No exposed operation permanently removes a device record; a test asserts
  the absence of a hard-delete path.
- **R28** — A decommissioned device that also has stale telemetry is displayed as
  decommissioned, distinguishable from an in-service offline device.
- **R29** — After an edit that changes zone and name, the device's history shows one
  entry naming the acting admin, the time, and both field changes with old and new
  values.
- **R30** — A change that fails validation produces no history entry; every successful
  change has exactly one.
- **R31** — A non-admin request for a device's change history is refused; an admin's
  succeeds.

### Verification note — R16, R17, R31 on this branch

The requirement text above is unchanged and stands as written; only the *level* at
which it can be verified is temporarily reduced. This branch does not carry the
`auth-roles` implementation, so there is no sign-in flow and no way to produce a real
viewer/operator/maintenance session in the running app. Until `auth-roles` lands on
the same branch:

- **R17** and **R31** are verified at the function-test level, by exercising every
  registry operation and the change-history read against a seeded identity per role
  and asserting the full allow/deny matrix. The enforcement path itself is real, not
  mocked; only the deployed default is permissive so that an unauthenticated caller
  (including the telemetry simulator) is not locked out before sign-in exists.
- **R16** is verified at the component-test level against a supplied role, since no
  such session can be produced in the app here.
- End-to-end verification of all three — a real signed-in non-admin being refused in
  the running product, with enforcement on by default — is deferred to the merge with
  `auth-roles` and must be re-checked then. This is a known gap, not a satisfied
  criterion.

**Resolved:** `auth-roles` has merged. The gap above is closed — `devices.register`/
`update`/`decommission`/`reactivate`/`changeHistory` are now `authedMutation`/
`authedQuery({capability: "device.manage", ...})` (real, deployed, on-by-default RBAC;
no permissive escape hatch), and R16 is backed by a real sign-in flow and `users.me`
rather than a mocked role. See `plan.md`'s "Auth seam" section for what changed.

## Open questions

Items marked **[resolved by planner]** were decided during planning and are recorded
here so this spec stays the single source of truth; they are settled unless the team
overrides them. Items still open need a decision from the team.

- **Heartbeat window default** — **[resolved by planner]** 60s default, configurable
  per deployment, with a 15s sweep, so an offline transition is visible within 75s
  worst case; that 75s bound is the "documented delay" R3 is measured against. No
  per-device-type override in v1. Still worth revisiting once the real telemetry
  cadence is known (foundation §14).
- **Hard delete** — **[resolved by planner]** not offered; R27 stands. Revisit only if
  a data-retention obligation forces it, at which point the effect on historical
  telemetry and alerts must be specified.
- **Identifier normalization rule** — **[resolved by planner]** trim plus lowercase
  for uniqueness comparison (R20). No character-set/format constraint beyond that.
- **Type and zone vocabulary** — **[resolved by planner]** free text retained, with
  existing values suggested in the registration form to discourage fragmentation. A
  controlled admin-managed list remains a later option if filters fragment in practice.
- **Filtering UX** — **[resolved by planner]** presentation chosen during planning;
  R7/R8/R10 constrain behavior, not layout.
- **Audit trail scope** — **[resolved by planner]** built as a general facility (one
  audit log keyed by entity type and id) with a device-scoped API in v1, so role
  changes and alert-rule edits can reuse it later. **Still open:** retention period for
  audit entries — deferred, with pruning to be added when a policy exists.
- **Unknown-device telemetry** — **[resolved by planner]** out of scope for this
  feature. No requirement here covers readings for an *unregistered* identifier:
  R26 applies only to telemetry for a *decommissioned* device, which has a record to
  make the rejection observable against. Readings for an identifier that matches no
  device remain skipped, as today. A "seen but unregistered" admin list remains a
  candidate follow-up.
- **Bulk operations** — still open: is registering devices one at a time acceptable
  for the initial fleet, or is an import path needed at go-live? Currently a non-goal.
- **Auth dependency** — still open, and the most consequential: `auth-roles` is not on
  this branch, so R16/R17/R31 are only verifiable at the test level for now (see the
  verification note above). The merge that brings sign-in must re-verify all three
  end-to-end and flip the enforcement default from permissive to strict.
