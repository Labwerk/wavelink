# Spec: Historical playback

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `historical-playback`. Realizes M4 / §6.4 of foundation spec/plan.

## Overview

Knowing what a device is doing right now isn't enough when something has
already gone wrong — a maintenance engineer diagnosing a failure needs to see
what led up to it, and sometimes needs to hand that evidence to someone else
entirely (a vendor, an incident report). Today, once a telemetry reading
scrolls past the live view, it's effectively gone to the user even though
it's still stored. This feature lets an authorized user pick a device and a
time range, view that device's telemetry as a chart/timeline they can scrub
and zoom within, and export a selected range as data they can share.

## Goals

- Let an authorized user select a device and a time range and view that
  device's historical telemetry as a chart/timeline.
- Let the user scrub and zoom within the retained history window.
- Let the user export a selected time range of a single device's telemetry.
- Keep historical queries bounded so viewing even the full retention window
  doesn't fail or exceed platform read limits.

## Non-goals

- Managing devices or their metadata — that's the device registry feature.
  This feature assumes devices already exist.
- How telemetry is ingested, validated, or written — that's the telemetry
  ingestion feature. This feature only reads telemetry that has already been
  recorded.
- Displaying current/live metric values — that's the live telemetry view
  feature. This feature is strictly about *past* data, not current state.
- Alert rules, alert records, or overlaying alert events on the timeline —
  foundation spec §6.4 does not call for an alert overlay; alerting is a
  separate feature with its own per-device alert history view.
- Choosing or building the auth mechanism, or defining which roles get
  playback access — covered by auth-roles. This feature assumes that
  mechanism exists (foundation spec's role table already grants maintenance
  engineers and admins historical playback/export access).
- Deciding the exact retention window length, or whether a pre-aggregated
  rollup table is needed to support it — both explicitly open/deferred in
  foundation materials (see Open questions).

## User stories

- As a maintenance engineer, I want to scrub through a machine's telemetry
  history around the time of a failure, so that I can diagnose the root
  cause.
- As a maintenance engineer, I want to zoom into a narrower time window
  within a selected range, so that I can inspect a specific moment in more
  detail.
- As a maintenance engineer, I want to export a time range of telemetry for a
  device, so that I can share it with a vendor or include it in an incident
  report.
- As an admin, I want the same playback and export access as a maintenance
  engineer, consistent with the platform's role hierarchy.
- As a user reviewing a long time range, I want the view to load without
  errors or timeouts, so that I can actually use it for a full-retention-
  window investigation.

## Requirements

Each is a single, independently testable statement. IDs are stable — the
planner and reviewer reference them.

- **R1** — An authorized user can select a single device and a time range and
  retrieve that device's telemetry within the range.
- **R2** — The retrieved historical telemetry is presented as a
  chart/timeline the user can view.
- **R3** — The user can scrub and zoom within the selected range without
  re-specifying the range from scratch each time.
- **R4** — The user can select any sub-range within the platform's retained
  history window, not just a fixed set of preset ranges.
- **R5** — The user can export a selected time range of a single device's
  telemetry as a downloadable data file.
- **R6** — An exported range contains only telemetry for the selected device
  and within the selected time range.
- **R7** — Retrieving telemetry for any sub-range up to and including the
  full retention window succeeds without failing or exceeding the platform's
  read limits.
- **R8** — Access to historical playback and export is limited to users
  whose role grants it (maintenance engineer and admin, per the platform's
  role hierarchy); other roles are denied.

## Acceptance criteria

- **R1** — Selecting a device and a time range returns telemetry readings for
  that device whose timestamps fall within the range, and none outside it.
- **R2** — The selected range's telemetry renders as a chart/timeline
  reflecting the actual retrieved values.
- **R3** — Scrubbing or zooming within an already-loaded range updates the
  displayed view without requiring the user to re-enter the original device
  or range.
- **R4** — A time range with arbitrary start/end points (not limited to
  preset options) can be selected and successfully retrieves matching data.
- **R5** — Exporting a selected range produces a file the user can save,
  containing the range's telemetry data.
- **R6** — An exported file's contents are verified to include only the
  selected device's readings within the selected range, with no readings
  from other devices or outside the range.
- **R7** — Requesting the full retention window for a device with data
  spanning that entire window completes successfully rather than erroring or
  timing out.
- **R8** — A user whose role is viewer or operator is denied access to
  historical playback and export; a maintenance engineer or admin succeeds.

## Open questions

- **Retention window length** — foundation spec assumes 30–90 days for raw
  telemetry as a placeholder, not a confirmed business decision; the actual
  window this feature must support is unresolved.
- **Rollup/aggregation for long ranges** — foundation materials raise, but
  explicitly defer, whether a pre-aggregated rollup table is needed to keep
  long-range queries within read limits (R7), versus relying on pagination
  over raw data alone. Left for the planner to resolve.
- **Export format(s)** — foundation spec says CSV/JSON without settling on
  one or both; unresolved here.
- **Chart granularity at long ranges** — whether/how the displayed
  chart resolution changes as the selected range grows (to stay readable and
  performant) is not specified.
