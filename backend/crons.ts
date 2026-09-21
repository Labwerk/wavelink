import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// R3/R6: writes are the only thing that invalidate a Convex query
// subscription, so an online->offline transition with no further telemetry
// requires a scheduled write, not a read-time computation — see
// specs/device-registry/plan.md "The one hard constraint". This interval is
// a code constant (not env) because crons.ts is evaluated at push time; only
// the heartbeat *window* (backend/lib/config.ts) needs to be env-configurable
// for R4. Documented worst-case visibility delay: window + 15s.
crons.interval("sweep offline devices", { seconds: 15 }, internal.devices.sweepOffline, {});

export default crons;
