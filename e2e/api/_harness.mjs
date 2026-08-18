/**
 * Shared harness for the API-level regression suite.
 *
 * Convex query/mutation/action endpoints are public HTTP: the browser UI's
 * role gating is irrelevant to anyone holding a session token. These tests
 * therefore talk to the backend directly, the way an attacker (or a curious
 * artist with devtools open) would, and assert what the SERVER does.
 *
 * Requires the dev backend to be running (`pnpm dev`).
 */

export const CONVEX_URL = process.env.CONVEX_URL ?? "http://localhost:3210";
export const PASSWORD = "kinolab-api-test-password-1";

/* ------------------------------- transport ------------------------------- */

export async function rpc(kind, path, args, token) {
  const res = await fetch(`${CONVEX_URL}/api/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ path, args: args ?? {}, format: "json" }),
  });
  const json = await res.json().catch(() => ({ status: "transport-error" }));
  if (json.status === "success") return { ok: true, value: json.value };
  return {
    ok: false,
    error: String(json.errorData ?? json.errorMessage ?? JSON.stringify(json))
      .replace(/\s+/g, " ")
      .slice(0, 220),
  };
}

export const query = (path, args, token) => rpc("query", path, args, token);
export const mutation = (path, args, token) => rpc("mutation", path, args, token);
export const action = (path, args, token) => rpc("action", path, args, token);

/** Unwrap a call that is expected to succeed; throws with context if it did not. */
export function must(result, what) {
  if (!result.ok) throw new Error(`setup failed (${what}): ${result.error}`);
  return result.value;
}

/* ------------------------------- accounts -------------------------------- */

let seq = 0;
export function uniqueEmail(tag) {
  seq += 1;
  return `${tag}-${Date.now()}-${seq}@api.kinolab.test`;
}

export async function signUp(email, name = "API Test") {
  const r = await action("auth:signIn", {
    provider: "password",
    params: { email, password: PASSWORD, flow: "signUp", name },
  });
  return r.ok ? { ok: true, token: r.value.tokens.token } : r;
}

export async function signIn(email) {
  const r = await action("auth:signIn", {
    provider: "password",
    params: { email, password: PASSWORD, flow: "signIn" },
  });
  return r.ok ? { ok: true, token: r.value.tokens.token } : r;
}

/** A brand-new user who owns a brand-new studio. */
export async function newOwner(tag) {
  const email = uniqueEmail(tag);
  const up = await signUp(email, `${tag} owner`);
  if (!up.ok) throw new Error(`signUp(${email}): ${up.error}`);
  const token = up.token;
  const userId = must(await query("users:viewer", {}, token), "viewer")._id;
  const studioId = must(
    await mutation("studios:create", { name: `${tag} studio ${Date.now()}` }, token),
    "studios:create",
  );
  return { email, token, userId, studioId };
}

/** Invite `role` into `studioId` and sign the invitee up so the invite is claimed. */
export async function addMember(studioId, ownerToken, role, tag = role) {
  const email = uniqueEmail(tag);
  must(
    await mutation("studios:invite", { studioId, email, role }, ownerToken),
    `invite ${role}`,
  );
  const up = await signUp(email, `${tag} user`);
  if (!up.ok) throw new Error(`signUp(${email}): ${up.error}`);
  const userId = must(await query("users:viewer", {}, up.token), "viewer")._id;
  return { email, token: up.token, userId, role };
}

/* ------------------------------- fixtures -------------------------------- */

const PNG_8x8 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAGklEQVR4nGP8z8Dwn4GBgYGJAQowMTAwMAAAJgYBLZ01WQAAAABJRU5ErkJggg==";

/** Upload one small PNG as a new version of `shotId`. Returns { versionId, index }. */
export async function uploadVersion(productionId, shotId, token, name = "option.png") {
  const url = must(
    await mutation("versions:generateUploadUrl", { productionId }, token),
    "generateUploadUrl",
  );
  const bytes = Buffer.from(PNG_8x8, "base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: bytes,
  });
  const { storageId } = await res.json();
  return must(
    await mutation(
      "versions:addFromUpload",
      { shotId, storageId, name, mimeType: "image/png", sizeBytes: bytes.length },
      token,
    ),
    "addFromUpload",
  );
}

/** A production with a scene and `codes.length` shots. */
export async function newProduction(studioId, token, opts = {}) {
  const productionId = must(
    await mutation(
      "productions:create",
      {
        studioId,
        name: opts.name ?? "Test Production",
        code: opts.code ?? "TST",
        kind: opts.kind ?? "feature",
        ...(opts.episodeCount ? { episodeCount: opts.episodeCount } : {}),
      },
      token,
    ),
    "productions:create",
  );
  const stages = must(
    await query("productions:listStages", { productionId }, token),
    "listStages",
  );
  return { productionId, stages };
}

/* ------------------------------- assertions ------------------------------ */

export function createSuite(title) {
  const results = [];
  const suite = {
    title,
    results,
    /** Record a boolean assertion. */
    check(name, pass, detail = "") {
      results.push({ name, pass, detail });
      const mark = pass ? "  ok  " : "  FAIL";
      console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
      return pass;
    },
    /** The call must have been refused by the server. */
    denied(name, result) {
      return suite.check(
        name,
        !result.ok,
        result.ok ? "ALLOWED — the server permitted this" : `refused: ${result.error.slice(0, 70)}`,
      );
    },
    /** The call must have succeeded. */
    allowed(name, result) {
      return suite.check(name, result.ok, result.ok ? "" : `refused: ${result.error.slice(0, 90)}`);
    },
  };
  return suite;
}

export function report(suites) {
  const all = suites.flatMap((s) => s.results.map((r) => ({ ...r, suite: s.title })));
  const failed = all.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(78));
  for (const s of suites) {
    const f = s.results.filter((r) => !r.pass).length;
    const line = `${s.title.padEnd(46)} ${String(s.results.length).padStart(3)} checks`;
    console.log(`${f === 0 ? "PASS" : "FAIL"}  ${line}  ${f === 0 ? "" : `${f} failed`}`);
  }
  console.log("=".repeat(78));
  console.log(`${all.length} checks, ${failed.length} failed`);
  for (const f of failed) console.log(`  !! [${f.suite}] ${f.name} — ${f.detail}`);
  return failed.length;
}
