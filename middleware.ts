import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";
import { NextRequest, type NextFetchEvent } from "next/server";

const isSignInPage = createRouteMatcher(["/sign-in"]);
const isProtectedRoute = createRouteMatcher(["/((?!sign-in|drive).*)"]);

const authMiddleware = convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/");
    }
    if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
      return nextjsMiddlewareRedirect(request, "/sign-in");
    }
  },
);

/**
 * Behind a TLS-terminating proxy (Cloudflare → Traefik → this container over
 * plain HTTP), Next builds request.url with protocol "http:" while the
 * browser's Origin header says "https:". Convex Auth's /api/auth proxy
 * compares the two and rejects the mismatch as cross-origin (403), breaking
 * sign-in. Restore the real protocol from x-forwarded-proto before the auth
 * middleware sees the request. Local dev sends no such header — no change.
 */
export default function middleware(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  let changed = false;

  // Next standalone can build request.url from its BIND address
  // (http://0.0.0.0:8090/…) instead of the routed host — any redirect built
  // from it then leaks an unreachable internal URL to the browser. The Host
  // header always carries the real external host; restore it. NOTE: the URL
  // host setter keeps an existing port when the new value has none, so the
  // port must be cleared explicitly.
  if (host !== null && host !== "" && url.host !== host) {
    url.host = host;
    if (!host.includes(":")) url.port = "";
    changed = true;
  }

  if (url.protocol === "http:") {
    // Signal 1: explicit deployment setting (set FORCE_HTTPS=1 wherever the
    // app is only ever served via TLS-terminating proxies).
    let upgrade = process.env.FORCE_HTTPS === "1";
    // Signal 2: the proxy says the client connection was TLS. (Traefik only
    // forwards this truthfully when it trusts the upstream.)
    if (!upgrade) {
      const forwardedProto = request.headers.get("x-forwarded-proto");
      upgrade = forwardedProto?.split(",")[0]?.trim() === "https";
    }
    // Signal 3: Cloudflare's cf-visitor header — Traefik passes custom
    // headers through even when it rewrites x-forwarded-proto.
    if (!upgrade) {
      upgrade =
        request.headers.get("cf-visitor")?.includes('"scheme":"https"') ===
        true;
    }
    // Signal 4: the browser's own Origin header is https for the SAME host —
    // exactly the false-positive the auth proxy 403s on; a genuinely
    // cross-origin request still fails its host comparison either way.
    if (!upgrade && host !== null) {
      const origin = request.headers.get("origin");
      if (origin !== null) {
        try {
          const originUrl = new URL(origin);
          upgrade = originUrl.protocol === "https:" && originUrl.host === host;
        } catch {
          // Malformed Origin — leave the request untouched.
        }
      }
    }
    if (upgrade) {
      url.protocol = "https:";
      changed = true;
    }
  }

  if (changed) request = new NextRequest(url, request);
  return authMiddleware(request, event);
}

export const config = {
  // Excludes ONLY /api/health (the container healthcheck must answer without
  // an auth round-trip to Convex). /api/auth stays matched — Convex Auth's
  // middleware serves the cookie-exchange proxy on it.
  matcher: ["/((?!.*\\..*|_next|api/health).*)", "/"],
};
