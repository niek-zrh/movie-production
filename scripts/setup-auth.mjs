#!/usr/bin/env node
/**
 * Generates the RS256 keypair Convex Auth needs and stores it on the active
 * Convex deployment (JWT_PRIVATE_KEY + JWKS), plus SITE_URL.
 * Usage: node scripts/setup-auth.mjs [site-url]
 */
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";

const siteUrl = process.argv[2] ?? "http://localhost:3000";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pkcs8 = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString()
  .trimEnd()
  .replace(/\n/g, " ");
const jwk = publicKey.export({ format: "jwk" });
const jwks = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });

const env = { ...process.env, CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous" };
const run = (args) =>
  execFileSync("npx", ["convex", "env", "set", "--", ...args], {
    stdio: "inherit",
    env,
  });

run(["JWT_PRIVATE_KEY", pkcs8]);
run(["JWKS", jwks]);
run(["SITE_URL", siteUrl]);
console.log(`\nAuth keys set. SITE_URL=${siteUrl}`);
