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
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "https" && request.nextUrl.protocol === "http:") {
    const url = new URL(request.url);
    url.protocol = "https:";
    request = new NextRequest(url, request);
  }
  return authMiddleware(request, event);
}

export const config = {
  // Excludes ONLY /api/health (the container healthcheck must answer without
  // an auth round-trip to Convex). /api/auth stays matched — Convex Auth's
  // middleware serves the cookie-exchange proxy on it.
  matcher: ["/((?!.*\\..*|_next|api/health).*)", "/"],
};
