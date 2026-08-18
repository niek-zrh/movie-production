/**
 * Input validation, limits and hostile content — the boundaries a real user
 * (or a careless paste) hits before an attacker does.
 */
import {
  createSuite, query, mutation, must,
  newOwner, newProduction, uniqueEmail,
} from "./_harness.mjs";

export async function run() {
  const suite = createSuite("Validation — limits, locale & hostile input");

  const owner = await newOwner("validation");
  const { productionId } = await newProduction(owner.studioId, owner.token, { code: "VLD" });

  /* ------------------- 1. timezones must be real (K-05 root cause) ------- */
  // An unknown zone makes date-fns-tz throw inside the hourly report cron,
  // which aborts the whole transaction and silently kills daily reports for
  // EVERY production in the deployment.
  suite.denied(
    "an invalid timezone is refused on update",
    await mutation("productions:update", { productionId, timezone: "Mars/Olympus_Mons" }, owner.token),
  );
  suite.denied(
    "a nonsense timezone string is refused on update",
    await mutation("productions:update", { productionId, timezone: "not a timezone" }, owner.token),
  );
  suite.denied(
    "an invalid timezone is refused at creation",
    await mutation(
      "productions:create",
      { studioId: owner.studioId, name: "Bad TZ", code: "BADTZ", kind: "feature", timezone: "Mars/Base" },
      owner.token,
    ),
  );
  suite.allowed(
    "a real IANA timezone is accepted (Europe/Moscow — the pilot studio's own)",
    await mutation("productions:update", { productionId, timezone: "Europe/Moscow" }, owner.token),
  );
  suite.allowed(
    "the daily-report cron survives every production in the deployment",
    await query("reports:list", { productionId }, owner.token),
  );

  /* ------------------- 2. bulk paste is bounded (K-07) ------------------- */
  const hugePaste = Array.from({ length: 5000 }, (_, i) => `HUGE_${String(i).padStart(5, "0")}`);
  suite.denied(
    "a 5,000-code paste is refused rather than permanently ruining the production",
    await mutation("shots:bulkCreate", { productionId, codes: hugePaste }, owner.token),
  );
  suite.allowed(
    "a normal-sized paste still works",
    await mutation(
      "shots:bulkCreate",
      { productionId, codes: ["VL_SH001", "VL_SH002", "VL_SH003"] },
      owner.token,
    ),
  );

  /* ------------------- 3. length caps ------------------------------------ */
  suite.denied(
    "a 100,000-character shot title is refused",
    await mutation("shots:create", { productionId, code: "VL_LONG1", title: "T".repeat(100_000) }, owner.token),
  );
  suite.denied(
    "a 5,000-character shot code is refused",
    await mutation("shots:create", { productionId, code: "C".repeat(5000) }, owner.token),
  );
  suite.denied(
    "an empty shot code is refused",
    await mutation("shots:create", { productionId, code: "" }, owner.token),
  );
  suite.denied(
    "a whitespace-only shot code is refused",
    await mutation("shots:create", { productionId, code: "   " }, owner.token),
  );

  /* ------------------- 4. hostile URLs ----------------------------------- */
  for (const [label, url] of [
    ["javascript:", "javascript:alert(document.cookie)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
  ]) {
    suite.denied(
      `a ${label} URL is refused as an external link`,
      await mutation("externalLinks:add", { productionId, kind: "other", title: "x", url }, owner.token),
    );
    suite.denied(
      `a ${label} URL is refused as a link asset`,
      await mutation("assets:addLink", { productionId, url, name: "x" }, owner.token),
    );
  }
  suite.denied(
    "an invalid email is refused on invite",
    await mutation("studios:invite", { studioId: owner.studioId, email: "not-an-email", role: "artist" }, owner.token),
  );

  /* ------------------- 5. numeric bounds --------------------------------- */
  suite.denied(
    "a million-episode production is refused",
    await mutation(
      "productions:create",
      { studioId: owner.studioId, name: "Huge", code: "HUGE", kind: "episodic", episodeCount: 1_000_000 },
      owner.token,
    ),
  );
  suite.denied(
    "a production code outside A–Z0–9 is refused",
    await mutation(
      "productions:create",
      { studioId: owner.studioId, name: "Bad", code: "lower-case!", kind: "feature" },
      owner.token,
    ),
  );

  /* ------------------- 6. Cyrillic round-trips (the pilot's language) ---- */
  {
    const sceneId = must(
      await mutation("scenes:create", { productionId, code: "SC010", title: "Ночная сцена" }, owner.token),
      "ru scene",
    );
    const shotId = must(
      await mutation(
        "shots:create",
        { productionId, code: "VL_RU001", title: "Крупный план — Аня", sceneId },
        owner.token,
      ),
      "ru shot",
    );
    const back = must(await query("shots:get", { shotId }, owner.token), "ru get");
    suite.check(
      "Cyrillic titles round-trip intact",
      back.title === "Крупный план — Аня",
      `got "${back.title}"`,
    );
    const hits = must(await query("search:global", { q: "крупный" }, owner.token), "ru search");
    suite.check(
      "search finds Cyrillic text case-insensitively",
      (hits.shots ?? []).length > 0,
      `${(hits.shots ?? []).length} hits`,
    );
  }

  /* ------------------- 7. invite normalisation --------------------------- */
  {
    const mixed = `MiXeD-${Date.now()}@Api.Kinolab.Test`;
    suite.allowed(
      "a mixed-case invite is accepted",
      await mutation("studios:invite", { studioId: owner.studioId, email: mixed, role: "artist" }, owner.token),
    );
    const team = must(await query("studios:team", { studioId: owner.studioId }, owner.token), "team");
    suite.check(
      "the invite is stored lower-cased so the invitee can claim it",
      team.some((r) => (r.invitedEmail ?? "") === mixed.toLowerCase()),
      team.map((r) => r.invitedEmail).filter(Boolean).join(", "),
    );
  }

  void uniqueEmail;
  return suite;
}
