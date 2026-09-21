# Smoke checklist: auth-roles (manual, run by a human)

> **Status: NOT RUN.** This checklist was written by the builder, who cannot
> drive a browser or run a live deployment. Nothing below has been verified;
> record results in the "Result" column when you run it. It covers what
> `convex-test` cannot: real sign-in, session persistence, the proxy, UI gating
> (R9) and the end-to-end paths (R10, R12, R13).

**Setup.** Fresh deployment (Quickstart or `docker compose down -v && docker
compose up`), `npx @convex-dev/auth` done, then:

```sh
npx convex env set INITIAL_ADMIN_EMAIL admin@example.com
npx convex env set INGEST_SERVICE_TOKEN "$(openssl rand -hex 32)"
npx convex run users:bootstrapAdmin '{"email":"admin@example.com","password":"correct-horse-1"}'
```

(Docker: export `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY`
first.) Open http://localhost:3000. Use a normal browser window plus a private
window as the second user.

| # | Req | Step | Expected | Result |
|---|---|---|---|---|
| 1 | R13 | Run the bootstrap above on the empty deployment | Command succeeds. Running it a second time fails | |
| 2 | R13 | Run bootstrap with a different email on another empty deployment (or after `down -v`) | Refused; no user/account rows created | |
| 3 | R1 | Signed out, open `/` and `/admin/users` | Redirected to `/signin`; no device data visible | |
| 4 | R10 | Sign in as `admin@example.com` | Dashboard loads; header shows email and `(admin)` | |
| 5 | R10 | Reload the page (F5) | Still signed in, no flash of the sign-in page | |
| 6 | R10 | Open a new tab to `/` | Still signed in | |
| 7 | R10 | Sign out, then press Back / open `/` | Lands on `/signin`; no data | |
| 8 | invite-only | On `/signin`, look for any "Sign up" option | None. Posting `flow=signUp` to the auth action (browser devtools) is refused | |
| 9 | R9 | As admin, check the dashboard | "Register device" form, "Deactivate" on a device, and a "Manage users" link are all visible | |
| 10 | R7 | Open **Manage users** | User list, role selectors, Create user form, Recent changes list | |
| 11 | provisioning | Create user `viewer1@example.com` with a temporary password | Appears in the list as `viewer`; "Recent changes" shows a `user.create` row naming the admin | |
| 12 | provisioning | Create the same email again | Rejected with "already exists" | |
| 13 | R9 | Private window: sign in as `viewer1@example.com` | Dashboard shows devices, but **no** Register form, **no** Deactivate button, **no** "Manage users" link | |
| 14 | R7, R6 | As viewer, visit `/admin/users` directly | "Not available"; no user data | |
| 15 | R8 | Admin promotes `viewer1` to `operator` in Manage users | Viewer's header badge changes to `operator` within about a second **without reload**; still no admin controls | |
| 16 | R11 | Admin: Manage users, "Recent changes" | A `user.setRole` row: admin, target `viewer1`, `from: viewer, to: operator`, time | |
| 17 | R9 | Admin promotes `viewer1` to `admin` | Viewer window gains the admin controls live | |
| 18 | last admin | Admin demotes themself while being the only active admin | Refused ("Cannot remove the last admin") | |
| 19 | deactivate | Admin deactivates `viewer1` | Viewer window immediately shows "Your session is no longer valid" / loses data; the admin's row shows "Deactivated" | |
| 20 | deactivate | Admin tries to deactivate their own row | No button on own row; server also refuses | |
| 21 | R1/R10 | Expired/invalid session: in devtools, corrupt the `__convexAuthJWT` and `__convexAuthRefreshToken` cookies, then reload `/` | A real redirect to `/signin` (not a blank page); cookies cleared. Then sign in works | |
| 22 | R10 | Session policy: leave a signed-in tab idle past 8 h (or lower `inactiveDurationMs` in `backend/auth.ts` temporarily) | Next action returns to sign-in. Closing the browser entirely also signs out (session cookie) | |
| 23 | R12 | Register `sim-cnc-01` in the dashboard, then start the simulator with `CONVEX_SITE_URL` (port 3211 / `.convex.site`) and `INGEST_SERVICE_TOKEN` | Live readings appear; no user session involved | |
| 24 | R12 | `curl -i -X POST $CONVEX_SITE_URL/ingest/telemetry` with no / wrong token | `401`, empty body | |
| 25 | R12 | Call the same URL with a signed-in user's JWT as the Bearer token | `401` | |
| 26 | recovery | `npx convex run users:setPassword '{"email":"viewer1@example.com","newPassword":"another-pass-2"}'` | Old password stops working, new one works, existing sessions ended; audit row has no actor and `via: deployment-admin-key` | |
| 27 | R11 | Register / deactivate a device as admin | Each writes an audit row (`device.register`, `device.deactivate`) naming the admin | |

**Not covered here** (needs alerting, which has not shipped): operator
acknowledging an alert and the record showing who did it.
