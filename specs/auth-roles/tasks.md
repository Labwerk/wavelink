# Tasks: Auth & Roles (M2)

Traces to `specs/auth-roles/spec.md` (R1–R11, §4–§8) and
`plans/implementation-plan.md` Phase M2. Ordered for implementation.

## 1. Backend dependencies & setup

- [x] Install `@convex-dev/auth` + `@auth/core` at the repo root (`backend/`
      isn't its own npm package — deps live in root `package.json`, per
      `convex.json`'s `functions: "backend/"`). (§2)
- [x] Add `@convex-dev/auth` to `frontend/package.json` too (it needs the
      `/react` subpath client-side), matching the existing pattern of
      `convex` being listed in both root and `frontend/package.json`.

## 2. Schema (§9 parent spec, §2/§5/§6 this spec)

- [x] Merge Convex Auth's `authTables` into `backend/schema.ts`
      (`authSessions`, `authAccounts`, `authRefreshTokens`,
      `authVerificationCodes`, `authVerifiers`, `authRateLimits`), while
      keeping the existing custom `users` table (already matches the spec:
      `authId`, `name`, `email`, `role`, `isActive`, `by_authId`, `by_role`)
      as an explicit override of `authTables.users` — our own
      `createOrUpdateUser` callback (see §4 below) owns user-row creation,
      so none of Convex Auth's default `users` fields are needed.

## 3. Auth wiring (§2 decision: Convex Auth + Password provider)

- [x] `backend/auth.config.ts` — JWT provider config
      (`{ domain: CONVEX_SITE_URL, applicationID: "convex" }`).
- [x] `backend/auth.ts` — `convexAuth({ providers: [Password] })`, exporting
      `auth`, `signIn`, `signOut`, `store`, `isAuthenticated` (file/export
      names are load-bearing: the React client hardcodes `auth:signIn` /
      `auth:signOut` function references).
- [x] `backend/http.ts` — `auth.addHttpRoutes(http)` (JWKS / OIDC discovery
      endpoints Convex needs to validate the auth provider's tokens).
- [x] Document the `JWT_PRIVATE_KEY` / `JWKS` / `SITE_URL` deployment env
      vars Convex Auth requires (generated locally, set via
      `npx convex env set` — never committed) in the README.

## 4. Bootstrap rule + user sync (§5, R5, R11)

- [x] `backend/users.ts`: `syncUserOnLogin(ctx, args)` — called from
      `auth.ts`'s `createOrUpdateUser` callback. No-ops (returns the
      existing id) on repeat logins. On first login: single `.first()` read
      to check whether `users` is empty (cheap, bounded, runs once ever per
      deployment) → `admin` if so, else `viewer`; inserts the row, then
      patches `authId` to the row's own id (Convex Auth identifies callers
      by this id — see `getAuthUserId`).

## 5. Shared server-side role-check helper (§6, R2/R4)

- [x] `backend/lib/auth.ts`:
  - `getCurrentUser(ctx)` — resolves the caller's `users` row via
    `getAuthUserId` + `by_authId` index lookup, or `null`.
  - `requireAuthenticatedUser(ctx)` — throws unless authenticated + active
    (any role). For Role Matrix cells open to all four roles.
  - `requireRole(ctx, allowedRoles)` — throws unless authenticated, active,
    and role ∈ `allowedRoles`.
  - All throws use the same generic `NOT_AUTHORIZED` message/exception
    shape, regardless of *why* (unauthenticated vs. inactive vs. wrong
    role) — R4 non-leakage.

## 6. `users.*` functions (§10, R6/R7/R8)

- [x] `users.me` (query) — returns `getCurrentUser(ctx)`; `null` when
      unauthenticated, never throws (frontend uses this to decide
      sign-in-screen vs. dashboard).
- [x] `users.list` (query, admin-only via `requireRole`).
- [x] `users.setRole` (mutation, admin-only via `requireRole`; validates the
      target user exists, throws a distinct "User not found" for a bad id
      — this is post-authorization data validation, not an auth denial, so
      R4 doesn't apply to it).

## 7. Retrofit `devices.ts` / `telemetry.ts` (R9, §4 Role Matrix)

- [x] `devices.register` / `update` / `deactivate` → `requireRole(ctx,
      ["admin"])`; remove the `TODO(M2)` comment.
- [x] `devices.listActive` / `devices.get` / `telemetry.latestForDevice` →
      `requireAuthenticatedUser(ctx)` (open to all four roles per the Role
      Matrix — no role is denied read access to live device/telemetry
      views).

## 8. Frontend (R10)

- [x] Read `frontend/AGENTS.md` + the bundled Next.js docs
      (`node_modules/next/dist/docs/`) before touching frontend code — this
      Next.js version deprecates `middleware.js` in favor of `proxy.js`;
      since this app is fully client-rendered (no SSR auth checks needed),
      neither is used here — auth is handled entirely client-side via
      `@convex-dev/auth/react`.
- [x] `frontend/app/providers.tsx` — swap `ConvexProvider` for
      `ConvexAuthProvider`.
- [x] `frontend/app/page.tsx`:
  - Sign-in/sign-up screen (email+password via `useAuthActions().signIn`)
    shown whenever `useConvexAuth().isAuthenticated` is false.
  - Dashboard reads `users.me` for the caller's role and gates the
    register-device form and the deactivate button to `role === "admin"`.
    Server-side `requireRole` checks remain the actual enforcement point.

## 9. Test framework + tests (§7)

- [x] Add Vitest + `convex-test` (+ `@edge-runtime/vm`) as dev
      dependencies; `npm run test` → `vitest run`. Test files live in a
      top-level `tests/` directory (outside `backend/`, which
      `convex.json` scopes as the deployable functions dir) so
      test-only code (`import.meta.glob`, vitest globals) is never at risk
      of being bundled into a real deployment.
- [x] `tests/users.test.ts`: bootstrap (first user → admin, next → viewer,
      repeat login no-ops), `users.me` (null when unauthenticated, own
      profile when authenticated), `users.list` (deny non-admin +
      unauthenticated, allow admin), `users.setRole` (deny non-admin, admin
      success reflected in a subsequent `me`/`list`), deactivated-admin
      rejection, and the R4 error-message-parity check across
      unauthenticated/wrong-role/deactivated denials.
- [x] `tests/devices.test.ts`: one test per Role Matrix cell — all four
      roles allowed on `listActive`/`get`/`latestForDevice`, unauthenticated
      denied on all three; viewer/operator/maintenance denied on
      `register`/`update`/`deactivate`, admin allowed on all three.

## 10. Docs & plan bookkeeping

- [x] `plans/implementation-plan.md`: check off Phase M2's checklist items
      and update "Next steps (resume here)".
- [x] `README.md`: update the Status line (auth/roles no longer "not yet
      built"), document the new env vars, and note the bootstrap rule so
      it isn't mistaken for a security hole.

## 11. Verification (§8 Acceptance Criteria)

- [x] `npm test` (Vitest + convex-test) passes — one test per Role Matrix
      cell, bootstrap, `setRole` authorization, and R4 non-leakage.
- [x] `npx tsc --noEmit` clean for `backend/`, `tests/`, and `frontend/`.
- [x] `npx convex codegen` (offline, no live deployment reachable in this
      environment — see report) pushes cleanly with no schema/type errors.
