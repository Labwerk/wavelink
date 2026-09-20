import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Bounds ingestRejections/ingestStats storage growth (telemetry-ingestion
// R25's retention; see backend/ingestStats.ts's `prune`). Runs hourly and
// deletes in bounded pages, so a large backlog converges over several runs
// rather than risking one oversized transaction.
const crons = cronJobs();

crons.interval("prune ingestion stats and rejections", { hours: 1 }, internal.ingestStats.prune);

export default crons;
