import type { HttpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * OAuth code-flow callback for the "Connect Google Drive" flow (spec §7.2).
 * Route: GET {CONVEX_SITE_URL}/google/drive/callback
 */
export function registerDriveRoutes(http: HttpRouter) {
  http.route({
    path: "/google/drive/callback",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
      const redirect = (path: string) =>
        new Response(null, {
          status: 302,
          headers: { Location: `${siteUrl}${path}` },
        });

      if (error || !code || !state) {
        return redirect(
          `/drive/connected?status=error&reason=${encodeURIComponent(error ?? "missing_code")}`,
        );
      }

      try {
        const result: { returnTo: string } = await ctx.runAction(
          internal.drive.completeConnection,
          { code, state },
        );
        const sep = result.returnTo.includes("?") ? "&" : "?";
        return redirect(`${result.returnTo}${sep}status=connected`);
      } catch (e) {
        console.error("Drive connect failed", e);
        return redirect(`/drive/connected?status=error&reason=exchange_failed`);
      }
    }),
  });
}
