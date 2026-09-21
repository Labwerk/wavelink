// Deployment-configurable ingestion limits (telemetry-ingestion R24). Every
// value is read from `process.env` with a documented default — see
// README.md's "Ingestion" section, which must be kept in sync with the
// defaults below (telemetry-ingestion R24's acceptance criterion).
//
// Pure and side-effect-free so it can be unit tested with `node --test`
// without a Convex runtime.

function numberFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface IngestConfig {
  maxReadingsPerBatch: number;
  maxPayloadBytes: number;
  maxFutureSkewMs: number;
  maxBackfillAgeMs: number;
  maxExternalIdLength: number;
  maxMetricLength: number;
  maxStringValueLength: number;
  requestsPerMinute: number;
  requestBurst: number;
  readingsPerMinute: number;
  readingBurst: number;
  rejectionRetentionMs: number;
  rejectionMaxRows: number;
  statsRetentionMs: number;
}

export const INGEST_CONFIG_DEFAULTS: IngestConfig = {
  maxReadingsPerBatch: 500,
  maxPayloadBytes: 1048576, // 1 MiB
  maxFutureSkewMs: 120000, // 2 min
  maxBackfillAgeMs: 604800000, // 7 days
  maxExternalIdLength: 128,
  maxMetricLength: 64,
  maxStringValueLength: 512,
  requestsPerMinute: 120,
  requestBurst: 60,
  readingsPerMinute: 6000,
  readingBurst: 3000,
  rejectionRetentionMs: 604800000, // 7 days
  rejectionMaxRows: 200000,
  statsRetentionMs: 7776000000, // 90 days
};

// One row per config field: its env var name, so `loadIngestConfig` doesn't
// need a `numberFromEnv(env, "...", DEFAULTS...)` call spelled out 14 times.
// Keys are checked against `IngestConfig` by `ENV_KEYS_ARE_EXHAUSTIVE` below,
// so a field added to the interface without an entry here fails typechecking
// rather than silently always falling back to its default.
const ENV_KEYS: { [K in keyof IngestConfig]: string } = {
  maxReadingsPerBatch: "INGEST_MAX_READINGS_PER_BATCH",
  maxPayloadBytes: "INGEST_MAX_PAYLOAD_BYTES",
  maxFutureSkewMs: "INGEST_MAX_FUTURE_SKEW_MS",
  maxBackfillAgeMs: "INGEST_MAX_BACKFILL_AGE_MS",
  maxExternalIdLength: "INGEST_MAX_EXTERNAL_ID_LENGTH",
  maxMetricLength: "INGEST_MAX_METRIC_LENGTH",
  maxStringValueLength: "INGEST_MAX_STRING_VALUE_LENGTH",
  requestsPerMinute: "INGEST_REQUESTS_PER_MINUTE",
  requestBurst: "INGEST_REQUEST_BURST",
  readingsPerMinute: "INGEST_READINGS_PER_MINUTE",
  readingBurst: "INGEST_READING_BURST",
  rejectionRetentionMs: "INGEST_REJECTION_RETENTION_MS",
  rejectionMaxRows: "INGEST_REJECTION_MAX_ROWS",
  statsRetentionMs: "INGEST_STATS_RETENTION_MS",
};

/** Reads ingestion limits from the given env (defaults to `process.env`). */
export function loadIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const config = {} as IngestConfig;
  for (const key of Object.keys(ENV_KEYS) as (keyof IngestConfig)[]) {
    config[key] = numberFromEnv(env, ENV_KEYS[key], INGEST_CONFIG_DEFAULTS[key]);
  }
  return config;
}
