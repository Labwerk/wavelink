import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { ingestReadings } from "./ingestHttp";

// Shared HTTP router (telemetry-ingestion R1). `auth-roles` adds its own
// routes to this same `http` object (`auth.addHttpRoutes(http)`) — required
// for Convex Auth's own sign-in/session routes — rather than replacing this
// file, per plan.md's Risks, "backend/http.ts is shared with auth-roles".
const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/ingest/readings",
  method: "POST",
  handler: ingestReadings,
});

export default http;
