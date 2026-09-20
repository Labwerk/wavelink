import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticateIngestRequest } from "./lib/ingestAuth";
import { loadIngestConfig } from "./lib/ingestConfig";
import { UNAUTHENTICATED_SOURCE } from "./ingestStats";

// The httpAction pipeline for POST /ingest/readings (telemetry-ingestion R1).
// Order matters: authenticate → rate-limit → parse/size-check → run the
// batch mutation → record stats. Everything through the rate-limit and
// size/shape checks happens *before* any `runMutation` into `ingest.ts`, so
// every request-level failure (R16) is genuinely all-or-nothing — nothing is
// ever written for a request that ends up rejected here.

const JSON_HEADERS = { "Content-Type": "application/json" };

// Byte-identical for every credential failure, regardless of what the
// request claimed — R7's "reveals nothing" requirement.
const UNAUTHORIZED_BODY = JSON.stringify({ outcome: "error", category: "unauthorized" });

type FailureCategory =
  | "malformed_payload"
  | "batch_too_large"
  | "payload_too_large"
  | "rate_limited"
  | "internal_error";

function errorResponse(status: number, category: FailureCategory, retryAfterMs?: number): Response {
  const body: Record<string, unknown> = { outcome: "error", category };
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (retryAfterMs !== undefined) {
    body.retryAfterMs = retryAfterMs;
    headers["Retry-After"] = String(Math.ceil(retryAfterMs / 1000));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export const ingestReadings = httpAction(async (ctx, request) => {
  const config = loadIngestConfig();

  // 1. Authenticate (R2, R3, R5, R6, R7). Never touches ctx.auth, so an
  // end-user session token simply fails to match any configured ingestion
  // token (R3). Nothing has been written yet.
  const auth = authenticateIngestRequest(request.headers.get("Authorization"), process.env.INGEST_TOKENS);
  if (!auth) {
    await ctx.runMutation(internal.ingestStats.record, {
      sourceId: UNAUTHENTICATED_SOURCE,
      outcome: "credentialFailed",
    });
    console.warn(
      JSON.stringify({
        event: "ingest_auth_failed",
        ts: Date.now(),
        userAgent: request.headers.get("User-Agent"),
        forwardedFor: request.headers.get("X-Forwarded-For"),
      }),
    );
    return new Response(UNAUTHORIZED_BODY, { status: 401, headers: JSON_HEADERS });
  }
  const { sourceId } = auth;

  // 2. Rate-limit requests, per source (R21, R23), before parsing the body.
  const requestLimit = await ctx.runMutation(internal.ingestRateLimit.consume, {
    key: `ingestRequests:${sourceId}`,
    cost: 1,
    config: { rate: config.requestsPerMinute, periodMs: 60_000, capacity: config.requestBurst },
  });
  if (!requestLimit.ok) {
    await ctx.runMutation(internal.ingestStats.record, { sourceId, outcome: "rateLimited" });
    return errorResponse(429, "rate_limited", requestLimit.retryAfter);
  }

  // 3. Enforce payload size (R18) before parsing.
  const bodyText = await request.text();
  const bodyBytes = new TextEncoder().encode(bodyText).length;
  if (bodyBytes > config.maxPayloadBytes) {
    await ctx.runMutation(internal.ingestStats.record, { sourceId, outcome: "oversize" });
    return errorResponse(413, "payload_too_large");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    await ctx.runMutation(internal.ingestStats.record, { sourceId, outcome: "malformed" });
    return errorResponse(400, "malformed_payload");
  }
  const readings =
    typeof parsedBody === "object" && parsedBody !== null && Array.isArray((parsedBody as { readings?: unknown }).readings)
      ? ((parsedBody as { readings: unknown[] }).readings)
      : null;
  if (readings === null) {
    await ctx.runMutation(internal.ingestStats.record, { sourceId, outcome: "malformed" });
    return errorResponse(400, "malformed_payload");
  }

  // 4. Enforce batch size (R18).
  if (readings.length > config.maxReadingsPerBatch) {
    await ctx.runMutation(internal.ingestStats.record, { sourceId, outcome: "oversize" });
    return errorResponse(413, "batch_too_large");
  }

  // 5. Rate-limit readings, per source (R21, R23).
  const readingLimit = await ctx.runMutation(internal.ingestRateLimit.consume, {
    key: `ingestReadings:${sourceId}`,
    cost: readings.length,
    config: { rate: config.readingsPerMinute, periodMs: 60_000, capacity: config.readingBurst },
  });
  if (!readingLimit.ok) {
    await ctx.runMutation(internal.ingestStats.record, { sourceId, outcome: "rateLimited" });
    return errorResponse(429, "rate_limited", readingLimit.retryAfter);
  }

  // 6. Run the batch mutation — the one point past which writes happen. Its
  // own transaction commits all-or-nothing (R17); a thrown error here means
  // nothing was written for this request.
  const batchId = crypto.randomUUID();
  let result: { submitted: number; stored: number; rejected: Array<{ index: number; reason: string; externalId?: string; metric?: string }> };
  try {
    result = await ctx.runMutation(internal.ingest.recordBatch, { sourceId, batchId, readings });
  } catch (err) {
    console.error(
      JSON.stringify({ event: "ingest_internal_error", ts: Date.now(), sourceId, batchId, error: String(err) }),
    );
    return errorResponse(500, "internal_error");
  }

  // 7. Record stats (R25) and log rejections for operator visibility.
  const rejectedByReason: Record<string, number> = {};
  for (const rejection of result.rejected) {
    rejectedByReason[rejection.reason] = (rejectedByReason[rejection.reason] ?? 0) + 1;
  }
  await ctx.runMutation(internal.ingestStats.record, {
    sourceId,
    outcome: "accepted",
    readingsAccepted: result.stored,
    readingsRejected: result.rejected.length,
    rejectedByReason,
  });

  return new Response(
    JSON.stringify({
      outcome: "accepted",
      batchId,
      submitted: result.submitted,
      stored: result.stored,
      rejected: result.rejected,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
});
