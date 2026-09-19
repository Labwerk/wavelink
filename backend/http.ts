import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { isValidServiceToken } from "./lib/serviceAuth";

const http = httpRouter();

auth.addHttpRoutes(http);

// Ingestion entry point for the gateway/simulator (spec R12). Authenticates
// with the INGEST_SERVICE_TOKEN service credential - never a user session -
// and forwards to the internal `ingest.recordBatch` mutation. A bad or
// missing token gets a bare 401 with no detail.
http.route({
  path: "/ingest/telemetry",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (
      !isValidServiceToken(
        request.headers.get("Authorization"),
        process.env.INGEST_SERVICE_TOKEN,
      )
    ) {
      return new Response(null, { status: 401 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const readings = (body as { readings?: unknown } | null)?.readings;
    try {
      // Argument validators on the mutation reject malformed readings.
      await ctx.runMutation(internal.ingest.recordBatch, {
        readings: readings as never,
      });
    } catch {
      return new Response("Invalid batch", { status: 400 });
    }
    return new Response(null, { status: 204 });
  }),
});

export default http;
