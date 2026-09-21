// Next.js 16 renamed `middleware.ts` to `proxy.ts` (see
// node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
//
// Route layer only (spec R1): signed-out visitors are redirected to /signin;
// nothing else is decided here. The proxy cannot see the user's role (it
// lives in the database, not the token) and Next.js documents that proxy is
// not an authorization solution - every Convex query/mutation/action still
// enforces the caller's role server-side.
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { normalizeRedirect } from "./lib/normalizeRedirect";

const isSignInPage = createRouteMatcher(["/signin"]);

const authMiddleware = convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const authenticated = await convexAuth.isAuthenticated();
    if (!isSignInPage(request) && !authenticated) {
      return nextjsMiddlewareRedirect(request, "/signin");
    }
    if (isSignInPage(request) && authenticated) {
      return nextjsMiddlewareRedirect(request, "/");
    }
  },
  // Session cookie: closing the browser signs out. Page reloads keep the
  // session (R10). Server-side lifetimes are set in backend/auth.ts.
  { cookieConfig: { maxAge: null } },
);

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // An expired/invalid session makes the library clear cookies AND wrap our
  // redirect into a 200; restore a real redirect (see normalizeRedirect).
  return normalizeRedirect(request, await authMiddleware(request, event));
}

export const config = {
  // Everything except static assets and Next.js internals; the auth API
  // route (/api/auth) is included so sign-in/out can be proxied to Convex.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
