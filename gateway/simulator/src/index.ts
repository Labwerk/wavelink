// Telemetry simulator: stands in for a real protocol adapter (MQTT/OPC-UA/etc.)
// through v1. Posts batches to the authenticated ingestion HTTP endpoint the
// same way a real gateway would (telemetry-ingestion R1, R26), authenticating
// with a service credential drawn from `INGEST_TOKENS`
// (`specs/auth-roles/spec.md` R12: a service credential distinct from any
// user session) — not by calling `ingest.recordBatch` directly, since that
// mutation is internal and unreachable from any client (R4). Devices are
// registered by an admin from the dashboard (`devices.register` is
// admin-only, per auth-roles); this simulator no longer self-registers them
// — see specs/telemetry-ingestion/plan.md's Risks, "Simulator's
// devices.register bootstrap will break under auth-roles" (resolved).

// HTTP actions are served from the deployment's *site* origin (self-hosted:
// port 3211, `.convex.site` on Convex Cloud) — not the 3210 API origin.
const INGEST_URL = process.env.WAVELINK_INGEST_URL;
if (!INGEST_URL) {
  throw new Error("WAVELINK_INGEST_URL env var is required (e.g. http://backend:3211/ingest/readings)");
}

const INGEST_TOKEN = process.env.WAVELINK_INGEST_TOKEN;
if (!INGEST_TOKEN) {
  throw new Error("WAVELINK_INGEST_TOKEN env var is required — a <sourceId>.<secret> entry from INGEST_TOKENS");
}

const DEFAULT_MAX_BATCH = 50;
const INTERVAL_MS = Number(process.env.SIMULATOR_INTERVAL_MS ?? 2000);
const configuredMaxBatch = Number(process.env.WAVELINK_MAX_BATCH ?? DEFAULT_MAX_BATCH);
// A configured value <= 0 would otherwise silently disable batching
// entirely (see `chunk()`'s fallback below) rather than erroring or falling
// back sensibly — treat it as "not configured".
const MAX_BATCH =
  Number.isFinite(configuredMaxBatch) && configuredMaxBatch > 0 ? configuredMaxBatch : DEFAULT_MAX_BATCH;

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
let backoffMs = MIN_BACKOFF_MS;

const BATCH_METRICS = ["temperature_c", "cycle_count", "error_code"] as const;

// Devices are registered by an admin from the dashboard (`devices.register`
// is admin-only); telemetry for devices that do not exist yet is safely
// skipped by `ingest.recordBatch`. Register these externalIds to see data.
const SIMULATED_DEVICES = [
  { externalId: "sim-cnc-01", name: "CNC Mill 1", type: "cnc-mill", zone: "line-a" },
  { externalId: "sim-agv-01", name: "AGV 1", type: "agv", zone: "warehouse" },
  { externalId: "sim-arm-01", name: "Robot Arm 1", type: "robot-arm", zone: "line-b" },
];

let cycleCounts = new Map<string, number>(SIMULATED_DEVICES.map((d) => [d.externalId, 0]));

function randomReading(externalId: string, ts: number) {
  const cycles = (cycleCounts.get(externalId) ?? 0) + 1;
  cycleCounts.set(externalId, cycles);

  return BATCH_METRICS.map((metric) => {
    let value: number;
    switch (metric) {
      case "temperature_c":
        value = Math.round((40 + Math.random() * 30) * 10) / 10;
        break;
      case "cycle_count":
        value = cycles;
        break;
      case "error_code":
        value = Math.random() < 0.02 ? 500 : 0;
        break;
    }
    return { externalId, ts, metric, value };
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function jitter(ms: number): number {
  return Math.round(ms * (0.5 + Math.random()));
}

interface IngestReading {
  externalId: string;
  ts: number;
  metric: string;
  value: number | string;
}

interface IngestSuccessBody {
  outcome: "accepted";
  batchId: string;
  submitted: number;
  stored: number;
  rejected: Array<{ index: number; reason: string; externalId?: string; metric?: string }>;
}

interface IngestErrorBody {
  outcome: "error";
  category: string;
  retryAfterMs?: number;
}

/** Posts one chunk to the ingestion endpoint. Returns `"ok"` on success,
 * `"retry"` for anything that should trigger backoff-and-retry (rate limit,
 * network error, server error, or a configuration problem like a bad
 * credential or oversize batch) — the simulator never exits or tight-loops
 * on failure (R26). */
async function postBatch(readings: IngestReading[]): Promise<"ok" | "retry"> {
  let response: Response;
  try {
    response = await fetch(INGEST_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INGEST_TOKEN}`,
      },
      body: JSON.stringify({ readings }),
    });
  } catch (err) {
    console.error("Ingest request failed with a network error; backing off and retrying", err);
    return "retry";
  }

  let body: IngestSuccessBody | IngestErrorBody | null = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body (e.g. a proxy error page) is handled by the status
    // check below; `body` stays null.
  }

  if (response.status === 200 && body?.outcome === "accepted") {
    console.log(`Ingested batch ${body.batchId}: submitted=${body.submitted} stored=${body.stored}`);
    for (const rejection of body.rejected) {
      console.warn(
        `Reading rejected: index=${rejection.index} reason=${rejection.reason}` +
          (rejection.externalId ? ` externalId=${rejection.externalId}` : "") +
          (rejection.metric ? ` metric=${rejection.metric}` : ""),
      );
    }
    return "ok";
  }

  if (response.status === 429) {
    const retryAfterMs =
      (body as IngestErrorBody | null)?.retryAfterMs ??
      Number(response.headers.get("Retry-After") ?? "0") * 1000;
    console.warn(`Ingest request rate-limited; retry hint ~${retryAfterMs}ms`, body);
    return "retry";
  }

  if (response.status === 401 || response.status === 400 || response.status === 413) {
    // Configuration errors (bad credential, malformed payload, oversize
    // batch): logged distinctly so an operator can tell them from a
    // transient failure. Still retried at the capped backoff interval,
    // never exited — correcting INGEST_TOKENS server-side resumes ingestion
    // with no simulator restart (R26).
    console.error(
      `Ingest request rejected (category=${(body as IngestErrorBody | null)?.category ?? "unknown"}); check WAVELINK_INGEST_TOKEN / batch configuration`,
      body,
    );
    return "retry";
  }

  console.error(`Ingest request failed with HTTP ${response.status}`, body);
  return "retry";
}

async function tick() {
  const ts = Date.now();
  const readings = SIMULATED_DEVICES.flatMap((d) => randomReading(d.externalId, ts));
  const batches = chunk(readings, MAX_BATCH);

  let anyFailure = false;
  for (const batch of batches) {
    const outcome = await postBatch(batch);
    if (outcome === "retry") anyFailure = true;
  }

  backoffMs = anyFailure ? Math.min(MAX_BACKOFF_MS, backoffMs * 2) : MIN_BACKOFF_MS;
}

async function main() {
  // A recursive await-loop (rather than setInterval) so a rate-limited or
  // failed tick waits out its backoff before the next attempt, instead of
  // firing on a fixed timer regardless of outcome (R26: back off and retry,
  // never tight-loop).
  for (;;) {
    await tick();
    const wait = backoffMs > MIN_BACKOFF_MS ? jitter(backoffMs) : INTERVAL_MS;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
