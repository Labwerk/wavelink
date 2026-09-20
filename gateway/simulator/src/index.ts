// Telemetry simulator: stands in for a real protocol adapter (MQTT/OPC-UA/etc.)
// through v1. Calls the same ingestion mutation a real gateway would.
// See plans/implementation-plan.md, Phase M1 decision.

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { ConvexError } from "convex/values";

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  throw new Error("CONVEX_URL env var is required (e.g. http://backend:3210)");
}

const INTERVAL_MS = Number(process.env.SIMULATOR_INTERVAL_MS ?? 2000);
const BATCH_METRICS = ["temperature_c", "cycle_count", "error_code"] as const;

const SIMULATED_DEVICES = [
  { externalId: "sim-cnc-01", name: "CNC Mill 1", type: "cnc-mill", zone: "line-a" },
  { externalId: "sim-agv-01", name: "AGV 1", type: "agv", zone: "warehouse" },
  { externalId: "sim-arm-01", name: "Robot Arm 1", type: "robot-arm", zone: "line-b" },
];

const client = new ConvexHttpClient(CONVEX_URL);

let cycleCounts = new Map<string, number>(SIMULATED_DEVICES.map((d) => [d.externalId, 0]));

function isAlreadyRegisteredError(err: unknown): boolean {
  if (!(err instanceof ConvexError)) return false;
  const data = err.data as { fieldErrors?: { field: string; message: string }[] };
  return Boolean(
    data?.fieldErrors?.some(
      (fe) => fe.field === "externalId" && /already registered/.test(fe.message),
    ),
  );
}

async function ensureDevicesRegistered() {
  for (const device of SIMULATED_DEVICES) {
    try {
      await client.mutation(anyApi.devices.register, device);
      console.log(`Registered device ${device.externalId}`);
    } catch (err) {
      if (isAlreadyRegisteredError(err)) continue; // expected on restarts
      // Anything else (admin-gating denial, validation failure, network error)
      // must be visible — swallowing it here caused silent ingestion outages
      // when DEVICE_REGISTRY_REQUIRE_ADMIN is enabled without a service actor.
      console.error(`Failed to register device ${device.externalId}:`, err);
    }
  }
}

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
    await client.mutation(anyApi.ingest.recordBatch, { readings });
    console.log(`Sent batch of ${readings.length} readings`);
  } catch (err) {
    console.error("Failed to send batch", err);
  }
}

async function main() {
  await ensureDevicesRegistered();
  setInterval(tick, INTERVAL_MS);
  await tick();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
