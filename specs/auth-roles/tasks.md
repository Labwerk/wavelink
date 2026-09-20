# Tasks: Authentication & role-based access control

> Written by builder against `plan.md` revision 3 (rev 3 = review round 1
> fixes; tasks T16-T21 are new). Ordered by dependency (setup -> core -> edge
> cases -> tests). Every requirement R1-R13 is covered. A task is ticked only
> when its acceptance check passed locally: typecheck
> (`npx tsc -p backend|tests --noEmit`, `frontend`, `gateway/simulator`) and
> `npm test` (run from `D:/Self/wavelink`; from lowercase `d:/` vitest fails
> with "No test suite found" - a drive-letter case quirk of this machine).
> The earlier "Implement M2 auth & roles" commit was verified against the code;
> only what was missing or wrong was rebuilt.

## Setup

- [x] **T1** — Dependencies and test harness (already present from the M2 commit; verified). `@convex-dev/auth` now pinned to exactly `0.0.95` (see T12).
  - Files: `package.json`, `frontend/package.json`, `vitest.config.ts`
  - Satisfies: enables R2-R13 tests
  - Acceptance: `@convex-dev/auth@0.0.95`, `@auth/core`, `convex-test`, `vitest` installed; `npm test` runs.

## Core (backend)

- [x] **T2** — Capability map and rank comparison.
  - Files: `backend/lib/permissions.ts`
  - Satisfies: R5, R4 (unknown capability/role never granted)
  - Acceptance: `tests/permissions.test.ts` - map matches the spec table per role, inheritance holds, unknown/prototype-key capabilities denied.

- [x] **T3** — Schema: drop `users.authId`/`by_authId`; add `by_email`, `users.createdBy` (optional id), and the `auditLog` table (`actorId` optional, absent only for deployment-admin-key operations).
  - Files: `backend/schema.ts`
  - Satisfies: R2, R11
  - Acceptance: backend typecheck clean; `tests/provisioning.test.ts` - a role outside the four, or a missing role, cannot be stored.

- [x] **T4** — Server authorization: `requireCapability` (identity = `getAuthUserId` -> `users._id`, role from the row per call, single opaque `NOT_AUTHORIZED`), audit helper.
  - Files: `backend/lib/auth.ts`, `backend/lib/audit.ts`
  - Satisfies: R1, R3, R6, R11
  - Acceptance: `tests/permissions.test.ts`, `tests/users.test.ts` - unauthenticated, wrong-role, deactivated, missing-row and unknown-capability denials are identical; forged identity claims are ignored.

- [x] **T5** — Deny-by-default wrappers `authedQuery`/`authedMutation`/`authedAction` (capability required, no default), internal `authz.authorize` for actions, allow-list module (now only `users:me`).
  - Files: `backend/lib/functions.ts`, `backend/authz.ts`, `backend/lib/publicEntryPoints.ts`
  - Satisfies: R3, R4
  - Acceptance: backend typecheck clean; wrapped actions authorize (users.createUser tests).

- [x] **T6** — Meta-test failing any exported function on a raw `query`/`mutation`/`action` outside the allow-list (and any unauthorised import of the raw builders).
  - Files: `tests/denyByDefault.test.ts`
  - Satisfies: R4
  - Acceptance: passes on the tree; "no stale exceptions" case guarantees `users:bootstrapAdmin` is no longer allow-listed; verified in round 1 that it fails when a raw-builder export is added.

## Auth wiring and provisioning

- [x] **T7** — Convex Auth config: Password provider whose `profile` rejects every flow except `signIn`; session 8 h idle / 7 d hard cap / 1 h JWT. **Rev 3:** the creation callback delegates to `createUserRecord`, which decides everything inside the account-creation transaction: (a) table empty AND email == `INITIAL_ADMIN_EMAIL` -> admin + `user.bootstrapAdmin` audit row, re-derived from DB/env; (b) `profile.createdBy` is an existing, active admin -> viewer + `createdBy` + `user.create` audit row; (c) otherwise throw. Any role/isActive in the profile is ignored.
  - Files: `backend/auth.ts`, `backend/lib/provisioning.ts`
  - Satisfies: R2, R3, R10, R11, R13, provisioning + default-role decisions
  - Acceptance: `tests/provisioning.test.ts`, `tests/accounts.test.ts` "creation is one transaction" - `signUp` and other flows throw; empty table + wrong email, non-empty table with no/invalid `createdBy` (viewer, operator, inactive admin, deleted admin, garbage, number, null) all reject with users/accounts/auditLog counts unchanged; valid admin `createdBy` yields viewer + audit in one go; forged `role: "admin"` yields viewer.

- [x] **T8** — `users` module: `me` (never throws; null when signed out/deactivated; returns capabilities), `list`, `setRole` (authorize first, audit row same mutation, last-*active*-admin protection), `setActive` (admin-only, audited, not yourself, not the last active admin), `createUser` (admin action; passes server-resolved `createdBy`; no follow-up mutation), admin-only `audit.list`.
  - Files: `backend/users.ts`, `backend/audit.ts`
  - Satisfies: R2, R6, R7, R8, R11
  - Acceptance: `tests/users.test.ts`, `tests/accounts.test.ts` - non-admin denied / admin allowed; role change and activation changes reflected, audited (actor, target, from/to, time) and effective on the next call; last admin cannot be demoted or deactivated (an inactive admin does not count); createUser yields viewer with `createdBy` and one `user.create` row.

- [x] **T16** — Deployment-admin-key internal functions (rev 3 C1/C3, issues 1, 2, 5): `users.bootstrapAdmin` is an `internalAction` (run via `npx convex run`; empty-table + `INITIAL_ADMIN_EMAIL` checks kept as defence in depth); `users.promoteBootstrapAdmin` kept as internal-only recovery (audited, no actor); new `users.setPassword` `internalAction` (`modifyAccountCredentials` + `invalidateSessions`, audited, no UI).
  - Files: `backend/users.ts`, `backend/lib/publicEntryPoints.ts`
  - Satisfies: R13, R3, R11
  - Acceptance: `tests/accounts.test.ts` - bootstrap creates admin + account + audit row; refuses wrong email / existing users / unset env / second run / short password with nothing left behind; source declares `internalAction` and no public `bootstrapAdmin`; recovery promotes a lone stranded user and refuses otherwise; `setPassword` changes the credential, deletes sessions, audit row has no `actorId` and `via: deployment-admin-key`.

## Apply RBAC to existing functions

- [x] **T9** — Devices and telemetry through the wrappers: reads need `data.read`; register/update/deactivate need `device.manage` and append audit rows.
  - Files: `backend/devices.ts`, `backend/telemetry.ts`
  - Satisfies: R1, R3, R5, R6, R11
  - Acceptance: `tests/devices.test.ts` - all four roles read; viewer/operator/maintenance denied writes; admin allowed; audit rows carry actor and time; forbidden-existing vs non-existent target indistinguishable; deactivated user denied.

- [x] **T10** — Ingestion behind a service credential: `ingest.recordBatch` is an internal mutation; `POST /ingest/telemetry` checks `Authorization: Bearer $INGEST_SERVICE_TOKEN` (constant-time, fails closed when unset).
  - Files: `backend/ingest.ts`, `backend/http.ts`, `backend/lib/serviceAuth.ts`
  - Satisfies: R12
  - Acceptance: `tests/ingest.test.ts` - valid token posts a batch with no session; missing/wrong token or a user-session bearer gets a bare 401 and writes nothing; unset token rejects all; malformed bodies 400.

- [x] **T11** — Simulator posts to the HTTP route with the service token and site URL; no longer calls `devices.register`; unused `convex` dependency removed (package.json and its own lockfile pruned, root lock synced).
  - Files: `gateway/simulator/src/index.ts`, `gateway/simulator/package.json`, `gateway/simulator/package-lock.json`, `package-lock.json`, `docker-compose.yml`
  - Satisfies: R12
  - Acceptance: simulator typechecks; `docker compose config` parses; lockfile diff is removals only. (Live end-to-end not run.)

## Frontend (Next.js 16)

- [x] **T12** — `frontend/proxy.ts` (Next 16 name; `convexAuthNextjsMiddleware`, session cookie, redirect signed-out to `/signin`), `ConvexAuthNextjsServerProvider` in `layout.tsx`, `ConvexAuthNextjsProvider` in `providers.tsx`. **Rev 3 (issue 4):** `frontend/lib/normalizeRedirect.ts` turns the library's "200 + location + cleared cookies" (invalid/expired session) back into a real 307 to `/signin`; `@convex-dev/auth` pinned to `0.0.95` in both package.json files and the lock.
  - Files: `frontend/proxy.ts`, `frontend/lib/normalizeRedirect.ts`, `frontend/app/layout.tsx`, `frontend/app/providers.tsx`, `package.json`, `frontend/package.json`, `package-lock.json`
  - Satisfies: R1, R10
  - Acceptance: `tests/proxy.test.ts` (wrapper turns the library's 200+location into a 3xx and keeps cookies; other responses untouched); `next build` lists the Proxy; `next start` + curl: before the fix a request with forged `__convexAuthJWT`/`__convexAuthRefreshToken` cookies got `200` + `location: /signin`, after it gets `307` + `location: /signin` + all three cookies cleared, and following it ends at `/signin` (200); no-cookie requests 307; `/signin` 200. NOT verified against a live backend with a genuinely expired session (needs a running deployment).

- [x] **T13** — Sign-in page (sign-in only, no sign-up toggle); dashboard sign-out; role gating from `me.capabilities`; `/admin/users` (user list, role selector, activate/deactivate, create-user form, audit list) shown only with `user.manage`; audit rows without an actor render as "deployment admin key".
  - Files: `frontend/app/signin/page.tsx`, `frontend/app/page.tsx`, `frontend/app/admin/users/page.tsx`
  - Satisfies: R7, R8, R9, R10
  - Acceptance: frontend typecheck + `next build` clean. Interactive behaviour NOT exercised in a browser - see T20.

## Config & docs

- [x] **T14** — Env vars and README (rev 3): bootstrap documented as an admin-key-only internal function for Quickstart and Docker, with the email/empty-table checks described as defence in depth (not the security boundary); break-glass `setPassword` / `promoteBootstrapAdmin`; atomic attribution; deactivation; session policy and the library pin/workaround; no-notification decision; `authId` reset note.
  - Files: `.env.example`, `docker-compose.yml`, `README.md`
  - Satisfies: R13, R10
  - Acceptance: README commands match the function names/args covered by `tests/accounts.test.ts`. A fresh `docker compose down -v && up` run was NOT performed.

## Review round 1 clean-up

- [x] **T17** — Delete the stub tests `tests/tmp.test.ts` and `tests/tmp2.test.ts` (issue 7).
  - Satisfies: hygiene
  - Acceptance: files gone; `npm test` count no longer includes them.

- [x] **T18** — Remove the unused `convex` dependency from the simulator (issue 8) - see T11.

- [ ] **T19** — `backend/_generated/api.d.ts` (issue 10): `npx convex codegen` was attempted and cannot run here ("No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project"), so the hand-edited file is unchanged. Typecheck passes against it; it must be regenerated by a real `npx convex dev` / codegen run against a deployment.
  - Acceptance: attempted; NOT regenerated. Open item.

- [x] **T20** — Written manual smoke checklist for a human (issue 6): `specs/auth-roles/smoke-checklist.md`. Every row is unrun; the Result column is blank on purpose.
  - Satisfies: R1, R9, R10, R12, R13 (manual evidence still owed)
  - Acceptance: file exists; no results claimed.

## Verification

- [x] **T15** — Full pass: backend/tests/frontend/simulator typecheck clean; `npm test` green (102 tests, 8 files); `next build` green; `docker compose config` parses.
  - Satisfies: all
  - Acceptance: recorded in the hand-off report; reviewer confirms R1-R13.

- [ ] **T21** — Issue 11 (confirm the plan's "Confirm before build" defaults with the user) is owned by main; the builder took no action.
