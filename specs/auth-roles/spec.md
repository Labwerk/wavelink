# Feature Spec: Auth & Roles (M2)

**Status:** Draft v0.1 — SDD feature spec, scoped from `specs/initial-spec.md`
**Milestone:** M2 — Auth & roles (see `plans/implementation-plan.md` Phase M2)
**Last updated:** 2026-09-19

## 1. Scope

Implements `specs/initial-spec.md` §4 (Users & Roles), §6.5 (Auth & Access Control),
the `users.*` rows of §10 (Function Plan), and `plans/implementation-plan.md`
Phase M2 in full. Out of scope: alerting (M3), historical playback (M4),
deployability (M5) — those phases are untouched by this feature.

## 2. Decision: Auth Provider

The parent spec (§14) leaves the auth provider as an open question between
Convex Auth, Clerk, WorkOS, or custom OIDC. This feature spec resolves it:

**Decision: Convex Auth (`@convex-dev/auth`) with the Password provider.**

Rationale:
- Native to Convex — no external account/SaaS dependency, consistent with
  this project's self-hosted, `docker compose up`-first deployment story
  (parent spec §12, README Quickstart).
- The parent spec's own "Best Practices" table (§11) already cites
  [Convex Auth RBAC example](https://github.com/get-convex/convex-auth-with-role-based-permissions)
  as the pattern for server-side role checks — this feature follows that
  reference implementation's shape.
- Password provider needs no external identity provider credentials,
  keeping the Quickstart ("no prior Convex experience", no extra signup)
  intact. Email/password is sufficient for v1; swapping in an OAuth
  provider later is additive (Convex Auth supports multiple providers)
  and does not require a schema migration since `users.authId` already
  stores an opaque provider-assigned identifier.

This is a reversible choice at the provider level (Convex Auth supports
adding/swapping providers without touching the `users` table shape), so it
does not block this phase.

## 3. Requirements (traced to parent spec)

| # | Requirement | Source |
|---|---|---|
| R1 | All dashboard access requires authentication; unauthenticated requests are rejected. | §6.5.17 |
| R2 | Every query/mutation/action that reads or writes protected data enforces a server-side role check against the caller's `users` row — never trusts a client-supplied role. | §6.5.18 |
| R3 | Role assignment (`users.setRole`) is callable by Admins only. | §6.5.19 |
| R4 | Unauthorized calls fail closed (deny by default): throw before touching data, and the error must not reveal whether the target resource exists. | §6.5.20 |
| R5 | `users` row is created/synced on first login (`authId`, `name`, `email`, default `role`, `isActive`). | §9 schema, §10 `users.me` |
| R6 | `users.me` returns the current user's profile + role for client-side UI gating; server still re-checks role per protected call. | §10 |
| R7 | `users.list` (admin-only) lists all users for role management. | §10 |
| R8 | `users.setRole` (admin-only) changes a target user's role. | §10 |
| R9 | Retrofit role checks onto `devices.register`/`update`/`deactivate` (admin only per plan Phase M2); reads (`devices.listActive`, `devices.get`, `telemetry.latestForDevice`) require only authentication (any of the four roles), since no role in §4 is denied read access to live device/telemetry views. | Phase M2 task list, §4 |
| R10 | Frontend gates device-management actions (register/edit/deactivate UI) by role, and shows a sign-in screen when unauthenticated. Server-side checks remain the actual enforcement point. | Phase M2 task list |
| R11 | New users default to the `viewer` role (least privilege) until an admin promotes them; there being no admin yet (fresh deployment) must not deadlock role assignment. | §4, deny-by-default principle |

## 4. Role Matrix

| Function | viewer | operator | maintenance | admin |
|---|---|---|---|---|
| `devices.listActive`, `devices.get`, `telemetry.latestForDevice` | ✅ | ✅ | ✅ | ✅ |
| `devices.register`, `devices.update`, `devices.deactivate` | ❌ | ❌ | ❌ | ✅ |
| `users.me` | ✅ (own row) | ✅ | ✅ | ✅ |
| `users.list`, `users.setRole` | ❌ | ❌ | ❌ | ✅ |

All rows above additionally require the caller to be authenticated (R1) and
`isActive: true` on their `users` row; a deactivated user is treated as
unauthorized for every protected function.

## 5. Bootstrap / First-Admin Problem (R11 detail)

On a fresh deployment there is no admin to promote the first user. Resolve
by: the **first** user ever created in the `users` table is auto-assigned
`admin` on creation; every subsequent first-login user defaults to
`viewer`. Implemented by checking whether the `users` table is empty at
the point of the sync-on-login mutation (single `.first()` read against an
existing index — cheap, no unbounded scan). Document this behavior in the
spec (here) and in the tasks/README so it isn't mistaken for a security
hole — it only applies while the table is empty, i.e. once, ever, per
deployment.

## 6. Server-Side Enforcement Design

- Add `backend/lib/auth.ts` (or equivalent) exporting a shared helper, e.g.
  `requireRole(ctx, allowedRoles)` / `getCurrentUser(ctx)`, used by every
  protected query/mutation. It:
  1. Resolves the authenticated identity via Convex Auth's `ctx.auth.getUserIdentity()`.
  2. Throws (deny-closed) if unauthenticated.
  3. Looks up the caller's `users` row by `authId` (`by_authId` index).
  4. Throws if no row, `isActive: false`, or role not in the allowed set.
  5. Returns the resolved `users` row/role to the caller for functions that
     need it (e.g. `users.me`).
- Error messages for auth/role failures must be generic (e.g. "Not
  authorized") and identical regardless of *why* access was denied, so they
  don't leak whether a device/user/record exists (R4).

## 7. Test Plan

Backend function tests using `convex-test` (+ Vitest) exercising, at
minimum, one test per Role Matrix cell that matters (deny + allow), plus:
- Unauthenticated call to a protected function is rejected.
- Deactivated user is rejected even with a valid role.
- First-user-becomes-admin bootstrap behavior.
- `users.setRole` by non-admin is rejected; by admin succeeds and is
  reflected in a subsequent `users.me`/`users.list` call.
- Error message parity between "role denied" and "record not found" style
  failures where applicable (R4 non-leakage).

## 8. Acceptance Criteria

- All items in §3 (R1–R11) implemented and covered by a passing automated
  test (§7).
- Manual security pass (parent spec success metric, §15): attempting every
  mutation/query in the Role Matrix as every role produces the expected
  allow/deny result.
- `plans/implementation-plan.md` Phase M2 checklist fully checked off and
  its exit criteria met.
- Frontend shows a sign-in flow when unauthenticated and hides/disables
  admin-only actions for non-admin roles, without weakening server checks.
