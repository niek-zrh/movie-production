/**
 * Data integrity: concurrency invariants and the stage-gate state machine.
 *
 * Every check here fires genuinely concurrent requests (or a deliberately
 * awkward sequence) and then asserts the PERSISTED state is still coherent —
 * a toast is not proof that a mutation committed.
 */
import {
  createSuite, query, mutation, must,
  newOwner, addMember, newProduction, uploadVersion,
} from "./_harness.mjs";

export async function run() {
  const suite = createSuite("Data integrity — concurrency & state machine");

  const owner = await newOwner("integrity");
  const { productionId, stages } = await newProduction(owner.studioId, owner.token, {
    code: "INTG",
  });
  const stageInstanceId = stages[0]._id;
  const second = await addMember(owner.studioId, owner.token, "producer", "second-producer");

  const newShot = async (code) =>
    must(await mutation("shots:create", { productionId, code }, owner.token), `shot ${code}`);

  /* ------------------- 1. simultaneous picks of two versions ------------- */
  {
    const shotId = await newShot("IN_SH001");
    const a = await uploadVersion(productionId, shotId, owner.token, "a.png");
    const b = await uploadVersion(productionId, shotId, owner.token, "b.png");
    await Promise.all([
      mutation("versions:pick", { versionId: a.versionId, note: "A" }, owner.token),
      mutation("versions:pick", { versionId: b.versionId, note: "B" }, second.token),
    ]);
    const versions = must(await query("versions:listForShot", { shotId }, owner.token), "versions");
    const shot = must(await query("shots:get", { shotId }, owner.token), "shot");
    const picked = versions.filter((v) => v.status === "picked");
    suite.check(
      "two simultaneous picks leave exactly one picked version",
      picked.length === 1,
      versions.map((v) => `v${v.index}:${v.status}`).join(" "),
    );
    suite.check(
      "the shot points at the version that won",
      picked.length === 1 && shot.pickedVersionId === picked[0]._id,
      `shot.pickedVersionId=${shot.pickedVersionId}`,
    );
  }

  /* ------------------- 2. double-clicked pick --------------------------- */
  {
    const shotId = await newShot("IN_SH002");
    const a = await uploadVersion(productionId, shotId, owner.token, "a.png");
    await uploadVersion(productionId, shotId, owner.token, "b.png");
    await Promise.all([
      mutation("versions:pick", { versionId: a.versionId, note: "click" }, owner.token),
      mutation("versions:pick", { versionId: a.versionId, note: "click" }, owner.token),
    ]);
    const ledger = must(await query("approvals:ledger", { productionId }, owner.token), "ledger");
    suite.check(
      "a double-clicked pick records one approval row, not two",
      ledger.filter((r) => r.targetId === a.versionId).length === 1,
      `${ledger.filter((r) => r.targetId === a.versionId).length} rows`,
    );
    const feed = must(
      await query("activity:feed", { productionId, types: ["version.picked"] }, owner.token),
      "feed",
    );
    suite.check(
      "a double-clicked pick logs one activity row, not two",
      feed.filter((f) => f.targetId === a.versionId).length === 1,
      `${feed.filter((f) => f.targetId === a.versionId).length} rows`,
    );
  }

  /* ------------------- 3. concurrent uploads ---------------------------- */
  {
    const shotId = await newShot("IN_SH003");
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        uploadVersion(productionId, shotId, i % 2 ? owner.token : second.token, `c${i}.png`),
      ),
    );
    const versions = must(await query("versions:listForShot", { shotId }, owner.token), "versions");
    const indexes = versions.map((v) => v.index).sort((x, y) => x - y);
    suite.check(
      "six concurrent uploads produce six contiguous version numbers",
      indexes.join(",") === "1,2,3,4,5,6",
      `v[${indexes.join(",")}]`,
    );
    const shot = must(await query("shots:get", { shotId }, owner.token), "shot");
    suite.check(
      "the denormalised versionsCount matches the real version count",
      shot.versionsCount === versions.length,
      `versionsCount=${shot.versionsCount} actual=${versions.length}`,
    );
  }

  /* ------------------- 4. duplicate shot codes -------------------------- */
  {
    const codes = ["IN_DUP001", "IN_DUP002"];
    await Promise.all([
      mutation("shots:bulkCreate", { productionId, codes }, owner.token),
      mutation("shots:bulkCreate", { productionId, codes }, second.token),
    ]);
    const shots = must(await query("shots:list", { productionId }, owner.token), "shots");
    const dup = codes.filter((c) => shots.filter((s) => s.code === c).length > 1);
    suite.check("concurrent identical bulk-creates create no duplicate codes", dup.length === 0, `dups=[${dup}]`);

    const [r1, r2] = await Promise.all([
      mutation("shots:create", { productionId, code: "IN_SOLO" }, owner.token),
      mutation("shots:create", { productionId, code: "IN_SOLO" }, second.token),
    ]);
    const solo = must(await query("shots:list", { productionId }, owner.token), "shots2").filter(
      (s) => s.code === "IN_SOLO",
    );
    suite.check("concurrent creates of one code yield exactly one shot", solo.length === 1, `count=${solo.length}`);
    void r1; void r2;
  }

  /* ------------------- 5. the stage-gate state machine (K-09) ----------- */
  {
    must(
      await mutation(
        "productions:setGateApprovers",
        { stageInstanceId, approverIds: [owner.userId, second.userId] },
        owner.token,
      ),
      "approvers",
    );
    const stageNow = async () =>
      must(await query("productions:listStages", { productionId }, owner.token), "stages").find(
        (s) => s._id === stageInstanceId,
      );

    must(await mutation("approvals:requestGateSignoff", { stageInstanceId }, owner.token), "request");
    must(
      await mutation(
        "approvals:decideGate",
        { stageInstanceId, decision: "approved", note: "looks good" },
        owner.token,
      ),
      "approve",
    );
    const approved = await stageNow();
    suite.check(
      "approving a gate completes the stage",
      approved.gateStatus === "approved" && approved.status === "done",
      `gate=${approved.gateStatus} stage=${approved.status}`,
    );

    // Re-opening the gate must take the stage back out of "done".
    must(await mutation("approvals:requestGateSignoff", { stageInstanceId }, owner.token), "re-request");
    const reRequested = await stageNow();
    suite.check(
      "re-requesting sign-off takes the stage back out of done",
      reRequested.gateStatus === "requested" && reRequested.status !== "done",
      `gate=${reRequested.gateStatus} stage=${reRequested.status}`,
    );

    must(
      await mutation(
        "approvals:decideGate",
        { stageInstanceId, decision: "rejected", note: "actually no, redo it" },
        owner.token,
      ),
      "reject",
    );
    const rejected = await stageNow();
    suite.check(
      "a REJECTED gate never leaves the stage showing as done",
      rejected.gateStatus === "rejected" && rejected.status !== "done",
      `gate=${rejected.gateStatus} stage=${rejected.status}`,
    );

    const ledger = must(
      await query("approvals:ledger", { productionId, scope: "stage_gate" }, owner.token),
      "gate ledger",
    );
    suite.check(
      "no approval row is left pending once the gate is decided",
      ledger.filter((r) => r.targetId === stageInstanceId && r.status === "pending").length === 0,
      "",
    );

    // A second decider must not silently overturn a decided gate.
    const second_decision = await mutation(
      "approvals:decideGate",
      { stageInstanceId, decision: "approved" },
      second.token,
    );
    const afterSecond = await stageNow();
    suite.check(
      "a decided gate cannot be silently overturned, and never ends up incoherent",
      !second_decision.ok ||
        (afterSecond.gateStatus === "approved") === (afterSecond.status === "done"),
      `second decision ${second_decision.ok ? "accepted" : "refused"} → gate=${afterSecond.gateStatus} stage=${afterSecond.status}`,
    );
  }

  /* ------------------- 6. reports ---------------------------------------- */
  {
    await Promise.all([
      mutation("reports:generateNow", { productionId }, owner.token),
      mutation("reports:generateNow", { productionId }, second.token),
      mutation("reports:generateNow", { productionId }, owner.token),
    ]);
    const reports = must(await query("reports:list", { productionId }, owner.token), "reports");
    const byDate = {};
    for (const r of reports) byDate[r.date] = (byDate[r.date] ?? 0) + 1;
    suite.check(
      "three concurrent 'Generate now' calls leave one report per day",
      Object.values(byDate).every((n) => n === 1),
      JSON.stringify(byDate),
    );

    const reportId = reports[0]._id;
    await Promise.all([
      mutation("reports:publish", { reportId }, owner.token),
      mutation("reports:publish", { reportId }, second.token),
    ]);
    const feed = must(
      await query("activity:feed", { productionId, types: ["report.published"] }, owner.token),
      "pub feed",
    );
    suite.check(
      "publishing twice notifies once",
      feed.filter((f) => f.targetId === reportId).length === 1,
      `${feed.filter((f) => f.targetId === reportId).length} rows`,
    );
  }

  /* ------------------- 7. status invariants ------------------------------ */
  {
    const shotId = await newShot("IN_SH011");
    suite.denied(
      "a shot cannot be approved with no picked version",
      await mutation("shots:setStatus", { shotId, status: "approved" }, owner.token),
    );
    const sceneId = must(
      await mutation("scenes:create", { productionId, code: "SC099" }, owner.token),
      "scene",
    );
    must(
      await mutation("shots:create", { productionId, code: "SC099_SH001", sceneId }, owner.token),
      "scene shot",
    );
    suite.denied(
      "a scene that still has shots cannot be deleted",
      await mutation("scenes:remove", { sceneId }, owner.token),
    );
  }

  /* ------------------- 8. shots can be removed again (K-07) -------------- */
  {
    const throwaway = must(
      await mutation("shots:bulkCreate", { productionId, codes: ["IN_TMP001", "IN_TMP002"] }, owner.token),
      "temp shots",
    );
    void throwaway;
    const shots = must(await query("shots:list", { productionId }, owner.token), "shots");
    const tmp = shots.filter((s) => s.code.startsWith("IN_TMP"));
    const removal = await mutation("shots:remove", { shotId: tmp[0]._id }, owner.token);
    suite.allowed("a mis-pasted shot with no versions can be deleted", removal);
    if (removal.ok) {
      const after = must(await query("shots:list", { productionId }, owner.token), "shots after");
      suite.check(
        "the deleted shot is gone from the list",
        !after.some((s) => s._id === tmp[0]._id),
        "",
      );
    }
    // A shot carrying real work must not be silently destroyable.
    const withWork = await newShot("IN_WORK001");
    await uploadVersion(productionId, withWork, owner.token, "work.png");
    suite.denied(
      "a shot that already has versions cannot be silently deleted",
      await mutation("shots:remove", { shotId: withWork }, owner.token),
    );
  }

  return suite;
}
