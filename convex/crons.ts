import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily production reports fire at 18:00 in each production's own timezone;
// Convex crons are UTC-only, so an hourly tick checks local time (idempotent).
crons.interval("daily reports", { hours: 1 }, internal.reports.cronTick, {});

// Drive hub metadata sync (spec §7.5). No-ops for productions without a hub.
crons.interval("drive hub sync", { minutes: 5 }, internal.drive.cronSync, {});

export default crons;
