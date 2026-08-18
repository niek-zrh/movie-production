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
  // /api is excluded: the only Next API route is the container healthcheck,
  // which must respond without an auth round-trip to Convex.
  matcher: ["/((?!.*\\..*|_next|api/).*)", "/"],
};
