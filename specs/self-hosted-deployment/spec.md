# Spec: Self-hosted deployment

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `self-hosted-deployment`. Realizes M5 / §12, §13 of foundation spec/plan.

## Overview

The platform is meant to run in self-hosted, on-premises factory
environments, not just a developer's laptop — that's a stated platform goal,
not an afterthought. A basic local-dev version of the stack already runs
(backend + dashboard containers, default local storage), but nothing has
validated that a clean checkout, following only written instructions, can be
brought up as a durable, production-capable deployment by someone who didn't
build it. This feature closes that gap: a production-grade storage option,
a complete and accurate README, and an end-to-end verification that a second
person — not the original implementer — can go from a clean checkout to a
running, seeded stack using nothing but the documented steps.

## Goals

- Support a production-grade persistent storage option for the backend,
  alongside the existing local-storage default used for development.
- Document every environment variable the deployment actually requires, with
  its purpose.
- Provide a complete README covering prerequisites, a one-command-style
  quickstart, the environment variable reference, how to reach the Convex
  administrative dashboard, and how to seed/verify test data.
- Prove the whole thing works end-to-end: a person other than the original
  implementer follows only the README, from a clean checkout, to a running
  stack with visible data — with any gaps found along the way fixed before
  sign-off.
- Document what meaningfully differs between a local development run and a
  self-hosted production run.

## Non-goals

- Any product feature's behavior (device registry, ingestion, live view,
  alerting, historical playback) — this feature is exclusively about
  deploying and documenting the stack, not what it does once running.
- Connecting real (non-simulated) devices or choosing a device communication
  protocol — foundation plan explicitly defers this past v1 pending an
  unresolved protocol decision; the simulator remains the shipped v1
  ingestion source for verification purposes.
- A reverse proxy or TLS termination — foundation spec marks this optional
  and not required for v1; if addressed at all, it is documented as an
  optional path, not a required deliverable of this feature.
- Establishing the first admin account's mechanics — that's owned by the
  auth-roles feature (its own requirement covers documenting the bootstrap
  step); this feature only needs the README to reference it, not redefine
  it.
- Backup/restore tooling, automated upgrades, or scaling guidance beyond
  what's needed to bring the stack up and confirm it works.

## User stories

- As a new engineer, I want to bring up the full stack from a clean checkout
  using only the README, so that I don't need undocumented tribal knowledge
  to get started.
- As a new engineer, I want a table of every environment variable the stack
  needs, so that I know what to configure before I start.
- As an engineer setting up a production-like deployment, I want to point the
  backend at durable storage instead of the local development default, so
  that data survives beyond a single container's lifecycle.
- As an engineer verifying a deployment, I want to know where the Convex
  administrative dashboard is and what it's for, so that I can inspect
  schema/data/function activity separately from the product's own UI.
- As an engineer, I want to know how to load or confirm test data after
  bringing the stack up, so that I can verify the deployment actually works
  rather than just starting without erroring.
- As a team lead, I want confirmation that someone other than the builder
  successfully followed the README end-to-end, so that I can trust the
  instructions before relying on them for a real deployment.

## Requirements

Each is a single, independently testable statement. IDs are stable — the
planner and reviewer reference them.

- **R1** — The backend supports a production-grade persistent storage option
  in addition to its local-storage development default.
- **R2** — Bringing up the full stack (backend, its administrative dashboard,
  the product frontend) is achievable with a small, fixed number of
  documented commands from a clean checkout.
- **R3** — The README documents every environment variable the deployment
  requires or supports, including its purpose and whether it's required or
  optional.
- **R4** — The README documents how to reach the Convex administrative
  dashboard and clarifies its purpose relative to the product's own
  operator-facing dashboard.
- **R5** — The README documents how to load or verify test/seed data after
  the stack is running.
- **R6** — The README documents what differs between a local development run
  and a self-hosted production run (at minimum, the storage option used).
- **R7** — A person other than the original implementer can follow only the
  README, from a clean checkout, to a running stack with visible seeded data,
  with no undocumented steps required.
- **R8** — Any gap found during that end-to-end verification is fixed (in the
  deployment configuration, the README, or both) before this feature is
  considered complete.

## Acceptance criteria

- **R1** — The backend can be started against the production-grade storage
  option and correctly persists and retrieves data through it, as an
  alternative to the local-storage default.
- **R2** — Following the documented startup commands on a clean checkout
  brings up backend, administrative dashboard, and frontend successfully,
  with no manual steps outside those commands.
- **R3** — Every environment variable actually read by the deployment appears
  in the README's table with a stated purpose and required/optional status;
  no required variable is missing from the table.
- **R4** — The documented administrative dashboard URL is reachable after
  startup and is clearly distinguished in the README from the product
  dashboard.
- **R5** — Following the README's seed/verify-data instructions results in
  visible data in the running stack.
- **R6** — The README's local-vs-production section correctly describes at
  least the storage difference, verified against the actual deployment
  configuration.
- **R7** — A second person, given only a clean checkout and the README,
  reaches a running stack with visible seeded data without asking the
  original implementer for undocumented steps.
- **R8** — Every issue that person encountered during that walkthrough has a
  corresponding fix in the configuration or README, confirmed by a repeat of
  the affected step succeeding afterward.

## Open questions

- **Storage backend choice** — foundation spec leaves SQLite-vs-Postgres (or
  another option) as an open question; R1 requires *a* production-grade
  option exists but foundation materials don't mandate which.
- **Convex Cloud vs. self-hosted divergence** — foundation spec notes some
  Convex Cloud-only capabilities may lack self-hosted equivalents, but does
  not enumerate them; whether this needs explicit README documentation is
  unresolved.
- **Who qualifies as "someone other than the original implementer" (R7)** —
  foundation materials describe this as the verification bar but don't
  specify a process for arranging or recording it.
- **Secrets handling for a real production deployment** — foundation spec
  mentions secrets should come from something other than a committed env
  file for production use, without specifying a mechanism; left unresolved
  here.
