# Plan: Authentication & role-based access control

> Written by planner. Realizes `specs/auth-roles/spec.md` (R1–R13). HOW + research.
> No implementation code here; the builder turns this into `tasks.md` and code.
> Revision 3 — revision 2 aligned the plan to the spec's Definitions block and the
> rewritten R9/R11 acceptance criteria; this revision fixes the three plan-level
> defects found in review round 1 (`review.md` issues 1, 2, 3) and records decisions
> for issues 5 and 9. See "Revision 3: corrections after review round 1" below.

## Decisions (including the spec's open questions)

| Question | Decision | Why |
|---|---|---|
| Identity mechanism (resolved in spec) | **Convex Auth (`@convex-dev/auth`) + Password provider**, running inside our own Convex backend | Only self-hosted option that is first-party to the stack; no external hosted IdP, no network egress from a factory deployment. Rejected: Clerk/WorkOS/Auth0 (hosted dependency), Better Auth (extra service + adapter surface), custom OIDC (build & secure ourselves) |
| Provisioning (resolved in spec) | **Admin-provisioned accounts only.** Public sign-up is disabled at the provider level; an admin creates an account with a temporary password handed over out-of-band | Matches "invite-only, not self-service". Rejected for v1: invite-token table + self-set password (needs email delivery or link plumbing we have no infra for) |
| Default role (not a numbered requirement) | **Every newly created account is `viewer`**, structurally: the user-creation callback ignores any role in the incoming profile. The single exception is the first-admin bootstrap, which the callback re-derives from an empty table plus `INITIAL_ADMIN_EMAIL` (rev 3 / C2) — never from anything the caller supplies. An admin promotes afterwards via the audited `users.setRole` | Least privilege; no path exists for a client-supplied role to reach the database (supports R3) |
| First admin (R13) — **revised in rev 3** | **`internalAction`, reachable only with the deployment admin key** (`npx convex run users:bootstrapAdmin`), with the empty-table and `INITIAL_ADMIN_EMAIL` checks kept as defence in depth. The admin role and its audit row are written **inside the account-creation transaction** | Revision 2 made this a public action gated only on an email address, which is not a secret — anyone reaching a fresh deployment could claim admin first (review issue 1). The admin key already exists in both flows, so this adds no new secret. Rejected: public action + email gate (not a credential), a separate `BOOTSTRAP_TOKEN` env var (a second secret to distribute for no extra safety), manual DB edit (undocumented) |
| Password recovery (review issue 5) | **Break-glass only**: an `internalAction` (`users:setPassword`, via `modifyAccountCredentials`) runnable with the admin key, audited. No in-app reset, no email flow | Without it, one forgotten admin password bricks the deployment. Reusing the admin-key pattern keeps the public surface unchanged. Rejected: user-facing reset (needs email infra we do not have), README saying "no recovery in v1" (leaves a real lockout with no exit) |
| Account deactivation (review issue 9) | **Add `users.setActive`** — admin-only, audited, cannot deactivate yourself or the last admin | `isActive` is already read by every check, shown in the UI and covered by tests, but nothing can write it. Rejected: marking the column provisional (leaves dead weight in the enforcement path) |
| **Session expiry policy (was open — decide here)** | **Idle timeout 8 h + hard cap 7 days + 1 h access token.** `session.inactiveDurationMs = 8 h`, `session.totalDurationMs = 7 d`, `jwt.durationMs` left at the 1 h default. Auth cookie is a **session cookie** (`cookieConfig.maxAge = null`) | 8 h ≈ one shift, so a walked-away-from floor terminal locks itself by the next shift; 7 d forces periodic re-auth. Library defaults are 30 d / 30 d — too long for a dashboard intended to be exposed beyond the local network. Page reload still works (R10), closing the browser signs out. **Confirm before build** |
| **Role-change notification (was open — decide here)** | **No notification channel in v1.** The effect is immediate and visible instead: `users.me` is a live Convex query, so the acting user's role badge and gated controls change within about a second without a reload, and the change is written to the audit log where admins can see who changed whom and when | We have no self-hosted email infra and the spec requires none. Revisit when M3 adds any notification transport. **Confirm before build** |
| Role model | **Ranked hierarchy** viewer(0) < operator(1) < maintenance(2) < admin(3), with a named **capability → minimum role** map | R5 inheritance becomes a single `rank >= rank` comparison; the capability map is the one table to audit and to test. Rejected: per-role allow-lists at each call site (today's shape — expresses no inheritance, drifts), per-capability ACL rows (overkill for system-wide roles) |
| Attribution store (R11) | **Dedicated `auditLog` table** written by every state-changing admin operation | R11's new acceptance wants "who changed whom, and when" on a role change *today*, and alert-ack attribution later. A log generalizes; denormalized `roleUpdatedBy/At` columns would need a second mechanism per operation |

## Revision 3: corrections after review round 1

Three findings in `review.md` trace to this plan, not to the builder's code. All three
have the same root cause: revision 2 treated account creation as something that
happens in an action and is then patched up by follow-up mutations. It should be the
opposite — **`createOrUpdateUser` is the one transaction in which a user row comes into
existence, so every decision about that row belongs inside it.**

### C1. Bootstrap becomes admin-key-only (review issue 1, R13)

`users.bootstrapAdmin` changes from a public `action` to an `internalAction`, removed
from `PUBLIC_ENTRY_POINTS`. It is invoked out-of-band:

- Quickstart: `npx convex run users:bootstrapAdmin '{"email":"…","password":"…"}'`
  against the linked dev deployment.
- Docker: the same command with `CONVEX_SELF_HOSTED_URL` and
  `CONVEX_SELF_HOSTED_ADMIN_KEY` exported, exactly as the README's existing auth-setup
  step already does.

`npx convex run` runs public **or internal** functions, because the CLI authenticates
with the deployment admin key — so the credential guarding first-admin creation is now
the deploy key, not a guessable email. Keep the empty-table and `INITIAL_ADMIN_EMAIL`
checks: they are cheap, already tested, and stop an operator from bootstrapping the
wrong account on a deployment that is already in use. They are no longer the security
boundary, and the README must stop implying that they are.

The deny-by-default meta-test needs no new rule: it ignores internal builders, and its
"no stale exceptions" case will fail until `users:bootstrapAdmin` is dropped from the
allow-list — which is the behaviour we want.

### C2. Account creation happens in one transaction (review issues 2 and 3, R13, R11)

Today `bootstrapAdmin` calls `createAccount` and then `promoteBootstrapAdmin` in a
second transaction, and `createUser` writes its audit row in a third. A crash in
between leaves either a stranded viewer that blocks bootstrap forever, or an
unattributed account.

`createAccount()` invoked from an action runs the whole account+user insert, including
the `createOrUpdateUser` callback, inside **one** mutation. So move both decisions into
that callback — `insertViewer` in `backend/lib/provisioning.ts` becomes the place where
the role and the audit row are decided:

- **Bootstrap path** — if the `users` table is empty **and** the email equals
  `INITIAL_ADMIN_EMAIL`, insert the row with role `admin` and write the
  `user.bootstrapAdmin` audit row, all in the same transaction. No marker is passed in
  from the caller and none is trusted: the callback re-derives the condition from the
  database and the environment. A forged profile cannot reach this branch, because the
  branch requires an empty table, and an empty table means no session exists to forge
  with.
- **Admin-provisioned path** — `users.createUser` puts the acting admin's id
  (`ctx.user._id`, resolved server-side by `authedAction`, never a client argument) into
  the server-built profile as `createdBy`. The callback validates it — the referenced
  row must exist and be an active admin — then inserts the row as `viewer` and writes
  the `user.create` audit row with that actor, in the same transaction.
- **Neither** — throw. With public sign-up blocked, a creation that is neither the
  bootstrap nor an admin provisioning is by definition illegitimate, so failing closed
  here makes "invite-only" structural rather than conventional.

`createdBy` becomes an optional `v.id("users")` column on `users` so the profile object
still satisfies `WithoutSystemFields<Doc<"users">>` without a cast, and creation
attribution survives on the row itself as well as in the log.

The follow-up `ctx.runMutation(internal.audit.record, …)` in `createUser` and the
`promoteBootstrapAdmin` call in `bootstrapAdmin` both disappear from the happy path.

### C3. Keep `promoteBootstrapAdmin` as the documented recovery (review issue 2)

Retain the existing `promoteBootstrapAdmin` internal mutation, but repurpose it: it is
no longer part of bootstrap, it is the break-glass for a deployment that somehow holds
a single non-admin user (a half-completed bootstrap from the pre-rev-3 code, or a
restore). It stays admin-key-only, keeps its in-transaction re-verification, and the
README documents it next to bootstrap, together with the simpler dev answer
(`docker compose down -v`, since the table is empty by definition at that point).

### C4. An expired session must end at the sign-in screen (review issue 4, R1/R10)

Not a plan defect, but a plan requirement the builder should hold the fix to: when the
proxy clears stale auth cookies it must still emit a real redirect (3xx) to `/signin`,
not a 200 carrying a `location` header, because browsers do not follow the latter and
the user sees a blank page at exactly the moment R10 says they should be sent back to
sign in. If that means not wrapping the library's `NextResponse.next(response)` on the
invalid-cookie path, do that, and pin `@convex-dev/auth` to the exact version the
behaviour was verified against.

## Architecture

```
                         ┌────────────────────────────────────────────┐
 Browser                 │        Convex backend (self-hosted)        │
   │                     │                                            │
   │ /signin (only       │  http.ts                                   │
   │  unprotected route) │   ├─ auth.addHttpRoutes()  ← sign-in/out   │
   │                     │   └─ POST /ingest/telemetry ← service token│
   ▼                     │                                            │
 Next.js 16 app          │  auth.ts   convexAuth({ Password,          │
   ├─ proxy.ts ──────────┼──▶          callbacks.createOrUpdateUser,  │
   │   convexAuthNextjs  │             session/jwt lifetimes })       │
   │   Middleware        │                                            │
   ├─ layout.tsx         │  lib/permissions.ts  capability → min role │
   │   ConvexAuthNextjs  │  lib/auth.ts         requireCapability()   │
   │   ServerProvider    │  lib/functions.ts    authedQuery/Mutation  │
   └─ pages gated by ────┼──▶ users.me → { role, capabilities[] }     │
       users.me          │                                            │
                         │  every protected fn ── requireCapability ──┼─▶ users.role (DB)
 Gateway / simulator ────┼──▶ POST /ingest/telemetry (Bearer token)   │
   (no user session)     │        └─ internal.ingest.recordBatch      │
                         └────────────────────────────────────────────┘
```

Three layers, each with one job:

1. **Route layer (`frontend/proxy.ts`)** — authenticated vs. not, nothing more. Next.js
   16's own docs say proxy "should not be used as a full session management or
   authorization solution", and it cannot see the role (the role lives in the DB, not
   in the token). It redirects signed-out visitors to `/signin` (R1).
2. **UI layer** — hides/disables controls using the capability list returned by
   `users.me` (R8, R9). Cosmetic only.
3. **Server layer** — the only real enforcement. Every protected function is declared
   through a wrapper that requires an explicit capability; the wrapper resolves the
   caller through `getAuthUserId`, loads the `users` row, and compares ranks (R3, R4, R5).

### Deny-by-default, made testable (R4)

R4's acceptance ("a newly added protected operation with no role rule defined denies
all callers") is not testable against today's shape, where forgetting `requireRole`
silently leaves a function open. Make it structural:

- `backend/lib/functions.ts` exports `authedQuery` / `authedMutation` /
  `authedAction`, each **requiring** a `capability` field. There is no default value —
  omitting it is a type error, and an unknown capability name throws at call time.
- A small allow-list module names the handful of deliberately unauthenticated
  entry points (`users.me`, the bootstrap action, Convex Auth's own generated
  functions, the ingest HTTP route).
- A meta-test scans the source of `backend/**/*.ts` and fails if any exported
  function is registered with the raw `query`/`mutation`/`action` builders while not
  being in that allow-list. That is the test R4 asks for: a new protected operation
  that declares no rule cannot ship.

### Capability map (R5)

`backend/lib/permissions.ts` holds the single mapping, mirroring the spec's
"Users & roles" table; the rank comparison gives inheritance for free:

| Capability | Min role | Spec row |
|---|---|---|
| `data.read` (devices, telemetry, alerts) | viewer | Viewer |
| `alert.acknowledge`, `note.write` | operator | Operator |
| `history.export`, `device.diagnostics` | maintenance | Maintenance |
| `device.manage`, `alertRule.manage`, `user.manage` | admin | Admin |

Capabilities for features that have not shipped (`alert.acknowledge`,
`history.export`) are declared now and become enforceable when those functions land —
exactly what the spec's "Users & roles" preamble describes. `users.me` returns the
resolved capability list so UI gating and server enforcement read from one source.

## Tech decisions

| Decision | Choice (version verified) | Rationale | Rejected |
|---|---|---|---|
| Auth library | `@convex-dev/auth@0.0.95` (current latest on npm; peers `convex ^1.17.0`, `@auth/core ^0.41.1`) | Self-hosted, first-party, Password provider needs no email service. Convex's own docs still label it **beta** — accepted risk, see Risks | Clerk / WorkOS / Auth0 (hosted IdP, contradicts the resolved open question), Better Auth (extra component + adapter), custom OIDC |
| Convex runtime | `convex@1.46.0` (current latest, already installed) | Satisfies the auth peer range and `convex-test@0.0.59`'s `^1.43.0` peer | — |
| Next.js integration | `next@16.3.5` (current latest, already installed) with `convexAuthNextjsMiddleware` exported from **`frontend/proxy.ts`** | Next.js 16 **renamed `middleware.ts` → `proxy.ts`**; `middleware.js` is deprecated. The proxy signature `(request, event)` matches the `NextMiddleware` the Convex helper returns, so it is a file/export rename, not an API change | `middleware.ts` (deprecated in this version), client-only gating (fails R1 on a direct route hit) |
| Providers | `ConvexAuthNextjsServerProvider` in `layout.tsx` + `ConvexAuthNextjsProvider` client wrapper | The server provider is what makes the session readable in the proxy and in server components; today's plain `ConvexAuthProvider` cannot gate routes | Keeping `ConvexAuthProvider` only |
| Sign-up blocking | Password provider's `profile(params)` throws when `params.flow === "signUp"` | `profile` is synchronous and is invoked on every flow, so it is the cheapest deterministic block. Admin provisioning bypasses it because `createAccount()` takes a profile object directly and never calls the provider's `profile` | Async invite check inside `profile` (the callback is typed synchronous — not possible), deleting the sign-up UI only (backend would stay open) |
| Admin provisioning | Admin-gated **action** calling `createAccount({ provider: "password", account: { id: email, secret: tempPassword }, profile })` | `createAccount` is exported from `@convex-dev/auth/server` and requires an action context; the action authorizes via an internal query before creating | Direct `authAccounts` inserts (would have to reimplement scrypt hashing) |
| Identity key | Drop the `users.authId` column and the `by_authId` index; the caller's identity **is** `users._id`, loaded with `ctx.db.get(getAuthUserId(ctx))` | Makes "exactly one role per user" (R2) structural rather than dependent on a unique lookup, and removes today's insert-then-patch placeholder row | Keeping `authId` mirroring the row's own id (redundant, an extra failure mode) |
| Service credential (R12) | `ingest.recordBatch` becomes an **internal** mutation; a new `POST /ingest/telemetry` HTTP action checks `Authorization: Bearer $INGEST_SERVICE_TOKEN` and forwards | Today `recordBatch` is a public mutation any anonymous caller can invoke, and there is no service credential at all — R12 is currently unenforced. Making it internal also makes "a user session cannot be used in its place" true by construction | Checking the token inside the mutation (it would still be publicly callable), per-device certificates (M5 scope) |
| Session lifetimes | `session.inactiveDurationMs` 8 h, `session.totalDurationMs` 7 d, `jwt.durationMs` default 1 h, session cookie | See the decision table. Library defaults confirmed in the installed source: 30 d idle, 30 d total, 1 h JWT | 30 d defaults (too long for this exposure), 8 h hard cap only (would sign people out mid-shift) |
| Tests | `vitest@3` + `convex-test@0.0.59` (already wired, `tests/` outside `backend/`) | Existing harness; `t.withIdentity({ subject: "<userId>|<sessionId>" })` already impersonates roles without JWT keys | e2e-only (cannot assert per-role deny cheaply) |

Role changes take effect immediately even though access tokens live an hour: the role
is read from the `users` row on every call and never from a token claim (R3). The same
is true of deactivation.

## Data model

`backend/schema.ts` keeps `...authTables` (which provides `authSessions`,
`authAccounts`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`,
`authRateLimits`) and overrides `users`.

**`users`** (identity + exactly one role)

| Field | Type | Notes |
|---|---|---|
| `email` | string | Account identifier; unique per account. Add index `by_email` for the provisioning duplicate check |
| `name` | string | Display name; defaults to the email local part |
| `role` | `"viewer" \| "operator" \| "maintenance" \| "admin"` | Exactly one, never optional (R2). Written only by the creation callback (always `viewer`) and by `users.setRole` |
| `isActive` | boolean | Deactivated users fail every check identically to an unknown caller (R6). Written by `users.setActive` (admin-only, audited — rev 3) |
| `createdBy` | optional `v.id("users")` | **Rev 3.** The admin who provisioned the account, validated inside the creation transaction; absent for the bootstrap admin. Lets the profile passed to `createAccount` carry the actor without a cast, and keeps creation attribution on the row as well as in `auditLog` |
| ~~`authId`~~ | — | **Removed.** Identity is `users._id`; `tests/testUtils.ts` drops the placeholder insert-then-patch |

Indexes: `by_email`, `by_role`.

**`auditLog`** (new — attribution, R11)

| Field | Type | Notes |
|---|---|---|
| `actorId` | `v.id("users")` | Who performed it, from `getAuthUserId` — never from arguments |
| `action` | string | `"user.create"`, `"user.setRole"`, `"user.deactivate"`, `"device.register"`, `"device.deactivate"`, later `"alert.acknowledge"` |
| `targetTable` / `targetId` | optional string | What it acted on |
| `details` | optional `record(string, string)` | E.g. `{ from: "viewer", to: "operator" }` |
| `at` | number | Epoch ms |

Indexes: `by_at`, `by_actor_and_at`, `by_target` (`targetTable`, `targetId`, `at`).
Readable only through an admin-gated query.

**Unchanged:** `devices`, `telemetry`, `alertRules.createdBy`, `alerts.acknowledgedBy`
— they reference `users._id`, which stays the identity. `alerts.acknowledgedBy` +
`acknowledgedAt` remain the attribution carrier for alert acknowledgement when M3
lands, in addition to an `auditLog` row.

**Migration:** dropping `users.authId` is a breaking field removal. The dev/Docker
flow starts from an empty `users` table, so it is safe there. Any environment that
already has users must be reset (`docker compose down -v`) or have the column removed
by hand — call this out in the README rather than writing a migration for a table
that has never held real data.

## What changes against the current implementation

Written before the first build; it describes the delta from the pre-auth codebase.
Everything here is now implemented — for the outstanding work see
"Revision 3: corrections after review round 1" above, which supersedes the bootstrap
and audit-atomicity parts of this section.

**Backend, security-relevant**

- `auth.ts` — add `session`/`jwt` lifetime config; add the `profile` hook that rejects
  the `signUp` flow; keep `createOrUpdateUser` but change it to always write `viewer`
  and to stop auto-admining the first user (that moves to the bootstrap action).
- `users.ts` — `syncUserOnLogin` loses the first-user-is-admin rule and the
  `authId` placeholder; `setRole` writes an `auditLog` row (actor, target, from, to,
  timestamp) and refuses to let an admin demote the last remaining admin (prevents a
  deployment with no admin — a lockout R13 cannot recover from once users exist);
  new `bootstrapAdmin` action (table-empty + `INITIAL_ADMIN_EMAIL`), new admin-gated
  `createUser` action, new admin-gated `auditLog` query.
- `lib/permissions.ts` (new) — capability → min-role map and rank comparison.
- `lib/auth.ts` — `requireRole(ctx, allowedRoles[])` becomes
  `requireCapability(ctx, capability)`; keep the single opaque `NOT_AUTHORIZED` error
  for every denial reason (R6). Existing call sites move from `["admin"]` to a
  capability name.
- `lib/functions.ts` (new) — `authedQuery`/`authedMutation`/`authedAction` wrappers
  that require a capability and hand the resolved user to the handler.
- `ingest.ts` → `internalMutation`; `http.ts` gains the token-checked
  `POST /ingest/telemetry` route (401 with no detail on a bad token).
- `devices.ts`, `telemetry.ts` — re-declared through the wrappers; device writes also
  write `auditLog` rows.

**Frontend**

- `proxy.ts` (new, Next 16 name) — `convexAuthNextjsMiddleware` + `createRouteMatcher`,
  everything protected except `/signin` and the auth API route; matcher excludes
  `_next` and static assets (the spec's Definitions carve-out).
- `layout.tsx` — wrap in `ConvexAuthNextjsServerProvider`; `providers.tsx` swaps to
  `ConvexAuthNextjsProvider`.
- `app/signin/page.tsx` (new) — sign-in only. The sign-up toggle and the
  "first account becomes admin" hint on `app/page.tsx` are removed.
- `app/admin/users/page.tsx` (new) — user list, role selector, create-user form.
  Admin-only; the entry point is hidden for every other role. This is what makes R9's
  "user/role admin" control exist in the current build so its absence for a viewer is
  observable.
- `app/page.tsx` — gate on the capability list from `users.me` rather than
  `role === "admin"` string checks.

**Config & docs**

- New deployment env vars: `INITIAL_ADMIN_EMAIL`, `INGEST_SERVICE_TOKEN` (both set on
  the Convex deployment, not in the app's `.env`), plus the existing
  `JWT_PRIVATE_KEY`/`JWKS`/`SITE_URL`. Simulator gets `CONVEX_SITE_URL` +
  `INGEST_SERVICE_TOKEN` in `docker-compose.yml`.
- `gateway/simulator` posts to the HTTP ingest route and no longer calls
  `devices.register` (admin-only; the README already tells an admin to register the
  demo devices).
- README: replace the "first account ever created becomes admin" section with the
  bootstrap procedure, document the session policy and the no-notification decision,
  and note the `users.authId` reset requirement.

## Requirement coverage

| Req | Addressed by |
|---|---|
| R1 | `proxy.ts` redirects unauthenticated visitors to `/signin`; every protected function is declared through `authedQuery`/`authedMutation`, which resolve the caller server-side and throw before touching data. Sign-in page and static assets are the only carve-outs, matching the spec's "protected data" definition |
| R2 | `users.role` is a required single-value union; the creation callback is the only writer at creation (`viewer`, or `admin` on the self-derived bootstrap path) and `users.setRole` the only writer afterwards. Identity is `users._id`, so one identity cannot map to two role rows |
| R3 | `requireCapability` derives the role from `ctx.db.get(getAuthUserId(ctx))`. No function accepts a role argument; the creation callback discards any role present in the incoming profile, and the one branch that writes `admin` reads its condition from the database and the environment rather than from the profile. A forged client role has nowhere to enter |
| R4 | The wrappers in `lib/functions.ts` require an explicit capability (no default), and the meta-test over `backend/**/*.ts` fails any exported function registered with the raw builders outside the named allow-list |
| R5 | `lib/permissions.ts` capability → min-role map mirroring the spec table, evaluated by rank comparison so higher roles inherit. Per-role allow/deny tests exercise one permitted and one forbidden capability for each of the four roles |
| R6 | One exported `NOT_AUTHORIZED` error for unauthenticated, wrong-role and deactivated callers alike; authorization runs **before** any existence check, so a forbidden existing target and a non-existent one are indistinguishable. Existing non-leakage test extended to cover a forbidden-existing vs. non-existent target |
| R7 | `users.list`, `users.setRole`, `users.createUser` and the audit-log query all require the `user.manage` capability (admin rank). Non-admin callers get the generic denial |
| R8 | `users.me` returns `{ _id, name, email, role, capabilities[] }` for the caller only, and never throws (returns `null` when signed out). It is advisory — every protected call independently re-resolves the role |
| R9 | The dashboard and the admin nav render from `me.capabilities`, not from a duplicated client-side table. Controls in the current build: register device, deactivate device, user/role admin (and alert acknowledge when M3 lands). For a viewer session each is absent; for a permitted role each is present and usable |
| R10 | Convex Auth session + refresh tokens with the stated policy: 1 h access token, 8 h idle timeout, 7 d hard cap, session cookie. Reload keeps the session (the proxy refreshes the token); sign-out clears it and protected data becomes inaccessible again. The documented policy is what makes "until expiry" testable |
| R11 | `auditLog` row written inside the same mutation as every state change, with `actorId` resolved server-side and `at` from the server clock. Verified now on `users.setRole` (who changed whom, from → to, when) and on device register/deactivate; `alerts.acknowledgedBy`/`acknowledgedAt` plus an `alert.acknowledge` row cover the ack when it ships. **Rev 3 (C2):** account creation is no longer an exception — `user.create` and `user.bootstrapAdmin` rows are written in the creation callback, inside the same transaction as the insert, so no account can exist unattributed |
| R12 | `ingest.recordBatch` becomes internal; the only entry point is `POST /ingest/telemetry` guarded by `INGEST_SERVICE_TOKEN`. A user session carries no such token and the mutation is no longer publicly callable, so a user session cannot substitute for the service credential |
| R13 | `users.bootstrapAdmin` is an **internalAction reachable only with the deployment admin key** (`npx convex run`, rev 3 / C1), and additionally requires an empty `users` table and a match on `INITIAL_ADMIN_EMAIL`. The admin role and its audit row are written inside the creation transaction, so the procedure either completes or leaves nothing behind (C2). `promoteBootstrapAdmin` remains as the documented recovery for a half-created state (C3). `setRole` and `setActive` both refuse to remove the last admin, and `users:setPassword` (admin key, audited) is the break-glass for a forgotten admin password. Documented in the README for both the Quickstart and Docker flows |
| *(unnumbered)* default role | New accounts are always created as `viewer` by the creation callback — including admin-provisioned ones, which are promoted afterwards through the audited `setRole` path |

## Risks & unknowns

- **Convex Auth is beta.** Convex's own docs say it "isn't complete and may change in
  backward-incompatible ways" and steer new projects toward hosted providers. The
  resolved spec forbids a hosted IdP, so this is the accepted cost. *Mitigation:* pin
  `@convex-dev/auth` to an exact version, keep all of it behind `lib/auth.ts` +
  `lib/functions.ts` so a future swap touches those files and `auth.ts` only.
- **Self-hosted key setup.** `JWT_PRIVATE_KEY` (PKCS#8), `JWKS` and `SITE_URL` must
  live on the deployment, not in a `.env` file. The setup CLI shells out to
  `npx convex env set` and accepts `--url` / `--admin-key`, so it does work against a
  self-hosted backend, but it is interactive. *Mitigation:* document the non-interactive
  fallback (generate the key pair with `jose`, set the three vars with
  `npx convex env set` using `CONVEX_SELF_HOSTED_URL` / `CONVEX_SELF_HOSTED_ADMIN_KEY`);
  verify a fresh `docker compose down -v && docker compose up` reaches a working
  sign-in before calling R13 done.
- **Next.js 16 API drift.** `frontend/AGENTS.md` warns the local Next.js differs from
  training data, and the `middleware.ts` → `proxy.ts` rename is exactly that. Convex
  Auth's published guide still says `middleware.ts`. *Mitigation:* the builder reads
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
  before writing the file; treat the Convex guide as correct about the helper and the
  local docs as correct about the file convention.
- **HTTP actions are on the site URL, not the cloud URL.** Self-hosted that is port
  3211 (`CONVEX_SITE_ORIGIN`), while the simulator currently talks to 3210. Getting
  this wrong makes ingest look broken. *Mitigation:* pass `CONVEX_SITE_URL` explicitly
  to the simulator service in `docker-compose.yml` and assert a 401 vs 200 by hand once.
- **Schema change on a seeded environment.** Removing `users.authId` breaks any
  deployment that already has user rows. *Mitigation:* README note + the volume reset
  command; re-confirm the table is empty before pushing.
- **`convex-test` cannot exercise the real sign-in flow** (no JWT signing keys in the
  mock environment), so sign-up blocking, bootstrap and the HTTP ingest route are
  tested at the function level, and the end-to-end sign-in/reload/sign-out path (R10)
  stays a documented manual smoke check. *Mitigation:* keep that smoke check explicit
  in the review, not implied.
- **Password recovery has no user-facing channel.** With no email infra, a forgotten
  password is fixed only by the admin-key break-glass `users:setPassword`
  (`modifyAccountCredentials`, audited, no UI). Not required by any Rn. *Mitigation:*
  the README must say exactly this — review issue 5 found it currently claims an
  admin can "re-provision the account", which `users.createUser` rejects for an
  existing email.
- **Bootstrap now needs the admin key (rev 3).** That is the point, but it makes the
  first-admin step harder to automate in a fully unattended deployment. *Mitigation:*
  the Docker flow already writes the admin key to a shared volume, so the README can
  give a copy-pasteable one-liner; an operator who wants full automation can add a
  compose one-shot service that runs it, which keeps the credential inside the
  deployment rather than on the public network.
- **Stale-cookie redirect (review issue 4).** Unresolved until checked in a browser
  against a live backend: the proxy's cookie-clearing path may answer 200 + `location`
  instead of a 3xx. *Mitigation:* C4 above; verify with a real expired session, not
  only with forged cookie values.
- **Unknowns for the builder to confirm at the keyboard:** that a `profile` hook
  throwing on `flow === "signUp"` surfaces as a clean client error rather than a 500;
  that `createAccount` invoked from an admin action routes through our
  `createOrUpdateUser` callback (it should — it is the single creation choke point);
  and that the wrapper-built functions still register cleanly with the Convex bundler.

## Sources

Fetched 2026-09-19 unless noted.

- `@convex-dev/auth` latest version + peers — https://registry.npmjs.org/@convex-dev/auth/latest (0.0.95; peers `convex ^1.17.0`, `@auth/core ^0.41.1`)
- `convex` latest version — https://registry.npmjs.org/convex/latest (1.46.0)
- `next` latest version — https://registry.npmjs.org/next/latest (16.3.5)
- `convex-test` latest version + peer — https://registry.npmjs.org/convex-test/latest (0.0.59; peer `convex ^1.43.0`)
- Convex auth guidance / beta status — https://docs.convex.dev/auth
- Convex Auth docs — https://labs.convex.dev/auth · Next.js integration — https://labs.convex.dev/auth/authz/nextjs · Manual setup (JWT_PRIVATE_KEY, JWKS, SITE_URL) — https://labs.convex.dev/auth/setup/manual
- Convex Auth RBAC example — https://github.com/get-convex/convex-auth-with-role-based-permissions
- `npx convex run` runs "a public **or internal** Convex query, mutation, or action" (the basis for the rev-3 admin-key bootstrap) — https://docs.convex.dev/cli
- Session/JWT defaults, read from the installed package source: `node_modules/@convex-dev/auth/src/server/types.ts`, `.../implementation/sessions.ts` (30 d total), `.../implementation/refreshTokens.ts` (30 d inactive), `.../implementation/tokens.ts` (1 h JWT)
- `createAccount` / `modifyAccountCredentials` / `invalidateSessions` signatures — `node_modules/@convex-dev/auth/src/server/implementation/index.ts`
- Password provider `profile` / `validatePasswordRequirements` contract — `node_modules/@convex-dev/auth/dist/providers/Password.d.ts`
- Next.js 16 Proxy (middleware rename, signature, matcher) — `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`, and the deprecation note in `.../file-conventions/middleware.md`

---

**Summary (rev 3).** The architecture stands — capability map, wrapper-declared
functions, service-token ingest, audit log — and review round 1 confirmed all thirteen
requirements are implemented. The correction is that first-admin creation was gated on
an email address rather than a credential, and that account creation was spread over
three transactions; both are fixed by moving the role decision and the audit write
into the single `createOrUpdateUser` transaction and putting bootstrap behind the
deployment admin key.

**Still awaiting the user's confirmation** (carried over from rev 2, review issue 11):
(1) the session policy — 8 h idle, 7 d hard cap, session cookie that ends on browser
close; (2) no role-change notification in v1; (3) that removing `users.authId` was
acceptable. All three are already implemented, so these are ratifications, not blockers.
