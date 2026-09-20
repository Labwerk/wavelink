import { httpRouter } from "convex/server";
import { ingestReadings } from "./ingestHttp";

// Shared HTTP router (telemetry-ingestion R1). `auth-roles` adds its own
// routes to this same `http` object (`auth.addHttpRoutes(http)`) rather than
// replacing this file — see plan.md's Risks, "backend/http.ts is shared with
// auth-roles".
const http = httpRouter();

http.route({
  path: "/ingest/readings",
  method: "POST",
  handler: ingestReadings,
});

export default http;
