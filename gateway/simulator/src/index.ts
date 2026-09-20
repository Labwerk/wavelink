// Telemetry simulator: stands in for a real protocol adapter (MQTT/OPC-UA/etc.)
// through v1. Posts batches to the same HTTP ingestion route a real gateway
// would use, authenticating with the INGEST_SERVICE_TOKEN service credential
// (spec `specs/auth-roles/spec.md` R12) - not with any user session.
// See plans/implementation-plan.md, Phase M1 decision.

// HTTP actions are served from the deployment's *site* URL (self-hosted:
// port 3211, `.convex.site` on Convex Cloud) - not the 3210 API URL.
const CONVEX_SITE_URL = process.env.CONVEX_SITE_URL?.replace(/\/+$/, "");
if (!CONVEX_SITE_URL) {
  throw new Error(
    "CONVEX_SITE_URL env var is required (e.g. http://backend:3211, the HTTP-actions URL)",
  );
}
const INGEST_SERVICE_TOKEN = process.env.INGEST_SERVICE_TOKEN;
if (!INGEST_SERVICE_TOKEN) {
  throw new Error(
    "INGEST_SERVICE_TOKEN env var is required (must match the value set on the Convex deployment)",
  );
}

const INTERVAL_MS = Number(process.env.SIMULATOR_INTERVAL_MS ?? 2000);
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

async function tick() {
  const ts = Date.now();
  const readings = SIMULATED_DEVICES.flatMap((d) => randomReading(d.externalId, ts));
  try {
    const response = await fetch(`${CONVEX_SITE_URL}/ingest/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INGEST_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({ readings }),
    });
    if (!response.ok) {
      console.error(
        `Ingest rejected the batch: HTTP ${response.status}` +
          (response.status === 401 ? " (check INGEST_SERVICE_TOKEN)" : ""),
      );
      return;
    }
    console.log(`Sent batch of ${readings.length} readings`);
  } catch (err) {
    console.error("Failed to send batch", err);
  }
}

async function main() {
  setInterval(tick, INTERVAL_MS);
  await tick();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
