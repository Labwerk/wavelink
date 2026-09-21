import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Works around @convex-dev/auth@0.0.95 in `convexAuthNextjsMiddleware`: when it
 * has to set or clear auth cookies (an expired/invalid session) it wraps the
 * handler's result in `NextResponse.next(response)`. For a redirect result that
 * yields HTTP 200 with a `location` header, which browsers do not follow - the
 * user would see a blank page at exactly the moment they should be sent back
 * to sign in (spec R1/R10).
 *
 * This restores a real 3xx redirect and carries every `Set-Cookie` (the
 * cleared cookies) across. Any other response passes through untouched.
 */
export function normalizeRedirect<T>(request: NextRequest, result: T): T | NextResponse {
  if (!(result instanceof Response)) return result;
  const location = result.headers.get("location");
  if (result.status !== 200 || location === null) return result;

  const redirect = NextResponse.redirect(new URL(location, request.url));
  for (const cookie of result.headers.getSetCookie()) {
    redirect.headers.append("set-cookie", cookie);
  }
  return redirect;
}
