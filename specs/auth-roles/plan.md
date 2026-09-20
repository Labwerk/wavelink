# Plan: Authentication & role-based access control

> Written by planner. Realizes `specs/auth-roles/spec.md` (R1–R13). HOW + research.
> No implementation code here; the builder turns this into `tasks.md` and code.

## Decision summary

- **Auth mechanism: Convex Auth (`@convex-dev/auth`) with the Password provider.**
  Rationale: it runs entirely inside the self-hosted Convex backend with no external
  SaaS dependency (Clerk/WorkOS would add a hosted dependency that contradicts the
  self-hosted goal in `foundation/spec.md` §3). Password provider needs no email
  service to start. Resolves the "Auth provider" open question.
  Rejected: Clerk/WorkOS (hosted dependency, extra cost, network egress from a
  factory-floor deployment); custom OIDC (more to build and secure ourselves).
- **Account provisioning: admin-invites-only in v1** — sign-up is not public. New
  users get the `viewer` role by default; an admin promotes them. (Resolves the
  provisioning open question conservatively; can loosen later.)
- **First admin: env-seeded allowlist** — `INITIAL_ADMIN_EMAILS` (comma-separated).
  On user creation, if the email is in that list, assign `admin`; otherwise `viewer`.
  This solves R13 without a pre-existing admin and needs no manual DB poke.
- **All four roles ship now** (viewer/operator/maintenance/admin) — the schema and
  spec already define them; gating maintenance-only features (playback/export) is
  cheap even though those features land in later milestones.

## Architecture

```
Browser ──(sign in: email+password)──▶ Convex Auth HTTP routes (backend/http.ts)
   │                                         │ issues session (JWT + refresh)
   │  ConvexAuthNextjsProvider + middleware  │
   ▼                                         ▼
Next.js app ──authenticated queries/mutations──▶ Convex functions
   (UI gated by users.me role)                    │ every protected fn calls
                                                  │ requireRole(ctx, minRole)
                                                  ▼
                                          users table (role) + data tables

Gateway/simulator ──ingest.recordBatch (service token, NOT user auth)──▶ telemetry
```

- Identity lives in Convex Auth's own tables (`authTables`); the app's `users`
  table is **extended** with `role`/`isActive`. A user's `users._id` IS their
  identity — `getAuthUserId(ctx)` returns it server-side. The current custom
  `authId: v.string()` field is dropped (redundant under Convex Auth).
- Server-side authorization is a single choke-point helper, not scattered `if`s.

## Tech decisions

| Decision | Choice | Rationale | Rejected |
|---|---|---|---|
| Auth library | `@convex-dev/auth` + `@auth/core` | Self-hosted, first-party Convex, Password provider works offline | Clerk/WorkOS (hosted), custom OIDC (build cost) |
| Role model | Numeric hierarchy: viewer 0 < operator 1 < maintenance 2 < admin 3 | Inheritance (R5) is a `>=` check; one helper covers all | Per-capability ACL table (overkill for v1) |
| Enforcement point | `requireRole(ctx, min)` / `requireAuth(ctx)` in `backend/lib/auth.ts`, called first in every protected fn | Deny-by-default (R4), no client trust (R3), one place to audit | Inline checks per fn (drift, easy to forget) |
| Default role + bootstrap | `afterUserCreatedOrUpdated` sets role from `INITIAL_ADMIN_EMAILS` else `viewer` | Solves R13 with no manual step | Manual DB edit (undocumented, error-prone) |
| Frontend integration | `@convex-dev/auth/nextjs` provider + `convexAuthNextjsMiddleware` | Official Next.js App Router path; route + data gating (R1, R9) | Client-only gating (fails R1 on direct route hit) |
| Test harness | `convex-test` + `vitest` (new dev deps) | Official way to unit-test Convex fns incl. auth via `t.withIdentity` | Manual/e2e only (can't assert per-role deny cheaply) |

## Data model changes

`backend/schema.ts`:
- Add `...authTables` (from `@convex-dev/auth/server`) — brings `authAccounts`,
  `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, and a base `users` table.
- Redefine `users` = Convex Auth base fields + `role` (the existing 4-literal union),
  `isActive: boolean`, keep `.index("by_role", ["role"])`. Drop `authId`; keep the
  Convex-Auth-managed `email`. Keep `name` optional.
- `alertRules.createdBy` and `alerts.acknowledgedBy` (`v.id("users")`) are unaffected
  — `users._id` stays the identity.
- **Migration note:** breaking change to `users`, but the table is empty today (no
  auth flow shipped), so on a fresh/dev deployment this is safe. Flag for any
  environment that already seeded users.

## Function-level RBAC (what changes in existing code)

> **Updated post-merge:** `device-registry` (merged after this plan was first written)
> replaced `devices.listActive`/`devices.deactivate` with paginated `devices.list` +
> `devices.facets`/`devices.changeHistory`, and split `deactivate` into
> `decommission`/`reactivate`. It also added a temporary auth seam —
> `backend/lib/access.ts`'s `requireAdmin`/`getActor` and the `access.currentActor`
> query — standing in for the real role checks below, gated by
> `DEVICE_REGISTRY_REQUIRE_ADMIN` (default `false`, permissive). This feature's job
> is to **swap that seam out**, not add a second one: `access.ts` goes away, every
> caller of `requireAdmin` switches to `requireRole(ctx, "admin")`, and
> `access.currentActor` is replaced by `users.me`. See
> `specs/device-registry/spec.md`'s "Verification note — R16, R17, R31" and
> `specs/device-registry/plan.md`'s "Auth seam" section.

| Function | New guard | Requirement |
|---|---|---|
| `devices.list`, `devices.get`, `devices.facets` | `requireAuth` (viewer+) | R1, R3 |
| `telemetry.latestForDevice` | `requireAuth` (viewer+) | R1, R3 |
| `devices.register` / `update` / `decommission` / `reactivate` / `changeHistory` | `requireRole(admin)` (replaces `requireAdmin` from the device-registry seam) | R5, R7-adjacent, R16/R17/R31 |
| `ingest.recordBatch` | **unchanged** — service token at HTTP layer, no user role | R12 |

New functions (`backend/users.ts`):
- `users.me` — query, returns caller's `{_id, name, email, role}` or null. (R8)
- `users.list` — query, `requireRole(admin)`. (R7)
- `users.setRole` — mutation, `requireRole(admin)`, validates target + new role. (R7)

Helper (`backend/lib/auth.ts`):
- `getCurrentUser(ctx)` → user doc or null.
- `requireAuth(ctx)` → user doc or throw (deny-by-default).
- `requireRole(ctx, min)` → user doc if `rank(role) >= rank(min)` else throw.
- Failures throw the **same** opaque error regardless of "not found" vs "forbidden" (R6).

## Frontend changes

- `app/providers.tsx`: swap `ConvexProvider` → `ConvexAuthNextjsProvider`.
- `middleware.ts` (new): `convexAuthNextjsMiddleware` to protect all app routes;
  unauthenticated → sign-in. (R1)
- `app/signin/page.tsx` (new): email+password sign-in form (no public sign-up in v1).
- `app/page.tsx`: read `useQuery(api.users.me)`; render admin/operator controls only
  when the role allows; show a sign-out control. (R9)
- Env: add Convex Auth vars (`.env.example`, `frontend/.env.local.example`).

## Requirement coverage

| Req | Addressed by |
|---|---|
| R1 | Convex Auth session + Next.js middleware; `requireAuth` on all data fns |
| R2 | `users.role` single-value union; default assigned once on creation |
| R3 | `requireRole`/`requireAuth` read role from `users` via `getAuthUserId` — never client input |
| R4 | Helpers throw by default; a fn without a guard exposes nothing new (test T for deny-by-default) |
| R5 | Numeric rank + `>=`; hierarchy viewer<operator<maintenance<admin |
| R6 | Uniform opaque error for forbidden vs not-found |
| R7 | `users.list` / `users.setRole` gated `requireRole(admin)` |
| R8 | `users.me` for UI; every protected fn still re-checks server-side |
| R9 | `app/page.tsx` conditional rendering on `users.me` role |
| R10 | Convex Auth session persistence + sign-out; middleware revalidates |
| R11 | `getAuthUserId` available in every mutation; `users.setRole` records actor; ack wiring lands with M3 alerts (schema already has `acknowledgedBy`) |
| R12 | `ingest.recordBatch` stays on the service-token HTTP path, no user role |
| R13 | `INITIAL_ADMIN_EMAILS` env → admin on first sign-in; documented in README |

## Risks & unknowns

- **Next.js 16 API drift** — `frontend/AGENTS.md` warns APIs differ from training
  data; the builder MUST read `node_modules/next/dist/docs/` and the current
  `@convex-dev/auth` Next.js guide before writing the provider/middleware. Mitigation:
  pin versions, follow local docs, typecheck via `convex dev` before marking tasks done.
- **`@convex-dev/auth` version** — confirm the current release and its peer-dep on
  `convex` `^1.17`; upgrade `convex` if required. Do not assume the API from memory.
- **Password provider + self-hosted** — verify `SITE_URL`/JWT env setup works against
  the self-hosted backend, not just Convex Cloud.
- **Empty-users assumption** — the schema change is safe only if no users exist yet;
  re-confirm before applying on any seeded environment.
- **Test execution environment** — `convex-test`/`vitest` and `convex dev` typecheck
  run in the project's own toolchain (not reproducible from a remote file bridge);
  the builder/reviewer must run them locally.

## Sources

- [Introducing Convex Auth](https://stack.convex.dev/convex-auth)
- [Convex Auth docs](https://labs.convex.dev/auth) · [Password provider](https://labs.convex.dev/auth/config/passwords)
- [Convex Auth with role-based permissions (official example)](https://github.com/get-convex/convex-auth-with-role-based-permissions)
- [Convex Auth | Convex Developer Hub](https://docs.convex.dev/auth/convex-auth)
- [Convex Permissions (RBAC) component](https://www.convex.dev/components/vllnt/convex-permissions)
