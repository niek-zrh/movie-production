import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/** Origin (scheme + host + port) of a URL, or null when unset/unparseable. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The Convex client talks to the same origin over both HTTPS and WebSocket
 * (the realtime subscription), so every Convex origin is needed twice.
 */
function withWebSocket(origin: string): string[] {
  return [origin, origin.replace(/^http/, "ws")];
}

// Where this build talks to Convex: the API origin (queries/mutations, the
// realtime socket, file storage URLs from ctx.storage.getUrl) and the HTTP
// actions origin (OAuth callbacks). Read from the same env vars the app
// itself uses so another deployment needs no edit here.
const convexApiOrigin = originOf(process.env.NEXT_PUBLIC_CONVEX_URL);
const convexSiteOrigin =
  originOf(process.env.NEXT_PUBLIC_CONVEX_SITE_URL) ??
  // Convex cloud serves HTTP actions on the .site twin of the API origin;
  // self-hosted backends have an unrelated host (actions.kinolab.ai), so the
  // compose build passes NEXT_PUBLIC_CONVEX_SITE_URL explicitly.
  (convexApiOrigin !== null && convexApiOrigin.endsWith(".convex.cloud")
    ? convexApiOrigin.replace(/\.convex\.cloud$/, ".convex.site")
    : null);

// Escape hatch (comma-separated origins) so an operator can widen the policy
// without a code change if something legitimate is blocked at go-live.
const extraOrigins = (process.env.CSP_EXTRA_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o !== "");

// `next dev` opens the HMR socket on the page's own origin; not every browser
// treats ws:// as covered by 'self', and the Playwright suite runs on the dev
// server — so spell it out rather than risk a blocked socket.
const devSources = isProd ? [] : ["ws://localhost:*", "ws://127.0.0.1:*"];

// The plain HTTP(S) Convex origins, without the socket twins. Thumbnails and
// files are served from these (ctx.storage.getUrl), and on a local dev backend
// they are http://127.0.0.1:3210 — a blanket `https:` in img-src does NOT
// cover that, which blocks every thumbnail in development.
const convexHttpOrigins = [convexApiOrigin, convexSiteOrigin].filter(
  (o): o is string => o !== null,
);

const convexSources = convexHttpOrigins.flatMap(withWebSocket);

// Google endpoints the browser touches once Drive is configured (spec §7):
// apis.google.com hosts the Picker loader (lib/google-picker.ts), the Picker
// itself renders in a docs.google.com iframe, and gapi calls googleapis.com.
const googleScriptSources = [
  "https://apis.google.com",
  "https://accounts.google.com",
];
const googleConnectSources = [
  "https://apis.google.com",
  "https://accounts.google.com",
  "https://*.googleapis.com",
];
const googleFrameSources = [
  "https://docs.google.com",
  "https://drive.google.com",
  "https://accounts.google.com",
];

/**
 * Content-Security-Policy. Deliberately on the permissive side of correct: a
 * policy that blocks the Convex socket or the Drive Picker on pilot day is
 * worse than no policy. Notes per directive:
 *  - script-src 'unsafe-inline': Next.js inlines its bootstrap/flight payload
 *    scripts and this app sets no nonce; 'unsafe-eval' only in dev (the React
 *    refresh runtime needs it, the production bundle does not).
 *  - style-src 'unsafe-inline': Next and Base UI both emit inline styles.
 *  - img-src: the Convex origins are listed explicitly because a local dev
 *    backend serves storage over http, which `https:` does not cover; the
 *    blanket `https:` then also covers Drive and Google avatars. Widening
 *    this cannot execute anything, and a blocked thumbnail looks like data
 *    loss to the studio.
 *  - connect-src: Convex HTTP + wss (realtime) + Google APIs; blob:/data: are
 *    used by the upload dropzone.
 *  - no upgrade-insecure-requests: it would rewrite the local dev backend
 *    (http://127.0.0.1:3210) to https and break `pnpm dev` / the E2E suite.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"} ${googleScriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // next/font self-hosts Archivo + Martian Mono, so gstatic is belt-and-braces.
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: https: ${convexHttpOrigins.join(" ")}`,
  `media-src 'self' data: blob: https: ${convexHttpOrigins.join(" ")}`,
  `connect-src 'self' blob: data: ${[...convexSources, ...googleConnectSources, ...devSources, ...extraOrigins].join(" ")}`,
  `frame-src 'self' ${googleFrameSources.join(" ")}`,
  "worker-src 'self' blob:",
  // Clickjacking: same intent as X-Frame-Options, for browsers that prefer CSP.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
]
  // Trim: a directive whose source list is empty (no Convex origin at build
  // time) would otherwise carry a trailing space.
  .map((directive) => directive.trim())
  .join("; ");

const nextConfig: NextConfig = {
  // Thumbnails are served from Convex storage HTTP URLs (local dev or cloud).
  images: { unoptimized: true },
  // Self-contained server bundle for the Docker runner stage.
  output: "standalone",
  /**
   * Security headers for every route. NOTE: Next evaluates headers() at BUILD
   * time and bakes the result into the routes manifest, so changing any of
   * the env vars above needs a rebuild — exactly like NEXT_PUBLIC_CONVEX_URL.
   * Set CSP_REPORT_ONLY=1 at build time to ship the CSP in report-only mode
   * (headers still enforced) if something turns out to be blocked.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key:
              process.env.CSP_REPORT_ONLY === "1"
                ? "Content-Security-Policy-Report-Only"
                : "Content-Security-Policy",
            value: csp,
          },
          // The app is never framed; the Picker frames Google, not us.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send the origin (not the path) to third parties: shot codes and
          // production ids live in our URLs.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing in the app uses these; fullscreen and clipboard-write are
          // left at their defaults because the Review Room uses both.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), serial=(), bluetooth=()",
          },
          // Only meaningful over TLS, and a dev server on http would pin every
          // other localhost app to https — production builds only.
          ...(isProd
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
