import { expect, test } from "vitest";
import { loadIngestConfig, INGEST_CONFIG_DEFAULTS } from "../backend/lib/ingestConfig";

test("loadIngestConfig falls back to documented defaults when env is empty", () => {
  const config = loadIngestConfig({});
  expect(config).toEqual(INGEST_CONFIG_DEFAULTS);
});

test("loadIngestConfig ignores unset and empty-string env vars", () => {
  const config = loadIngestConfig({ INGEST_MAX_READINGS_PER_BATCH: "" });
  expect(config.maxReadingsPerBatch).toBe(INGEST_CONFIG_DEFAULTS.maxReadingsPerBatch);
});

test("loadIngestConfig applies every override", () => {
  const env = {
    INGEST_MAX_READINGS_PER_BATCH: "10",
    INGEST_MAX_PAYLOAD_BYTES: "20",
    INGEST_MAX_FUTURE_SKEW_MS: "30",
    INGEST_MAX_BACKFILL_AGE_MS: "40",
    INGEST_MAX_EXTERNAL_ID_LENGTH: "50",
    INGEST_MAX_METRIC_LENGTH: "60",
    INGEST_MAX_STRING_VALUE_LENGTH: "70",
    INGEST_REQUESTS_PER_MINUTE: "80",
    INGEST_REQUEST_BURST: "90",
    INGEST_READINGS_PER_MINUTE: "100",
    INGEST_READING_BURST: "110",
    INGEST_REJECTION_RETENTION_MS: "120",
    INGEST_REJECTION_MAX_ROWS: "130",
    INGEST_STATS_RETENTION_MS: "140",
  };
  const config = loadIngestConfig(env);
  expect(config).toEqual({
    maxReadingsPerBatch: 10,
    maxPayloadBytes: 20,
    maxFutureSkewMs: 30,
    maxBackfillAgeMs: 40,
    maxExternalIdLength: 50,
    maxMetricLength: 60,
    maxStringValueLength: 70,
    requestsPerMinute: 80,
    requestBurst: 90,
    readingsPerMinute: 100,
    readingBurst: 110,
    rejectionRetentionMs: 120,
    rejectionMaxRows: 130,
    statsRetentionMs: 140,
  });
});

test("loadIngestConfig falls back on a non-numeric override", () => {
  const config = loadIngestConfig({ INGEST_MAX_READINGS_PER_BATCH: "not-a-number" });
  expect(config.maxReadingsPerBatch).toBe(INGEST_CONFIG_DEFAULTS.maxReadingsPerBatch);
});
