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

/** Reads ingestion limits from the given env (defaults to `process.env`). */
export function loadIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  return {
    maxReadingsPerBatch: numberFromEnv(
      env,
      "INGEST_MAX_READINGS_PER_BATCH",
      INGEST_CONFIG_DEFAULTS.maxReadingsPerBatch,
    ),
    maxPayloadBytes: numberFromEnv(
      env,
      "INGEST_MAX_PAYLOAD_BYTES",
      INGEST_CONFIG_DEFAULTS.maxPayloadBytes,
    ),
    maxFutureSkewMs: numberFromEnv(
      env,
      "INGEST_MAX_FUTURE_SKEW_MS",
      INGEST_CONFIG_DEFAULTS.maxFutureSkewMs,
    ),
    maxBackfillAgeMs: numberFromEnv(
      env,
      "INGEST_MAX_BACKFILL_AGE_MS",
      INGEST_CONFIG_DEFAULTS.maxBackfillAgeMs,
    ),
    maxExternalIdLength: numberFromEnv(
      env,
      "INGEST_MAX_EXTERNAL_ID_LENGTH",
      INGEST_CONFIG_DEFAULTS.maxExternalIdLength,
    ),
    maxMetricLength: numberFromEnv(
      env,
      "INGEST_MAX_METRIC_LENGTH",
      INGEST_CONFIG_DEFAULTS.maxMetricLength,
    ),
    maxStringValueLength: numberFromEnv(
      env,
      "INGEST_MAX_STRING_VALUE_LENGTH",
      INGEST_CONFIG_DEFAULTS.maxStringValueLength,
    ),
    requestsPerMinute: numberFromEnv(
      env,
      "INGEST_REQUESTS_PER_MINUTE",
      INGEST_CONFIG_DEFAULTS.requestsPerMinute,
    ),
    requestBurst: numberFromEnv(env, "INGEST_REQUEST_BURST", INGEST_CONFIG_DEFAULTS.requestBurst),
    readingsPerMinute: numberFromEnv(
      env,
      "INGEST_READINGS_PER_MINUTE",
      INGEST_CONFIG_DEFAULTS.readingsPerMinute,
    ),
    readingBurst: numberFromEnv(env, "INGEST_READING_BURST", INGEST_CONFIG_DEFAULTS.readingBurst),
    rejectionRetentionMs: numberFromEnv(
      env,
      "INGEST_REJECTION_RETENTION_MS",
      INGEST_CONFIG_DEFAULTS.rejectionRetentionMs,
    ),
    rejectionMaxRows: numberFromEnv(
      env,
      "INGEST_REJECTION_MAX_ROWS",
      INGEST_CONFIG_DEFAULTS.rejectionMaxRows,
    ),
    statsRetentionMs: numberFromEnv(
      env,
      "INGEST_STATS_RETENTION_MS",
      INGEST_CONFIG_DEFAULTS.statsRetentionMs,
    ),
  };
}
