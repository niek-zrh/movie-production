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
          headers: {
            Location: `${siteUrl}${path}`,
            // This URL carries a single-use authorization code: keep it out of
            // caches and out of the next page's Referer.
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });

      if (error || !code || !state) {
        // Google's error codes are lowercase tokens (access_denied,
        // admin_policy_enforced…). Clamp before reflecting it: /drive/connected
        // prints this string, and the query is attacker-reachable.
        const reason = (error ?? "missing_code").toLowerCase();
        const safeReason = /^[a-z0-9_-]{1,40}$/.test(reason)
          ? reason
          : "unknown_error";
        return redirect(`/drive/connected?status=error&reason=${safeReason}`);
      }

      try {
        // CSRF: completeConnection resolves `state` against driveConnectStates
        // BEFORE the token exchange — an unknown, expired (>10 min) or already
        // used state row means no exchange happens, and saveConnection deletes
        // the row, so a replayed callback lands in the catch below.
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
