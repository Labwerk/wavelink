# Review: Authentication & role-based access control

> Reviewer, **round 2** (re-review after builder fixes; `plan.md` revision 3). Source files were not edited.
> A temporary file `backend/zzTempLeak.ts` was added for the R4 negative check and removed (confirmed gone).

## Verdict

**PASS.**

Every round-1 issue is fixed in code, and I found no new defect that fails a requirement. All 13 requirements are covered by passing tests or specific code locations.

This verdict has one condition. R1 (live proxy behaviour), R9, R10, R12 (live) and R13 (live) cannot be verified inside this repo without a browser and a live Convex deployment. They are listed under "Not verifiable here", and the human `smoke-checklist.md` (27 rows, all currently unrun) is the path to close them. I am not treating them as FAIL, per the coordinator's guidance and because I found no code evidence of a defect. The feature should not be called release-ready until that checklist has been run.

## Round-1 issue status

| # | Round-1 issue | Status | Evidence |
|---|---|---|---|
| 1 | Bootstrap was a public action gated on a non-secret email (R13) | Fixed | `users.bootstrapAdmin` is `internalAction` (`backend/users.ts:220`); `PUBLIC_ENTRY_POINTS` is now only `["users:me"]` (`lib/publicEntryPoints.ts:13`); `tests/accounts.test.ts` "is not a public function"; README rewritten. Plan corrected (rev 3, "First admin" row). |
| 2 | Bootstrap could strand a viewer (R13) | Fixed | The admin role is decided inside `createUserRecord`, called from the `createOrUpdateUser` callback (`backend/auth.ts:24-29`, `lib/provisioning.ts:87-151`), so it commits or rolls back with the account. `tests/accounts.test.ts` "creates a working admin, its account and its audit row in one go", "refuses a different email and leaves nothing behind". `promoteBootstrapAdmin` stays as an internal recovery (tested). |
| 3 | `user.create` / bootstrap audit not atomic (R11) | Fixed | `createUserRecord` writes the audit row in the same transaction as the insert, with `createdBy` validated (exists, active, admin) (`provisioning.ts:128-150`). `users.createdBy` added (`schema.ts:86`). Tests: `accounts.test.ts` "createdBy must reference an existing, active admin", "an admin-attributed creation writes viewer + createdBy + audit row together", "non-empty table with no createdBy is rejected". |
| 4 | Stale-cookie 200 + `location` blank page (R1/R10) | Fixed for the invalid-cookie case, with a limit | `frontend/lib/normalizeRedirect.ts` + `frontend/proxy.ts`. I rebuilt and ran `next start`: forged cookies on `/admin/users` now return **307**, `location: /signin`, with the three auth cookies cleared (round 1: 200, empty body). No-cookie `/` still 307. Unit tests in `tests/proxy.test.ts`. Library pinned to exact `0.0.95` in both `package.json` files (installed version confirmed). **Limit:** verified only with forged cookies, not a genuinely expired server-side session (smoke row 21). |
| 5 | README recovery claim not implementable | Fixed | `users:setPassword` internalAction (`users.ts:297-319`: `modifyAccountCredentials` + `invalidateSessions` + audit row); tested ("setPassword replaces the credential, signs the user out, and is audited without an actor"); README "recovery" section rewritten. |
| 6 | No browser smoke record | Partly addressed | `smoke-checklist.md` written (27 rows). All results are blank, as the builder states. Needs a human run. |
| 7 | tmp stub tests | Fixed | `tests/tmp*.test.ts` gone. |
| 8 | Unused simulator `convex` dep | Fixed | Removed from `gateway/simulator/package.json` and its lockfile; simulator typechecks. |
| 9 | `isActive` had no writer | Fixed | `users.setActive` (`users.ts:108-136`): admin-only, audited, refuses self-deactivation and removing the last active admin; `accounts.test.ts` "users.setActive (R7, R11)" block (6 tests). |
| 10 | Hand-edited `_generated/api.d.ts` | Open, non-code | Builder could not run codegen (no deployment). Typecheck passes against the file. Needs one real `npx convex dev` / codegen run (T19). |
| 11 | Plan defaults not confirmed with the user | Open, non-code | Owned by main (T21). |

## Requirement coverage

| Req | Status | Evidence |
|---|---|---|
| R1 | Met (server); proxy Met for signed-out and forged-cookie, live expiry pending | Server: every protected function goes through `authedQuery/Mutation/Action` (`backend/lib/functions.ts`) which run `requireCapability` first (`lib/auth.ts:54-59`); tests `devices.test.ts` "unauthenticated calls are rejected", "a deactivated user is treated like a signed-out one". Proxy: `frontend/proxy.ts`; `next build` lists `Proxy (Middleware)`; curl: signed-out `/` and `/admin/users` give 307 to `/signin`, `/signin` gives 200, forged cookies give 307 plus cleared cookies. |
| R2 | Met | `users.role` is a required union (`schema.ts:79-89`). Writers: `createUserRecord` (viewer, or admin on the self-derived bootstrap) and `users.setRole`. Tests: `provisioning.test.ts` (role outside the four cannot be stored; forged role ignored), `accounts.test.ts` "a forged role in the profile is ignored on the bootstrap path only when the email matches". |
| R3 | Met | Role read from the stored row per call (`lib/auth.ts:46-49`); no caller-supplied role. Tests: `users.test.ts` "a client-claimed role has no effect", "role removal takes effect on the very next call"; `accounts.test.ts` "non-empty table with no createdBy is rejected". |
| R4 | Met | Capability required, no default (`lib/functions.ts`); unknown capability denies all (`lib/permissions.ts:45-58`). Meta-test `denyByDefault.test.ts` passes. **Negative check re-run:** a temp file exporting a raw `query`, `mutation` and `action` made 2 of 9 fail as intended; file removed. Also `permissions.test.ts` "an unknown capability denies even an admin". |
| R5 | Met | `lib/permissions.ts:32-41` matches the spec table; `permissions.test.ts` ("holds exactly the capabilities in the spec table" per role, inheritance, per-role allowed and forbidden). |
| R6 | Met | One opaque `NOT_AUTHORIZED` for every denial. Tests: `devices.test.ts` non-leakage (forbidden-existing vs non-existent, write and read); `users.test.ts` "denials are identical", "a forbidden existing target and a non-existent target are indistinguishable"; `accounts.test.ts` "setActive is admin-only and denies before looking at the target". |
| R7 | Met | `users.list`, `setRole`, `setActive`, `createUser`, `audit.list` all use `user.manage`. Tests in `users.test.ts` and `accounts.test.ts` (non-admin denied, admin allowed). |
| R8 | Met | `users.me` (`users.ts:34-49`) returns `{_id,name,email,role,capabilities}` or `null`, never throws; `users.test.ts` "users.me" block. |
| R9 | Met by code inspection; live check pending | `frontend/app/page.tsx` gates register, deactivate and "Manage users" on `me.capabilities`; `frontend/app/admin/users/page.tsx` shows "Not available" without `user.manage`. Server enforcement is tested. Smoke rows 9, 13, 14, 17. |
| R10 | Met by config and code; live check pending | Sign-in page, sign-out, session policy (`backend/auth.ts:15-18`, 8 h idle / 7 d cap / 1 h JWT), session cookie (`proxy.ts`), README "Session policy". Live sign-in, reload and sign-out unrun (smoke rows 4-7, 21, 22). |
| R11 | Met | Role change audited atomically with actor, target, from/to and time (`users.test.ts` "admin changes a role; ... audit row records who, whom, from/to, when"). Device writes audited in-transaction. Account creation and bootstrap now audited in the creation transaction (issue 3 fix). `setActive` audited. |
| R12 | Met (function level); live pending | `ingest.recordBatch` is internal; `POST /ingest/telemetry` with constant-time bearer check that fails closed (`http.ts`, `lib/serviceAuth.ts`); `ingest.test.ts` (9 tests: service token with no session, missing/wrong token 401, user-session bearer rejected, unset token rejects all, malformed 400). Simulator typechecks; not run live (smoke rows 23-25). |
| R13 | Met (function level); live pending | `users.bootstrapAdmin` is an `internalAction` run via `npx convex run` with the admin key; empty-table and email checks are re-derived inside the creation transaction. `accounts.test.ts` "first-admin bootstrap (R13)" (7 tests). README documents both flows. Not run on a clean deployment (smoke rows 1-2). |

## Test results

Run from `D:/Self/wavelink` (capital `D:`; from lowercase `d:` vitest reports no test suites, matching the builder's note, which is an environment quirk).

- `npm test`: **8 files, 102 tests, all pass.**
- `npx tsc --noEmit` for `backend`, `tests`, `frontend`, `gateway/simulator`: all clean.
- `next build`: succeeds; routes `/`, `/admin/users`, `/signin` and `ƒ Proxy (Middleware)`.
- `next start` + curl (backend not running): no cookie gives 307 to `/signin`; forged cookies on `/admin/users` give 307 to `/signin` with cookies cleared; `/signin` gives 200.
- R4 negative check: fails as intended (see above), temp file removed, `git status` shows no `zz`/`tmp` leftovers.

## Issues

### Blocking
None.

### Should-fix
None.

### Nice-to-have

1. **Plan data-model drift (plan defect, minor).** `plan.md:222` still lists `auditLog.actorId` as `v.id("users")` (required), but the schema and rev-3 decisions make it optional for break-glass rows (`schema.ts:96`). Update the table so the plan matches the code.
2. **Break-glass audit rows have no actor and are not atomic.** `user.setPassword` and `user.recoverAdmin` are recorded with `details.via = "deployment-admin-key"` and no `actorId`; `setPassword`'s row is written just after the credential change in a second transaction (documented in code and README). I accept this: no authenticated user exists for these operations, and R11's wording concerns authenticated users. The admin page renders an actorless row as "deployment admin key" (`admin/users/page.tsx:130`). Consider recording who ran the command (an operator note) if that matters operationally.
3. **`normalizeRedirect` depends on the library's exact 200+`location` shape.** It is pinned to `@convex-dev/auth@0.0.95`; re-check the workaround on any upgrade. Verified with forged cookies only; run smoke row 21 with a genuinely expired session.
4. `backend/_generated/api.d.ts` is still hand-edited (T19): run one real `npx convex dev` / `npx convex codegen` and confirm no diff.
5. The plan's "Confirm before build" defaults (session policy 8 h / 7 d / session cookie, no role-change notification, dropping `users.authId`) still have no recorded user confirmation (T21, owned by main).

## Not verifiable here (human smoke checklist is the path)

These need a browser and/or a live deployment. None shows a defect in code; each is unrun, not failed.

- **R1 / R10:** real sign-in, page-reload persistence, sign-out, idle/expiry behaviour and the genuinely-expired-session redirect (smoke rows 3-7, 21, 22).
- **R9:** UI gating for viewer versus admin, and the live role-change update (rows 9, 13-17).
- **R12:** simulator against a live backend on the site port 3211, and the 401 cases via curl (rows 23-25).
- **R13:** the documented bootstrap on a clean deployment, including `docker compose down -v && up` (rows 1-2).
- **Bundler acceptance:** that the wrapper-built functions register with the real Convex bundler (plan "Unknowns for the builder"); the plan asked for this to be confirmed at the keyboard.
- `recordBatch`, `bootstrapAdmin` and `setPassword` being internal is asserted from source (tests read the file), because `convex-test` does not enforce internal versus public.

## Plan or spec defects

No spec defect. The one plan defect from round 1 (public bootstrap gated on a non-secret) was corrected in plan rev 3. The only remaining plan drift is nice-to-have 1.
