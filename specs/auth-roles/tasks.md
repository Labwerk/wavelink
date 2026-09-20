# Tasks: Authentication & role-based access control

> Written by builder. Ordered by dependency. Every requirement in `spec.md` is
> covered. Mark `- [x]` only when its acceptance check passes (typecheck + tests
> run locally). Read `node_modules/next/dist/docs/` and the current `@convex-dev/auth`
> Next.js guide before the frontend tasks — Next.js 16 differs from training data.

## Setup

- [ ] **T1** — Add deps: `@convex-dev/auth`, `@auth/core` (root/backend); confirm
  `convex` version peer-req and bump if needed.
  - Files: `package.json`, `package-lock.json`
  - Satisfies: R1 (foundation)
  - Acceptance: `npm install` clean; `npx convex dev` starts without version errors.

- [ ] **T2** — Add test harness: `convex-test` + `vitest` + config.
  - Files: `package.json`, `vitest.config.ts`, `backend/vitest-setup` if needed
  - Satisfies: enables R3–R7 tests
  - Acceptance: `npm test` runs an empty suite green.

## Schema & auth core

- [ ] **T3** — Schema: add `...authTables`; redefine `users` with Convex Auth base
  fields + `role` (4-literal union) + `isActive`; keep `by_role` index; drop `authId`.
  - Files: `backend/schema.ts`
  - Satisfies: R2
  - Acceptance: `convex dev` typechecks; `alertRules.createdBy`/`alerts.acknowledgedBy` still compile.

- [ ] **T4** — Convex Auth wiring: `auth.ts` (Password provider + `afterUserCreatedOrUpdated`
  assigning role from `INITIAL_ADMIN_EMAILS` else `viewer`), `auth.config.ts`, `http.ts` routes.
  - Files: `backend/auth.ts`, `backend/auth.config.ts`, `backend/http.ts`
  - Satisfies: R2, R13
  - Acceptance: sign-up creates a user with the expected default/admin role (test).

- [ ] **T5** — Authorization helpers: `getCurrentUser`, `requireAuth`, `requireRole(min)`
  with numeric rank; uniform opaque error for forbidden vs not-found.
  - Files: `backend/lib/auth.ts`
  - Satisfies: R3, R4, R5, R6
  - Acceptance: unit tests — each role allowed vs forbidden action; deny-by-default; opaque error.

## Apply RBAC to existing functions

- [ ] **T6** — Gate reads with `requireAuth`: `devices.list`, `devices.get`,
  `devices.facets`, `telemetry.latestForDevice`.
  - Files: `backend/devices.ts`, `backend/telemetry.ts`
  - Satisfies: R1, R3
  - Acceptance: unauth call rejected; viewer call succeeds (test).

- [ ] **T7** — Gate device writes with `requireRole(admin)`, replacing the
  device-registry auth seam (`backend/lib/access.ts`'s `requireAdmin`/`getActor`,
  and the `access.currentActor` query, which `users.me` replaces): `devices.register`,
  `devices.update`, `devices.decommission`, `devices.reactivate`,
  `devices.changeHistory`. Delete `backend/lib/access.ts` once every caller is
  switched; flip `DEVICE_REGISTRY_REQUIRE_ADMIN`'s permissive default now that a
  real auth flow exists.
  - Files: `backend/devices.ts`, `backend/lib/access.ts` (removed)
  - Satisfies: R5, R16/R17/R31 (device-registry)
  - Acceptance: viewer/operator denied, admin allowed (test); no remaining
    references to `requireAdmin`/`getActor`/`access.currentActor`.

- [ ] **T8** — Confirm `ingest.recordBatch` stays service-auth only (no user-role guard);
  document the service-token expectation in a comment.
  - Files: `backend/ingest.ts`
  - Satisfies: R12
  - Acceptance: batch write works with no user session; a user session can't substitute (test/asserted).

## User management

- [ ] **T9** — `users.me` (caller profile+role or null), `users.list` (admin),
  `users.setRole` (admin; validate target + role).
  - Files: `backend/users.ts`
  - Satisfies: R7, R8, R11
  - Acceptance: non-admin denied on list/setRole; admin succeeds; `setRole` change reflected (test).

## Frontend

- [ ] **T10** — Provider + middleware: `ConvexAuthNextjsProvider`, `middleware.ts`
  protecting app routes.
  - Files: `frontend/app/providers.tsx`, `frontend/middleware.ts`
  - Satisfies: R1, R10
  - Acceptance: signed-out hit on `/` redirects to sign-in; session persists across reload.

- [ ] **T11** — Sign-in page (email+password, no public sign-up) + sign-out control.
  - Files: `frontend/app/signin/page.tsx`, `frontend/app/page.tsx`
  - Satisfies: R10
  - Acceptance: valid creds sign in; sign-out returns to protected state.

- [ ] **T12** — Role-based UI gating on the dashboard via `useQuery(api.users.me)`.
  Also swap `frontend/app/devices/DevicesView.tsx`'s existing
  `useQuery(api.lib.access.currentActor, {})` (the device-registry seam, whose
  `isAdmin` prop already flows into `DeviceDetail.tsx`) for the same `users.me`
  role check.
  - Files: `frontend/app/page.tsx`, `frontend/app/devices/DevicesView.tsx`
  - Satisfies: R8, R9
  - Acceptance: viewer sees no admin/operator controls; admin sees user-management entry;
    device admin controls (register/edit/decommission/history) still gate correctly.

## Config & docs

- [ ] **T13** — Env vars for Convex Auth + `INITIAL_ADMIN_EMAILS`; document first-admin
  bootstrap and the sign-in flow in README.
  - Files: `.env.example`, `frontend/.env.local.example`, `README.md`
  - Satisfies: R13
  - Acceptance: following README on a clean deploy yields a working admin account.

## Verification

- [ ] **T14** — Full pass: `convex dev` typecheck clean, `npm test` green, manual
  smoke of sign-in → role-gated dashboard. Hand to reviewer.
  - Satisfies: all
  - Acceptance: all tests pass; reviewer confirms R1–R13.
