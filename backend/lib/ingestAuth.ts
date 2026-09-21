// Ingestion credential parsing + authentication (telemetry-ingestion R2, R3,
// R5, R6, R7). Pure functions, no `ctx`/`process.env` access baked in, so
// they're unit-testable with `node --test` and reusable from the httpAction.
//
// Credential model (plan.md "Credential model: several credentials, one env
// var"): `INGEST_TOKENS` is a comma-separated list of `<sourceId>.<secret>`
// tokens. Two tokens sharing a `sourceId` is a rotation overlap window (R6);
// different `sourceId`s are separate ingestion sources with separate
// rate-limit allowances (R23).
//
// The *whole* presented bearer token (not just the secret half) is compared
// byte-for-byte against each configured token in constant time, with no
// early exit across the list and no branching on a client-supplied
// `sourceId` prefix — the client never tells us which source it claims to
// be; we derive `sourceId` only from whichever configured entry matched.
// That is what makes R7's "reveals nothing" true of both the response body
// and the comparison's timing.

export interface IngestTokenEntry {
  sourceId: string;
  token: string; // full "sourceId.secret" string, compared verbatim
}

/** A fixed-shape placeholder compared when zero tokens are configured, so an
 * empty/unset `INGEST_TOKENS` takes the same code path as a real check. */
const DUMMY_TOKEN = "unconfigured-source.unconfigured-secret-placeholder";

/** Parses `INGEST_TOKENS` into `{sourceId, token}` entries. Malformed entries
 * (no `.`, or an empty sourceId/secret half) are dropped — they can never
 * usefully match a presented credential, and silently ignoring them (rather
 * than crashing) means a trailing comma or stray space doesn't take down
 * ingestion for every other configured source. */
export function parseIngestTokens(raw: string | undefined): IngestTokenEntry[] {
  if (!raw) return [];
  const entries: IngestTokenEntry[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) continue; // no '.', or empty half
    const sourceId = token.slice(0, dot);
    entries.push({ sourceId, token });
  }
  return entries;
}

/** Extracts the bearer credential from an `Authorization` header value.
 * Returns `""` when there is no header, no `Bearer` scheme, or no token —
 * never `null` — so a missing/malformed header still yields a (non-matching)
 * string and the comparison below runs the same code path either way. */
export function extractBearerToken(authorizationHeader: string | null | undefined): string {
  if (!authorizationHeader) return "";
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1].trim() : "";
}

/** Constant-time equality over UTF-8 bytes. Always compares
 * `max(a.length, b.length)` byte-pairs — it never returns early on the first
 * mismatch — so its running time depends only on the lengths involved, not
 * on *where* two unequal strings first differ. `onCompare` is an optional
 * test hook invoked once per byte-pair compared. */
export function constantTimeEqual(a: string, b: string, onCompare?: () => void): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    const x = i < aBytes.length ? aBytes[i] : 0;
    const y = i < bBytes.length ? bBytes[i] : 0;
    diff |= x ^ y;
    onCompare?.();
  }
  return diff === 0;
}

export interface IngestAuthResult {
  sourceId: string;
}

/** Authenticates one ingestion request. Returns `{sourceId}` for a matching
 * credential, or `null` for a missing, malformed, or non-matching one — the
 * caller (the httpAction) is responsible for turning `null` into the uniform
 * 401 response (R2, R7). Loops over *every* configured entry with no early
 * exit, and always performs at least one comparison (against a dummy value
 * when no tokens are configured at all), so a deployment with no credential
 * configured refuses everything (R5) without a timing or code-path tell. */
export function authenticateIngestRequest(
  authorizationHeader: string | null | undefined,
  tokensEnv: string | undefined,
): IngestAuthResult | null {
  const presented = extractBearerToken(authorizationHeader);
  const entries = parseIngestTokens(tokensEnv);

  let matchedSourceId: string | null = null;
  for (const entry of entries) {
    if (constantTimeEqual(presented, entry.token)) {
      matchedSourceId = entry.sourceId;
    }
  }
  if (entries.length === 0) {
    constantTimeEqual(presented, DUMMY_TOKEN);
  }

  return matchedSourceId === null ? null : { sourceId: matchedSourceId };
}
