import { NextRequest, NextResponse } from "next/server";
import { describe, expect, test } from "vitest";
import { normalizeRedirect } from "../frontend/lib/normalizeRedirect";

const request = new NextRequest("http://localhost:3000/admin/users");

// Reproduces what @convex-dev/auth@0.0.95 returns when it clears stale
// cookies: `NextResponse.next(<redirect response>)`, i.e. 200 + location.
function libraryWrapped() {
  const redirect = NextResponse.redirect(new URL("/signin", request.url));
  const wrapped = NextResponse.next(redirect);
  wrapped.headers.append("set-cookie", "__convexAuthJWT=; Path=/; Max-Age=0; HttpOnly");
  wrapped.headers.append("set-cookie", "__convexAuthRefreshToken=; Path=/; Max-Age=0; HttpOnly");
  return wrapped;
}

describe("normalizeRedirect (R1/R10: expired session ends at /signin)", () => {
  test("the library's wrapped redirect really is a 200 with a location header", () => {
    const wrapped = libraryWrapped();
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get("location")).toContain("/signin");
  });

  test("is turned back into a real 3xx redirect and keeps the cleared cookies", () => {
    const fixed = normalizeRedirect(request, libraryWrapped()) as Response;
    expect(fixed.status).toBeGreaterThanOrEqual(300);
    expect(fixed.status).toBeLessThan(400);
    expect(new URL(fixed.headers.get("location")!, request.url).pathname).toBe("/signin");
    const cookies = fixed.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  test("real redirects and ordinary responses pass through untouched", () => {
    const redirect = NextResponse.redirect(new URL("/signin", request.url));
    expect(normalizeRedirect(request, redirect)).toBe(redirect);
    const next = NextResponse.next();
    expect(normalizeRedirect(request, next)).toBe(next);
    expect(normalizeRedirect(request, undefined)).toBeUndefined();
    expect(normalizeRedirect(request, null)).toBeNull();
  });
});
