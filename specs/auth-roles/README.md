# Auth & roles

Sign-in and role-based access control (RBAC) for Wavelink. Every user signs in, has
exactly one role, and the **server** enforces that role on every protected call. The UI
only hides controls; it is never the security boundary.

- Spec (what/why): [`spec.md`](spec.md) · Plan (how): [`plan.md`](plan.md)
- Review: [`review.md`](review.md) · Manual test list: [`smoke-checklist.md`](smoke-checklist.md)

## Quick start

Already have the app running? Four commands take you from a blank deployment to a working
admin login:

```sh
npx @convex-dev/auth --web-server-url http://localhost:3000            # signing keys (interactive)
npx convex env set INITIAL_ADMIN_EMAIL you@example.com                 # who may become first admin
npx convex run users:bootstrapAdmin '{"email":"you@example.com","password":"choose-8+-chars"}'
# then open http://localhost:3000 and sign in
```

Full walkthrough, including Windows/PowerShell quoting and Docker, is in
[Setup, step by step](#setup-step-by-step).

## How it works

| Piece | Where | What it does |
|---|---|---|
| Sign-in | `backend/auth.ts` | Convex Auth, email + password. **No public sign-up**; accounts are created by an admin. |
| Roles & capabilities | `backend/lib/permissions.ts` | Single source of truth: role → capability map. |
| Deny-by-default wrappers | `backend/lib/functions.ts` | `authedQuery` / `authedMutation` / `authedAction` **require** a `capability`, look up the caller's stored role, and refuse otherwise. |
| User management | `backend/users.ts` | `me`, `list`, `setRole`, `setActive`, `createUser` (+ CLI-only bootstrap/recovery). |
| Audit trail | `backend/audit.ts`, `auditLog` table | Who did what to whom, and when, for every state change. |
| Route guard | `frontend/proxy.ts` | Redirects signed-out visitors to `/signin`. Not an authorization layer. |
| Admin UI | `frontend/app/admin/users/page.tsx` | Create users, change roles, deactivate accounts, view recent changes. |
| Ingestion credential | `backend/http.ts`, `backend/lib/serviceAuth.ts` | The gateway/simulator uses `INGEST_SERVICE_TOKEN`, not a user session. |

### Roles

Each role includes everything the roles above it in this table can do.

| Role | Capabilities |
|---|---|
| `viewer` | `data.read`: view dashboards and history |
| `operator` | + `alert.acknowledge`, `note.write` |
| `maintenance` | + `history.export`, `device.diagnostics` |
| `admin` | + `device.manage`, `alertRule.manage`, `user.manage` (users, roles, audit log) |

Only `data.read`, `device.manage` and `user.manage` are enforced by shipped functions
today. The others are declared and become enforceable when their features land.

### Rules worth knowing

- New accounts are always created as **viewer**; an admin promotes them afterwards.
- The role is read from the database on every call. A client cannot send or forge one.
- A forbidden request and a request for something that does not exist look identical.
- You cannot demote or deactivate the **last active admin**, nor deactivate yourself.
- A deactivated user behaves exactly like a signed-out user on their next call.
- Sessions: 8 h idle timeout, 7 day hard cap; the browser cookie is a session cookie, so
  closing the browser signs out. Configured in `backend/auth.ts`.

## Setup, step by step

**Prerequisites:** Node.js 20+, and the app installed (`npm install` at the repo root).
See the root [README](../../README.md#quickstart) for Docker and Convex Cloud details.

### 1. Start the backend and frontend

```sh
npm run dev
```

Leave it running. `frontend/.env.local` must have `NEXT_PUBLIC_CONVEX_URL` set to the URL
that `convex dev` prints. Copy [`frontend/.env.local.example`](../../frontend/.env.local.example)
if it does not exist. The example value (`http://127.0.0.1:3210`) is the **Docker**
port; for a native `convex dev` deployment use the URL it reports instead.

### 2. Generate the signing keys (once per deployment)

In a second terminal:

```sh
npx @convex-dev/auth --web-server-url http://localhost:3000
```

This is interactive. It stores `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` **on the Convex
deployment**, not in a file, so there is nothing to commit.

### 3. Choose the first admin's email

```sh
npx convex env set INITIAL_ADMIN_EMAIL you@example.com
```

### 4. (Optional) set the ingestion token

Only needed if you run the simulator or a gateway.

```sh
# bash / Git Bash / WSL
npx convex env set INGEST_SERVICE_TOKEN "$(openssl rand -hex 32)"
```

```powershell
# PowerShell (no openssl needed)
$t = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
npx convex env set INGEST_SERVICE_TOKEN $t
```

### 5. Create the first admin

Accounts are invite-only, so a fresh deployment needs one created from the CLI. This
command is internal: it is not callable from the browser and is protected by the
deployment admin key.

```sh
npx convex run users:bootstrapAdmin '{"email":"you@example.com","password":"choose-8+-chars"}'
```

The email must match `INITIAL_ADMIN_EMAIL`, the password needs 8+ characters, and it
only works while **no users exist**. It is atomic: it either creates the admin and its
audit row, or nothing.

PowerShell may mangle the inner quotes. If you get a JSON error, use:

```powershell
npx convex run users:bootstrapAdmin "{\`"email\`":\`"you@example.com\`",\`"password\`":\`"choose-8+-chars\`"}"
```

**Docker (self-hosted) only:** export the admin key first, in Git Bash or WSL, then run
steps 3 and 5:

```sh
export CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY=$(docker compose exec backend cat /convex/data/admin_key.txt)
```

### 6. Sign in and invite people

1. Open [http://localhost:3000](http://localhost:3000) and sign in with the admin account.
2. Go to **Manage users**.
3. Fill in the **Create user** form (email, optional name, temporary password of 8+
   characters). Give the temporary password to the person out-of-band; there is no email.
4. The new account appears as `viewer`. Pick a role in its selector to promote it.
5. **Recent changes** on the same page shows the audit trail.

### 7. Verify it works

```sh
npm test
```

Covers permissions, deny-by-default, user management, provisioning, the route guard and
ingestion auth. For the parts a unit test cannot reach (real sign-in, session persistence,
live role changes in the UI), run through [`smoke-checklist.md`](smoke-checklist.md).

## Everyday tasks

| I want to… | Do this |
|---|---|
| Add a user | Manage users → Create user |
| Change a role | Manage users → role selector on that row |
| Lock someone out | Manage users → **Deactivate** (reversible) |
| Reset a forgotten password | `npx convex run users:setPassword '{"email":"x@y.com","newPassword":"8+ chars"}'`, which also signs that user out everywhere |
| Recover a deployment with one non-admin user | `npx convex run users:promoteBootstrapAdmin '{"userId":"<users _id>"}'` |
| Start over (dev only) | Docker: `docker compose down -v`, then repeat from step 2. Cloud dev: clear the `users` / `auth*` tables in the Convex dashboard. |

The last two are break-glass operations. They require the deployment admin key, have no
UI, and are audited without an acting user.

## For developers

### Protecting a new backend function

Use the wrapper for the capability the caller must hold. Omitting `capability` is a type
error.

```ts
import { authedMutation } from "./lib/functions";

export const clearAlert = authedMutation({
  capability: "alert.acknowledge",
  args: { alertId: v.id("alerts") },
  handler: async (ctx, { alertId }) => {
    // ctx.user is the server-resolved caller; ctx.user.role is trustworthy.
    // Record who did it in the same transaction:
    // await recordAudit(ctx, { actorId: ctx.user._id, action: "alert.clear", ... });
  },
});
```

- Use `authedQuery` / `authedMutation` / `authedAction`, never the raw `query` /
  `mutation` / `action`, for anything touching protected data. The only exceptions are
  the entry points listed in `backend/lib/publicEntryPoints.ts` (currently `users.me`);
  `tests/denyByDefault.test.ts` fails otherwise.
- Adding a capability: add it to `CAPABILITY_MIN_ROLE` in `backend/lib/permissions.ts`.
  An unknown capability name denies everyone.
- State changes must call `recordAudit` in the same mutation (requirement R11).

### Gating UI

`useQuery(api.users.me)` returns `{ role, capabilities, ... }` or `null` when signed out.
Check `capabilities.includes("device.manage")` to show or hide a control. This is
cosmetic only; the server re-checks.

### Environment variables (on the Convex deployment)

| Variable | Purpose |
|---|---|
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` | Set by `npx @convex-dev/auth`. Token signing and the site URL. |
| `INITIAL_ADMIN_EMAIL` | The one email allowed to bootstrap the first admin. |
| `INGEST_SERVICE_TOKEN` | Bearer token the gateway/simulator sends to `POST /ingest/telemetry`. Unset means all ingestion is rejected. |

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:3210` in the frontend | `NEXT_PUBLIC_CONVEX_URL` points at the Docker port but nothing is listening. Set it to the URL `convex dev` prints, or run `docker compose up`. |
| `bootstrapAdmin` fails with a "not authorized" style error | `INITIAL_ADMIN_EMAIL` unset or different from the email you passed, or a user already exists. |
| `bootstrapAdmin` JSON parse error (PowerShell) | Use the escaped-quote form in step 5. |
| Sign-in fails or loops back to `/signin` | Most often the auth keys were never set on this deployment. Re-run step 2 and check `npx convex env list` shows `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL`. |
| "Sign-up is disabled" | Expected. Ask an admin to create your account. |
| Telemetry from the simulator is dropped | Wrong URL (must be the **site** URL, port 3211 / `.convex.site`, not the API URL), token mismatch, or the device is not registered yet (admins register devices in the UI). |
| Signed-in user suddenly sees nothing | Their account was deactivated, or the session hit the 8 h idle / 7 day cap. |
