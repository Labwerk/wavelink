// Service credential for the ingestion/gateway path (spec R12): a shared
// secret in the INGEST_SERVICE_TOKEN deployment env var, sent as
// `Authorization: Bearer <token>`. Deliberately independent of user sessions
// and of the four user roles.

/** Constant-time string comparison (avoids leaking a prefix match by timing). */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/**
 * True only when a token is configured AND the header carries exactly it.
 * Fails closed: an unset/blank INGEST_SERVICE_TOKEN rejects everything.
 */
export function isValidServiceToken(
  authorizationHeader: string | null,
  expectedToken: string | undefined,
): boolean {
  if (expectedToken === undefined || expectedToken.trim() === "") {
    return false;
  }
  if (authorizationHeader === null) {
    return false;
  }
  const match = /^Bearer (.+)$/.exec(authorizationHeader);
  if (match === null) {
    return false;
  }
  return safeEqual(match[1], expectedToken);
}
