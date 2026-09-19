// The complete list of exported Convex functions registered with the RAW
// `query`/`mutation`/`action` builders instead of `authedQuery` /
// `authedMutation` / `authedAction`. Each entry is `<module>:<export>`.
//
// Adding to this list is a deliberate security decision (spec R4):
//   - users:me   never throws; returns only the caller's own profile, or null
//                (R8).
// Convex Auth's own functions (auth.ts) and the ingest HTTP route (http.ts,
// service-token guarded, R12) are not registered with these builders. The
// first-admin bootstrap, password reset and recovery (users.ts) are
// INTERNAL functions reachable only with the deployment admin key, so they
// are not public entry points and do not appear here.
export const PUBLIC_ENTRY_POINTS: readonly string[] = ["users:me"];
