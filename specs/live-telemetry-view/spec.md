# Spec: Live telemetry view

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `live-telemetry-view`. Realizes M1 / §6.2 of foundation spec/plan.

## Overview

An operator watching the factory floor needs to see, right now, what each
machine is doing — without refreshing a page or waiting to find out something
went wrong. The foundation platform's ingestion path (hardened separately)
writes telemetry into the system, and the device registry (hardened
separately) manages what devices exist, but neither gives a user anything to
look at. This feature is the live, realtime-updating display of each
registered device's current state: its key metric values, whether it's
currently reachable, and a short trail of what it's recently done. Without
it, telemetry and device data exist only in the backend, invisible to the
people who need to act on it during a shift.

## Goals

- Show every registered device's current status (connectivity/last-seen) and
  key metric values on one overview screen.
- Let a user drill into a single device to see all of its current metrics and
  a recent event log.
- Update all of the above automatically as new telemetry arrives, with no
  manual refresh or polling.
- Make stale/no-longer-updating data visually distinguishable from actively
  live data.

## Non-goals

- Registering, editing, or decommissioning devices, or any device metadata
  management — that's the device registry feature.
- How telemetry is ingested, validated, batched, authenticated, or
  rate-limited on the way in — that's the telemetry ingestion feature. This
  feature assumes telemetry is already written and queryable.
- Alert rules, alert records, or alert banners — that's the alerting feature.
  "Recent event log" here means device/telemetry activity, not alerts.
- Historical time-range viewing, scrubbing, zooming, or export — that's the
  historical playback feature. This feature shows only *current* state.
- Choosing or building the auth mechanism — covered by auth-roles. This
  feature assumes a signed-in session is already required to reach it.

## User stories

- As an operator, I want to see the live status of all machines in my view in
  one screen, so that I can immediately notice when a machine goes offline or
  enters an error state.
- As an operator, I want to see each device's key metrics (e.g. temperature,
  cycle count, error code) update automatically, so that I don't have to
  refresh or poll to know current conditions.
- As any authenticated user, I want the dashboard to update in realtime
  without manual refresh, so that I'm always looking at current state.
- As a user, I want to drill into a single device and see all of its current
  metrics plus what it's recently done, so that I can assess its condition in
  detail without switching tools.
- As a user, I want to tell at a glance whether a device's data is fresh or
  stale, so that I don't mistake old readings for current ones.

## Requirements

Each is a single, independently testable statement. IDs are stable — the
planner and reviewer reference them.

- **R1** — The overview screen shows, for every active (non-decommissioned)
  device, its current connectivity status (e.g. online/offline/unknown) and
  last-seen timestamp.
- **R2** — The overview screen shows each device's current values for its key
  telemetry metrics.
- **R3** — A user can select a single device and reach a detail view showing
  all of that device's current metric values.
- **R4** — The device detail view shows a recent event log for that device
  (recent telemetry/status activity), distinct from any alert history.
- **R5** — When new telemetry or a status change is written for a device, any
  view currently showing that device updates automatically, without the user
  refreshing or triggering a poll.
- **R6** — A device whose last-seen timestamp has exceeded its expected
  reporting interval is visually distinguished from a device with recently
  updated data, both on the overview screen and in the detail view.
- **R7** — The overview screen supports filtering or grouping devices by
  zone, type, and status, consistent with the device list's existing
  filter/grouping capability.
- **R8** — Reaching any live view requires an authenticated session; no
  telemetry or device state is shown to an unauthenticated request.

## Acceptance criteria

- **R1** — For a set of devices with varying connectivity states, the
  overview screen's displayed status and last-seen timestamp for each match
  their actual stored state.
- **R2** — For a device with known current metric values, the overview screen
  displays those exact values (not stale or default placeholders).
- **R3** — Selecting any active device from the overview navigates to a
  detail view that lists all of its current metrics.
- **R4** — The device detail view's event log reflects the device's actual
  recent telemetry/status activity and contains no alert-record content.
- **R5** — Writing a new telemetry reading or status change for a device
  while its overview/detail view is open causes the displayed value to change
  within the view, with no user-initiated refresh action performed.
- **R6** — A device whose last-seen timestamp is artificially pushed past its
  expected reporting interval is shown with a distinct "stale" treatment on
  both the overview and detail views; a device updated within the interval is
  not.
- **R7** — Filtering the overview by a given zone, type, or status shows only
  matching devices; clearing the filter restores the full list.
- **R8** — A request to any live-view route or query while signed out yields
  no device or telemetry data.

## Open questions

- **Key metrics selection** — which metrics count as "key" per device type
  for the overview screen (vs. the full set shown in detail view)? Foundation
  spec examples (temperature, cycle count, error code, uptime) are
  illustrative, not a confirmed list.
- **Expected reporting interval for staleness (R6)** — foundation spec ties
  device "offline" connectivity status to heartbeat recency but does not
  define the exact staleness threshold used for visual distinction; likely
  per-device-type, not yet specified.
- **Event log scope and depth** — how much recent activity the per-device
  event log should retain/show is not specified in the foundation spec.
- **Overview screen layout at scale** — foundation spec's non-functional
  targets assume tens to low hundreds of devices per deployment; whether the
  overview needs pagination/virtualization at the upper end of that range is
  unresolved.
