import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

// The Google Drive OAuth callback (spec §7.2) is registered in drive_http.ts
// and wired here once the Drive module lands.
import { registerDriveRoutes } from "./drive_http";
registerDriveRoutes(http);

export default http;
