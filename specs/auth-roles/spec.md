# Spec: Authentication & role-based access control

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `auth-roles`. Realizes milestone **M2** of [`../foundation/plan.md`](../foundation/plan.md)
> and section **§6.5** of [`../foundation/spec.md`](../foundation/spec.md).

## Overview

The dashboard currently has no authentication — anyone reaching it can see all
device and telemetry data and, once the write paths exist, act on it. This
feature adds sign-in and enforces role-based access so that every user is
identified, and each user can only see and do what their role permits. Access
control is enforced on the server for every protected operation, not just hidden
in the UI. Without this, the system cannot be exposed beyond a trusted local
network and cannot attribute state-changing actions (alert acknowledgement,
device edits) to a person.

## Goals

- Require authentication for all access to product data.
- Map every authenticated user to exactly one role and enforce that role's
  permissions server-side on every protected operation.
- Let admins manage which users hold which roles.
- Gate the UI so users are only shown actions they are allowed to perform, backed
  by (never replacing) server enforcement.

## Non-goals

- Choosing or building a specific auth provider/mechanism (planner decides).
- Multi-tenant / multi-site isolation (explicitly deferred in the foundation spec).
- Per-device or per-zone access control lists — roles are system-wide in v1.
- Device *control* authorization (bidirectional command safety) — out of scope.
- Self-service public sign-up, MFA, and SSO/SAML federation — not in v1 unless the
  chosen provider gives them for free.
- Authorization for the ingestion/gateway path beyond confirming it uses a
  *service* credential, not an end-user role.

## Users & roles

Four roles, from least to most privileged. Each higher role includes everything
the ones below it can do.

| Role | Can do |
|---|---|
| **Viewer** | View live dashboards and historical data. No state changes. |
| **Operator** | Everything Viewer can, plus acknowledge/clear alerts and add operational notes. |
| **Maintenance** | Everything Operator can, plus historical playback/export and device diagnostic detail. |
| **Admin** | Everything above, plus register/edit/decommission devices, manage alert rules, and manage users and roles. |

## User stories

- As an unauthenticated visitor, I am sent to a login screen and shown no product
  data until I sign in.
- As any authenticated user, I stay signed in across page reloads and can sign out.
- As a viewer, I can see factory-health dashboards but see no controls for actions
  I cannot perform.
- As an operator, I can acknowledge an active alert, and the record shows it was me.
- As an admin, I can see all users and change any user's role.
- As an admin setting up a fresh deployment, I can establish the first admin
  account without needing an admin to already exist.
- As a developer, I can trust that a user cannot perform a higher-role action by
  calling the backend directly, even if the UI would have hidden it.

## Requirements

Each is a single, independently testable statement. IDs are stable — the planner
and reviewer reference them.

- **R1** — All access to product data requires an authenticated session;
  unauthenticated requests receive no product data and are directed to sign in.
- **R2** — Every authenticated user is associated with exactly one role from
  {viewer, operator, maintenance, admin}.
- **R3** — Every server operation that reads or writes protected data checks the
  caller's role **on the server**, derived from stored user identity — never from
  a client-supplied role value.
- **R4** — Access is deny-by-default: an operation with no explicit permission for
  the caller's role is refused.
- **R5** — The role→capability mapping matches the "Users & roles" table above,
  with higher roles inheriting all lower-role capabilities.
- **R6** — A refused authorization fails closed and does not reveal whether the
  target data exists (no distinct "exists but forbidden" vs "not found" leak).
- **R7** — Admins, and only admins, can list users and assign or change a user's role.
- **R8** — The current user's own identity and role are retrievable for UI gating;
  the server still re-checks role on every protected call regardless.
- **R9** — The UI hides or disables controls for actions the current user's role
  cannot perform.
- **R10** — A user can sign in and sign out; a signed-in session persists across a
  page reload until sign-out or expiry.
- **R11** — Every state-changing operation is attributable to the authenticated
  user who performed it (e.g. an acknowledged alert records who and when).
- **R12** — The ingestion/gateway entry point authenticates with a service
  credential distinct from end-user auth and is not governed by the four user roles.
- **R13** — A fresh deployment has a defined, documented way to establish the first
  admin account without a pre-existing admin.

## Acceptance criteria

- **R1** — Hitting any product route or data query while signed out returns no
  data and yields a sign-in prompt.
- **R2** — Each user record resolves to one and only one role; no user can hold
  zero or multiple roles.
- **R3** — A request carrying a forged/elevated client-side role value is still
  evaluated at the actual stored role and refused if that role lacks permission.
- **R4** — A newly added protected operation with no role rule defined denies all
  callers by default (verified by test).
- **R5** — For each role, a test exercises one allowed and one forbidden action and
  gets the expected allow/deny.
- **R6** — A forbidden request for an existing resource and for a non-existent one
  are indistinguishable to the caller.
- **R7** — A non-admin calling the user-list or set-role operation is denied; an
  admin succeeds.
- **R8** — The "current user" lookup returns the caller's role; a protected call
  still re-checks and denies when appropriate even if the client claims otherwise.
- **R9** — For a viewer session, no acknowledge/edit/admin controls are rendered
  or are disabled.
- **R10** — After sign-in and a page reload the session is still valid; after
  sign-out, protected data is inaccessible again.
- **R11** — Acknowledging an alert records the acting user's identity and timestamp,
  visible in the alert's history.
- **R12** — The gateway can post a telemetry batch with its service credential and
  without any user session; a user session cannot be used in its place.
- **R13** — Following the documented bootstrap step on a clean deployment yields a
  working admin account.

## Open questions

- **Auth provider** — Convex Auth, Clerk, WorkOS, or custom OIDC? Affects the shape
  of stored user identity and the login flow. (Foundation open question; planner to
  resolve with the team.)
- **Account provisioning** — admin-invites-only, or self-service sign-up gated by
  an allowlist/domain?
- **First-admin bootstrap** — env-configured seed admin, a one-time setup token, or
  a CLI/seed script? (Drives R13.)
- **Maintenance role in v1** — ship all four roles now, or defer maintenance until
  historical playback lands?
- **Session expiry policy** — idle timeout vs fixed lifetime; provider default vs
  explicit.
