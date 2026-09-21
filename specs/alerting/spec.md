# Spec: Alerting

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `alerting`. Realizes M3 / §6.3 of foundation spec/plan.

## Overview

A device going out of tolerance or dropping offline is only useful
information if someone finds out quickly. Today, a user would have to
actively watch the live telemetry view and notice a problem themselves —
nothing in the system proactively surfaces it. This feature lets admins
define conditions worth flagging (a metric crossing a threshold, a device
going offline too long, a specific error code appearing), automatically
raises an alert when one of those conditions is met, surfaces it in realtime
to the people who need to respond, and tracks who acknowledged and resolved
it. Without this, incident response depends entirely on someone happening to
be looking at the right screen at the right time.

## Goals

- Let admins define alert rules per device or device type, based on a metric
  threshold, sustained offline duration, or a specific error code.
- Automatically create an alert record when a rule's condition is met.
- Surface active alerts to relevant users in realtime, without polling.
- Let operators and maintenance engineers acknowledge an alert (recording who
  and when) and later resolve/close it.
- Retain and make viewable a device's full alert history, independent of
  current alert state.

## Non-goals

- Delivering alerts through any channel other than the in-dashboard live
  feed — email, SMS, Slack, and webhook delivery are explicitly not required
  for this version (foundation spec assumption; a later candidate, not part
  of this feature).
- Managing devices or their metadata — that's the device registry feature.
  This feature assumes devices already exist.
- How telemetry is ingested, validated, or written — that's the telemetry
  ingestion feature. This feature only reacts to telemetry that has already
  been recorded.
- Displaying current/live metric values on their own (outside of an alert
  context) — that's the live telemetry view feature.
- Historical telemetry playback, scrubbing, or export — that's the
  historical playback feature. (Per-device alert history, in contrast, is
  explicitly in scope here — it's an alerting requirement, not a telemetry
  playback one.)
- Choosing or building the auth mechanism, or defining the role→capability
  mapping itself — covered by auth-roles. This feature assumes that
  mechanism exists and simply relies on it (e.g., only admins can manage
  rules; operators and above can acknowledge/resolve).
- Bidirectional device control in response to an alert (e.g., auto-stopping a
  machine) — out of scope for the whole platform per the foundation spec.

## User stories

- As an admin, I want to define an alert rule (e.g. "temperature > X for Y
  seconds"), so that the system notifies the right people automatically
  instead of relying on someone watching a screen.
- As an admin, I want to define a rule based on a device going offline too
  long, so that a silent failure doesn't go unnoticed.
- As an admin, I want to define a rule based on a specific error code, so
  that known failure signatures are flagged immediately.
- As an operator, I want to see active alerts appear in realtime, so that I
  know about a problem as soon as it's detected.
- As an operator, I want to acknowledge an active alert, so that my team
  knows someone is already responding to it.
- As a maintenance engineer, I want to resolve/close an alert once it's
  handled, so that the active list reflects only what's still outstanding.
- As a maintenance engineer, I want to view a device's alert history, so that
  I can see whether a problem is recurring.

## Requirements

Each is a single, independently testable statement. IDs are stable — the
planner and reviewer reference them.

- **R1** — Admins can define an alert rule scoped to either a specific device
  or a device type.
- **R2** — An alert rule's condition is one of: a metric compared against a
  threshold, a sustained offline duration, or a specific error code.
- **R3** — A threshold-based rule supports requiring the condition to be
  sustained for a specified duration before it counts as met (not a single
  momentary reading).
- **R4** — Admins can enable, disable, and edit existing alert rules.
- **R5** — When an enabled rule's condition is met for a device, the system
  creates an alert record associated with that device and, when applicable,
  the rule that triggered it.
- **R6** — Each alert has a severity.
- **R7** — Newly created and currently active alerts are surfaced to
  authorized users in realtime, without the user polling or refreshing.
- **R8** — Operators and above can acknowledge an active alert; the
  acknowledgment records which user acknowledged it and when.
- **R9** — Operators and above can resolve/close an alert; the resolution
  records when it was resolved.
- **R10** — An alert's history (created, acknowledged, resolved) is retained
  after resolution, not deleted.
- **R11** — A device's full alert history — active and resolved — is
  viewable, scoped to that device.
- **R12** — Only admins can create, edit, enable, or disable alert rules.
- **R13** — Alert delivery in this version is limited to the in-dashboard
  live feed; no external notification channel is required.

## Acceptance criteria

- **R1** — Creating a rule scoped to a specific device applies only to that
  device; creating one scoped to a device type applies to all devices of that
  type.
- **R2** — Each of the three condition kinds (threshold, offline duration,
  error code) can be configured and independently verified to detect its
  matching condition.
- **R3** — A threshold rule configured with a sustained duration does not
  fire on a single momentary out-of-range reading that reverts before the
  duration elapses, but does fire once the condition holds for the full
  duration.
- **R4** — Disabling a rule stops it from producing new alerts; re-enabling
  it resumes evaluation; editing a rule's condition changes what triggers it
  going forward.
- **R5** — Simulating a rule's condition being met produces exactly one new
  alert record tied to the correct device (and rule, where applicable).
- **R6** — Every created alert has a severity value set at creation time.
- **R7** — With a dashboard view open, triggering a rule's condition causes
  the resulting alert to appear in the active-alerts view without a manual
  refresh.
- **R8** — Acknowledging an alert as a given operator-or-above user records
  that user's identity and a timestamp, visible on the alert.
- **R9** — Resolving an alert moves it out of the active list and records a
  resolution timestamp.
- **R10** — After resolving an alert, its record (including who
  acknowledged/resolved it and when) remains retrievable, not deleted.
- **R11** — Viewing a device's alert history shows both currently active and
  previously resolved alerts for that device, and no alerts belonging to
  other devices.
- **R12** — A non-admin attempting to create, edit, enable, or disable a rule
  is denied; an admin succeeds.
- **R13** — No requirement in this spec depends on or implies an external
  delivery channel; an implementation that only surfaces alerts in-dashboard
  fully satisfies this feature.

## Open questions

- **Alert rule evaluation location** — whether rule conditions are checked
  inline as part of telemetry ingestion or via a separate periodic check is
  an explicit open question in the foundation plan, unresolved here by
  design (a planner-level decision, not a spec-writer one). This affects how
  quickly an offline-duration rule in particular can be detected.
- **Severity scale** — the foundation spec's own draft schema sketches an
  info/warning/critical scale, but this is illustrative only; the actual set
  of severities is unconfirmed.
- **Rule conflict/precedence** — if both a device-specific and a
  device-type rule could apply to the same device and metric, foundation
  materials don't say how (or whether) that's resolved.
- **Re-triggering behavior** — whether a resolved alert's condition
  recurring creates a new alert or reopens the old one is not specified.
- **Notification channels beyond in-dashboard** — foundation spec marks this
  an assumption to validate, not a confirmed v1 exclusion; worth confirming
  with the team before this ships, even though it's out of scope as written.
