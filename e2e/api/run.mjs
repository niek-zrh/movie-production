/**
 * API-level regression suite — run with `pnpm test:api` (dev servers running).
 *
 * These tests talk to the Convex backend directly rather than through the
 * browser, because Convex functions are public HTTP endpoints: what the UI
 * chooses to show is not a security boundary. Everything here asserts what
 * the SERVER does.
 *
 * Each file covers one axis:
 *   authz.mjs      six-role capability matrix, cross-tenant isolation, offboarding
 *   integrity.mjs  concurrency invariants and the stage-gate state machine
 *   validation.mjs limits, locale and hostile input
 */
import { CONVEX_URL, report } from "./_harness.mjs";
import { run as authz } from "./authz.mjs";
import { run as integrity } from "./integrity.mjs";
import { run as validation } from "./validation.mjs";

const health = await fetch(`${CONVEX_URL}/version`).catch(() => null);
if (!health || !health.ok) {
  console.error(
    `Cannot reach the Convex backend at ${CONVEX_URL}.\n` +
      `Start the dev servers first (pnpm dev), or set CONVEX_URL.`,
  );
  process.exit(2);
}

const suites = [];
for (const [name, fn] of [
  ["Authorization", authz],
  ["Data integrity", integrity],
  ["Validation", validation],
]) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
  try {
    suites.push(await fn());
  } catch (err) {
    console.error(`\n!! ${name} suite could not run: ${err.message}`);
    suites.push({
      title: `${name} (crashed)`,
      results: [{ name: "suite executed", pass: false, detail: err.message }],
    });
  }
}

process.exit(report(suites) === 0 ? 0 : 1);
