#!/usr/bin/env node
/**
 * Google Drive preflight (spec §7.6, README §Google setup).
 *
 * Inspects a running deployment through the app's OWN public API — no admin
 * key, no app UI — and reports what is configured, what is missing and what to
 * run. It reads no secrets and prints none.
 *
 * Usage:
 *   node scripts/drive-preflight.mjs                              # local dev backend
 *   node scripts/drive-preflight.mjs --url https://api.kinolab.ai # the pilot
 *   CONVEX_URL=https://api.kinolab.ai node scripts/drive-preflight.mjs
 *   --site-url <origin>   HTTP-actions origin, when it cannot be derived
 *
 * Exit: 0 when everything checkable from outside is in place, 1 when something
 * Drive needs is missing (so it can gate a deploy), 2 on bad usage.
 */

const DEFAULT_URL = "http://127.0.0.1:3210";
const TIMEOUT_MS = 8000;

const USAGE = `Usage: node scripts/drive-preflight.mjs [--url <convex-api-url>] [--site-url <http-actions-url>]

  --url        Convex API origin to inspect (default $CONVEX_URL, else ${DEFAULT_URL})
  --site-url   HTTP-actions origin, if it cannot be derived from --url
  -h, --help   This text`;

function die(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const opts = { url: undefined, siteUrl: undefined };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "-h" || arg === "--help") {
    console.log(USAGE);
    process.exit(0);
  }
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  const name = match ? match[1] : "url"; // a bare argument is the URL
  const value = match ? (match[2] ?? argv[++i]) : arg;
  if (value === undefined || value === "") die(`--${name} needs a value`);
  if (name === "url") opts.url = value;
  else if (name === "site-url") opts.siteUrl = value;
  else die(`Unknown option: ${arg}`);
}

function toOrigin(raw, label) {
  try {
    return new URL(raw).origin;
  } catch {
    die(`${label} is not a URL: ${raw}`);
  }
}

const targetRaw =
  opts.url ??
  process.env.CONVEX_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  DEFAULT_URL;
const targetSource = opts.url
  ? "--url"
  : process.env.CONVEX_URL
    ? "$CONVEX_URL"
    : process.env.NEXT_PUBLIC_CONVEX_URL
      ? "$NEXT_PUBLIC_CONVEX_URL"
      : "default: local dev backend";
const apiOrigin = toOrigin(targetRaw, "--url");

// URL.hostname keeps the brackets on IPv6 literals, hence "[::1]".
const isLoopback = (host) =>
  host === "127.0.0.1" || host === "localhost" || host === "[::1]";
const isLocalDev = isLoopback(new URL(apiOrigin).hostname);

/**
 * Where the deployment serves HTTP actions — the origin the two OAuth redirect
 * URIs are built from. Derived, then confirmed against the deployment itself.
 */
function siteCandidates() {
  const url = new URL(apiOrigin);
  const apiPort = Number(url.port);
  const out = [];
  // Self-hosted backends serve HTTP actions on the next port (3210 -> 3211).
  if (isLocalDev && Number.isFinite(apiPort) && apiPort > 0) {
    out.push(`${url.protocol}//${url.hostname}:${apiPort + 1}`);
  }
  if (url.hostname.endsWith(".convex.cloud")) {
    out.push(
      `${url.protocol}//${url.hostname.replace(/\.convex\.cloud$/, ".convex.site")}`,
    );
  }
  // Pilot convention: api.<domain> -> actions.<domain>
  // (deploy/convex-backend.compose.yml). A guess, but verified below.
  if (url.hostname.startsWith("api.")) {
    const port = url.port ? `:${url.port}` : "";
    out.push(`${url.protocol}//actions.${url.hostname.slice(4)}${port}`);
  }
  return [...new Set(out)];
}

const candidates = opts.siteUrl
  ? [toOrigin(opts.siteUrl, "--site-url")]
  : siteCandidates();

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const MARKS = {
  ok: paint("32", "[ OK ]"),
  fail: paint("31", "[FAIL]"),
  warn: paint("33", "[WARN]"),
  info: paint("36", "[INFO]"),
};

const failures = [];
const fixes = [];

function report(level, text, detail) {
  console.log(`  ${MARKS[level]} ${text}`);
  for (const line of (detail ?? "").split("\n").filter(Boolean)) {
    console.log(`         ${line}`);
  }
  if (level === "fail") failures.push(text);
}

function addFix(title, body) {
  if (fixes.some((fix) => fix.title === title)) return;
  fixes.push({ title, body });
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/** fetch that never throws and never follows redirects (we inspect them). */
async function probe(url, init) {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
    return { res };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Convex's public HTTP API: POST /api/query. Errors come back as HTTP 200. */
async function convexQuery(path) {
  const url = `${apiOrigin}/api/query`;
  const { res, error } = await probe(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args: {}, format: "json" }),
  });
  if (error) return { url, error };
  if (res.status !== 200) return { url, error: `HTTP ${res.status}` };
  const body = await res.json().catch(() => null);
  if (body?.status === "success") return { url, value: body.value };
  const message = String(body?.errorMessage ?? "unrecognised response");
  return { url, error: message.split("\n").filter(Boolean).pop() ?? message };
}

// ---------------------------------------------------------------------------
// Report tail (printed on every exit path)
// ---------------------------------------------------------------------------

let siteOrigin = null; // the deployment's CONVEX_SITE_URL, or our best guess
let siteConfirmed = false;

function finish() {
  console.log(
    "\nGoogle OAuth client — both redirect URIs must be registered EXACTLY",
  );
  const base = siteOrigin ?? candidates[0] ?? null;
  if (base === null) {
    console.log(
      "  Unknown — the HTTP-actions origin could not be determined.\n" +
        "  Re-run with --site-url <origin> (the pilot is https://actions.kinolab.ai).",
    );
  } else {
    const source = siteConfirmed
      ? "CONVEX_SITE_URL, read from the deployment itself"
      : paint("33", "GUESSED — unconfirmed, that origin never answered");
    console.log(`  base ${base}  (${source})`);
    console.log(`  ${base}/api/auth/callback/google   sign-in (Convex Auth)`);
    console.log(
      `  ${base}/google/drive/callback      Drive connect (convex/lib/google.ts redirectUri())`,
    );
  }

  console.log(
    "\nWhat this preflight CANNOT prove from outside (no admin key — by design)",
  );
  console.log(
    [
      "  - GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET are invisible here.",
      "    The Drive connect flow uses those, not AUTH_GOOGLE_*; README reuses one",
      "    OAuth client for both, but they are separate variables on the deployment.",
      "  - GOOGLE_PICKER_API_KEY is invisible here. Without it only 'Attach from",
      "    Drive' breaks — the Picker opens and fails; the rest keeps working.",
      "  - Whether those two redirect URIs are actually registered on the OAuth",
      "    client, and whether the consent screen is published 'In production'",
      "    (a Testing client's refresh tokens expire after 7 days and sync dies).",
      "  - Whether the hub owner's Drive connection still holds — that needs a",
      "    signed-in user (Settings -> Drive hub) and cannot be checked anonymously.",
      "  Confirm the names on the deployment: npx convex env list",
      "  (run it somewhere private — it prints values, not just names).",
    ].join("\n"),
  );

  if (fixes.length > 0) {
    console.log("\nFix, in order");
    fixes.forEach((fix, index) => {
      console.log(`\n  ${index + 1}. ${fix.title}`);
      for (const line of fix.body.split("\n")) console.log(`     ${line}`);
    });
  }

  console.log("");
  if (failures.length > 0) {
    const one = failures.length === 1;
    console.log(
      paint(
        "31",
        `Result: ${failures.length} problem${one ? "" : "s"} ${one ? "blocks" : "block"} Drive on ${apiOrigin}.`,
      ),
    );
    process.exit(1);
  }
  console.log(
    paint(
      "32",
      `Result: everything checkable from outside ${apiOrigin} is in place.`,
    ),
  );
  console.log(
    "That is NOT a clean bill of health — the items above are unverifiable from here.",
  );
  process.exit(0);
}

/** The env plane is the mistake that costs a deploy cycle — spell it out. */
const ENV_PLANE_NOTE = [
  "",
  "Docker / Dokploy Environment variables do NOT reach Convex functions: they",
  "configure the frontend container. Convex functions read the DEPLOYMENT's own",
  "environment, set only by `npx convex env set` or the Convex dashboard.",
].join("\n");

const CLI_TARGET = isLocalDev
  ? "# local dev: the CLI picks the deployment up from .env.local"
  : [
      "# point the Convex CLI at the self-hosted backend first:",
      `export CONVEX_SELF_HOSTED_URL=${apiOrigin}`,
      "export CONVEX_SELF_HOSTED_ADMIN_KEY=<generate_admin_key.sh output>",
    ].join("\n");

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

console.log(`\n${paint("1", "Kinolab — Google Drive preflight")}\n`);
console.log("Target");
console.log(`  Convex API origin    ${apiOrigin}  (${targetSource})`);
console.log(
  `  Deployment           ${isLocalDev ? "local dev backend" : "remote / self-hosted deployment"}`,
);
console.log("\nChecks");

// 1. Reachability — report the exact URL tried, so a wrong host is obvious.
const versionUrl = `${apiOrigin}/version`;
const version = await probe(versionUrl);
if (version.error) {
  report("fail", `Backend NOT reachable — GET ${versionUrl}`, version.error);
  addFix(
    "Reach the backend before anything else",
    [
      `Nothing answered at ${apiOrigin}.`,
      "Local dev: start it with `npx convex dev` (API 3210, HTTP actions 3211).",
      "Pilot: check the backend container and its Traefik router",
      "(deploy/convex-backend.compose.yml -> api.kinolab.ai).",
    ].join("\n"),
  );
  finish();
}
const versionRedirect = version.res.headers.get("location");
if (version.res.status >= 300 && version.res.status < 400 && versionRedirect) {
  report(
    "fail",
    `Backend redirects — GET ${versionUrl} -> ${version.res.status}`,
    `Location: ${versionRedirect}\n` +
      `Re-run against that origin: --url ${toOrigin(versionRedirect, "redirect")}`,
  );
  finish();
}
report("ok", `Backend reachable — GET ${versionUrl} -> ${version.res.status}`);

// 2. The app's own public API. Also proves convex/ was actually pushed here.
const providers = await convexQuery("users:authProviders");
const providerValue = providers.value;
if (providers.error) {
  report(
    "fail",
    "App functions did NOT answer — users:authProviders",
    `POST ${providers.url}\n${providers.error}`,
  );
  addFix(
    "Push convex/ to this backend",
    [
      CLI_TARGET,
      "npx convex deploy",
      "",
      "`docker compose up -d --build` runs this as the one-shot convex-deploy",
      "service; if that service failed, the backend still runs old functions.",
    ].join("\n"),
  );
} else if (typeof providerValue?.google !== "boolean") {
  report(
    "warn",
    "users:authProviders answered an unexpected shape",
    `Expected { google: boolean, password: boolean }, got ${JSON.stringify(providerValue)}`,
  );
} else {
  report("ok", "App functions deployed — users:authProviders answered");
  if (providerValue.google) {
    report(
      "ok",
      "Google sign-in configured — AUTH_GOOGLE_ID is set ON THE CONVEX DEPLOYMENT",
      "Proves Google credentials reached the Convex env plane, not just Docker.\n" +
        "It does NOT prove GOOGLE_DRIVE_* or the Picker key are set — see below.",
    );
  } else {
    report(
      "fail",
      "Google sign-in NOT configured — AUTH_GOOGLE_ID is unset on the Convex deployment",
      "This is the exact symptom of credentials set in Dokploy/Docker instead of\n" +
        "Convex. It proves AUTH_GOOGLE_ID specifically; GOOGLE_DRIVE_CLIENT_ID is a\n" +
        "separate variable this script cannot see — but if one landed in the wrong\n" +
        "plane, assume they all did.",
    );
    addFix(
      "Set the Google credentials on the CONVEX DEPLOYMENT (README §Google setup)",
      [
        CLI_TARGET,
        "",
        "npx convex env set AUTH_GOOGLE_ID <oauth-client-id>",
        "npx convex env set AUTH_GOOGLE_SECRET <oauth-client-secret>",
        "npx convex env set GOOGLE_DRIVE_CLIENT_ID <oauth-client-id>       # may reuse",
        "npx convex env set GOOGLE_DRIVE_CLIENT_SECRET <oauth-client-secret>",
        "npx convex env set GOOGLE_PICKER_API_KEY <picker-api-key>",
        ENV_PLANE_NOTE,
      ].join("\n"),
    );
  }
  if (providerValue.password === false) {
    report("info", "Password sign-in is off on this deployment");
  }
}

// 3. HTTP-actions origin. Both redirect URIs live there, so getting it exactly
//    right matters more than anything else this script prints.
let probeOrigin = null;
for (const candidate of candidates) {
  const discovery = await probe(
    `${candidate}/.well-known/openid-configuration`,
  );
  if (discovery.error || discovery.res.status !== 200) continue;
  const config = await discovery.res.json().catch(() => null);
  if (typeof config?.issuer !== "string") continue;
  probeOrigin = candidate;
  // The issuer IS the deployment's CONVEX_SITE_URL — the same value
  // redirectUri() interpolates — so trust it over our candidate.
  siteOrigin = config.issuer.replace(/\/+$/, "");
  siteConfirmed = true;
  break;
}

if (probeOrigin === null) {
  report(
    "fail",
    "HTTP-actions origin NOT reachable — the Drive OAuth callback lives there",
    `Tried: ${candidates.length > 0 ? candidates.join(", ") : "(nothing derivable from --url)"}`,
  );
  addFix(
    "Make the HTTP-actions origin reachable",
    [
      "Local dev: it is the API port + 1 (http://127.0.0.1:3211).",
      "Pilot: CONVEX_SITE_ORIGIN on the backend and the Traefik router for",
      "actions.kinolab.ai (deploy/convex-backend.compose.yml, port 3211).",
      "If it lives elsewhere, re-run with --site-url <origin>.",
    ].join("\n"),
  );
} else {
  report("ok", `HTTP-actions origin live — ${probeOrigin}`);
  if (siteOrigin !== probeOrigin) {
    const unreachableIssuer =
      !isLocalDev && isLoopback(new URL(siteOrigin).hostname);
    report(
      unreachableIssuer ? "fail" : "warn",
      `Deployment calls itself ${siteOrigin}, but answered on ${probeOrigin}`,
      "CONVEX_SITE_URL is what redirectUri() interpolates, so Google is told to\n" +
        `send the studio back to ${siteOrigin}.` +
        (unreachableIssuer
          ? " That host is loopback — the Drive\nconnect flow can never come back."
          : ""),
    );
    if (unreachableIssuer) {
      addFix(
        "Fix the backend's own site origin",
        [
          "Set CONVEX_SITE_ORIGIN to the PUBLIC HTTP-actions URL on the backend",
          "container (deploy/convex-backend.compose.yml env), then restart it.",
          "Convex derives CONVEX_SITE_URL from it and the OAuth redirect URIs",
          "follow — re-register them in the Google console afterwards.",
        ].join("\n"),
      );
    }
  }

  // JWKS proves the Convex Auth keys are set: no sign-in, no Drive connect.
  const jwks = await probe(`${probeOrigin}/.well-known/jwks.json`);
  const keySet =
    jwks.res?.status === 200 ? await jwks.res.json().catch(() => null) : null;
  if (Array.isArray(keySet?.keys) && keySet.keys.length > 0) {
    report(
      "ok",
      `Auth keys present — JWT_PRIVATE_KEY + JWKS set (${keySet.keys.length} key)`,
    );
  } else {
    report(
      "fail",
      "Auth keys missing — /.well-known/jwks.json served nothing usable",
      jwks.error ?? `HTTP ${jwks.res?.status}`,
    );
    addFix(
      "Generate the Convex Auth keypair",
      [CLI_TARGET, "node scripts/setup-auth.mjs <app-url>"].join("\n"),
    );
  }

  // The Drive callback itself. With no code/state it only redirects to the
  // app's error page — no side effects — and the Location reveals SITE_URL.
  const callbackUrl = `${probeOrigin}/google/drive/callback`;
  const callback = await probe(callbackUrl);
  const location = callback.res?.headers.get("location") ?? null;
  if (callback.error) {
    report(
      "fail",
      `Drive OAuth callback did not answer — GET ${callbackUrl}`,
      callback.error,
    );
  } else if (callback.res.status === 404) {
    report(
      "fail",
      "Drive OAuth callback route is NOT deployed — /google/drive/callback -> 404",
      "This backend runs functions without convex/drive_http.ts. Re-deploy convex/.",
    );
    addFix(
      "Push convex/ to this backend",
      [CLI_TARGET, "npx convex deploy"].join("\n"),
    );
  } else if (location === null) {
    report(
      "warn",
      `Drive OAuth callback answered ${callback.res.status} without a redirect`,
      "Expected a 302 back to the app's /drive/connected error page.",
    );
  } else {
    report(
      "ok",
      "Drive OAuth callback deployed — /google/drive/callback -> 302",
    );
    // convex/drive_http.ts falls back to http://localhost:3000 when SITE_URL is
    // unset, which strands the studio right after Google consent.
    let appOrigin = null;
    try {
      appOrigin = new URL(location).origin;
    } catch {
      report("warn", `Callback redirected somewhere unparseable: ${location}`);
    }
    if (appOrigin !== null) {
      const stranded = !isLocalDev && isLoopback(new URL(appOrigin).hostname);
      report(
        stranded ? "fail" : "ok",
        `App SITE_URL on the deployment: ${appOrigin}`,
        stranded
          ? "That is the http://localhost:3000 fallback — SITE_URL is unset, so\n" +
              "after Google consent the studio lands on a dead localhost page."
          : undefined,
      );
      if (stranded) {
        addFix(
          "Set SITE_URL to the app's public URL",
          [
            CLI_TARGET,
            "npx convex env set SITE_URL <app-url, e.g. https://pilot.kinolab.ai>",
            ENV_PLANE_NOTE,
          ].join("\n"),
        );
      }
    }
  }
}

finish();
