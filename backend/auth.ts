import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { createUserRecord, passwordProfile } from "./lib/provisioning";

// Session policy (documented in the README, spec R10):
//   - access token (JWT): 1 hour, the library default
//   - idle timeout:       8 hours (about one shift)
//   - hard cap:           7 days, then re-authentication is required
// The browser cookie is a session cookie (see `frontend/proxy.ts`).
const HOUR_MS = 60 * 60 * 1000;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  // No public sign-up: `passwordProfile` rejects every flow but "signIn".
  providers: [Password({ profile: passwordProfile })],
  session: {
    inactiveDurationMs: 8 * HOUR_MS,
    totalDurationMs: 7 * 24 * HOUR_MS,
  },
  callbacks: {
    // The single choke point for creating a `users` row (sign-in never
    // creates one; `createAccount` from the admin/bootstrap actions does, and
    // runs this callback in the same transaction as the account insert). The
    // role and the audit row are decided inside `createUserRecord`.
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId !== null) {
        return args.existingUserId;
      }
      return createUserRecord(ctx, args.profile);
    },
  },
});
