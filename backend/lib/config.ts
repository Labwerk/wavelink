// Deployment-level configuration for the device registry, read from Convex
// environment variables with documented defaults (spec R4, R11, R22).
// Values are re-read on every call (not cached at module load) so tests can
// flip `process.env` between cases and so a real deployment can change them
// via `npx convex env set` / the dashboard without a redeploy.
//
// Exception: the 15s sweep interval lives in `backend/crons.ts` as a code
// constant, not here — `crons.ts` is evaluated at push time, so an env-driven
// interval would not take effect without a redeploy anyway (see plan.md).

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** R2/R4: staleness threshold past which a device reads `offline`. Default 60s. */
export function heartbeatWindowMs(): number {
  return numberEnv("DEVICE_HEARTBEAT_WINDOW_MS", 60_000);
}

/** R22: metadata bounds, enforced on the server (not truncation — a validation failure). */
export function metadataMaxEntries(): number {
  return numberEnv("DEVICE_METADATA_MAX_ENTRIES", 20);
}

export function metadataMaxKeyLength(): number {
  return numberEnv("DEVICE_METADATA_MAX_KEY_LENGTH", 64);
}

export function metadataMaxValueLength(): number {
  return numberEnv("DEVICE_METADATA_MAX_VALUE_LENGTH", 256);
}

/** R11: default device list page size. */
export function deviceListPageSize(): number {
  return numberEnv("DEVICE_LIST_PAGE_SIZE", 50);
}
