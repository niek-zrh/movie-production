import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/sign-in"]);
const isProtectedRoute = createRouteMatcher(["/((?!sign-in|drive).*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/sign-in");
  }
});

export const config = {
  // Excludes ONLY /api/health (the container healthcheck must answer without
  // an auth round-trip to Convex). /api/auth stays matched — Convex Auth's
  // middleware serves the cookie-exchange proxy on it.
  matcher: ["/((?!.*\\..*|_next|api/health).*)", "/"],
};
