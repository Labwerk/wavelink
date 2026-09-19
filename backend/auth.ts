import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { syncUserOnLogin } from "./users";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
  callbacks: {
    // Owns user-row creation/sync end to end (bootstrap rule + defaults),
    // per spec `specs/auth-roles/spec.md` §5/§6 — see `syncUserOnLogin`.
    async createOrUpdateUser(ctx, args) {
      return syncUserOnLogin(ctx, args);
    },
  },
});
