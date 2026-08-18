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
  if (request.nextUrl.protocol === "http:") {
    // Signal 1: the proxy says the client connection was TLS. (Traefik only
    // forwards this truthfully when it trusts the upstream, so don't rely on
    // it alone.)
    const forwardedProto = request.headers.get("x-forwarded-proto");
    let upgrade = forwardedProto?.split(",")[0]?.trim() === "https";
    // Signal 2: the browser's own Origin header is https for the SAME host.
    // That is exactly the false-positive the auth proxy 403s on; a genuinely
    // cross-origin request still fails its host comparison either way.
    if (!upgrade) {
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");
      if (origin !== null && host !== null) {
        try {
          const originUrl = new URL(origin);
          upgrade = originUrl.protocol === "https:" && originUrl.host === host;
        } catch {
          // Malformed Origin — leave the request untouched.
        }
      }
    }
    if (upgrade) {
      const url = new URL(request.url);
      url.protocol = "https:";
      request = new NextRequest(url, request);
    }
  }
  return authMiddleware(request, event);
}

export const config = {
  // Excludes ONLY /api/health (the container healthcheck must answer without
  // an auth round-trip to Convex). /api/auth stays matched — Convex Auth's
  // middleware serves the cookie-exchange proxy on it.
  matcher: ["/((?!.*\\..*|_next|api/health).*)", "/"],
};
