/**
 * Authorization: the full six-role capability matrix, cross-tenant isolation,
 * and the endpoints that must never be reachable without a session.
 *
 * The browser suite can only assert that the UI hides a control. These tests
 * assert that the SERVER refuses — which is where the studio-takeover bug
 * (a producer granting themselves the owner role) was hiding.
 */
import {
  createSuite, query, mutation, action, must,
  newOwner, addMember, newProduction, uploadVersion, uniqueEmail, signUp,
} from "./_harness.mjs";

export async function run() {
  const suite = createSuite("Authorization — role matrix & tenancy");

  /* ---------------------------------------------------------------- setup */
  const owner = await newOwner("authz");
  const { productionId, stages } = await newProduction(owner.studioId, owner.token, {
    code: "AUTHZ",
  });
  const stageInstanceId = stages[0]._id;

  const producer = await addMember(owner.studioId, owner.token, "producer");
  const director = await addMember(owner.studioId, owner.token, "creative_director");
  const supervisor = await addMember(owner.studioId, owner.token, "supervisor");
  const artist = await addMember(owner.studioId, owner.token, "artist");
  const viewer = await addMember(owner.studioId, owner.token, "viewer");

  const sceneId = must(
    await mutation("scenes:create", { productionId, code: "SC010" }, owner.token),
    "scene",
  );
  const ownShotId = must(
    await mutation(
      "shots:create",
      { productionId, code: "SC010_SH010", sceneId, assigneeId: artist.userId },
      owner.token,
    ),
    "own shot",
  );
  const otherShotId = must(
    await mutation("shots:create", { productionId, code: "SC010_SH020", sceneId }, owner.token),
    "other shot",
  );
  const ownVersion = await uploadVersion(productionId, ownShotId, artist.token, "a.png");
  await uploadVersion(productionId, ownShotId, artist.token, "b.png");

  /* ======================= 1. studio takeover (K-01) ===================== */
  // A producer holds `studio.manage`, so the capability check passes. Nothing
  // may let them grant themselves — or anyone — a role above their own.
  const team = must(await query("studios:team", { studioId: owner.studioId }, owner.token), "team");
  const rowFor = (userId) => team.find((r) => r.userId === userId);

  suite.denied(
    "a producer cannot promote themselves to owner",
    await mutation(
      "studios:updateMember",
      { membershipId: rowFor(producer.userId)._id, role: "owner" },
      producer.token,
    ),
  );
  suite.denied(
    "a producer cannot promote another member to owner",
    await mutation(
      "studios:updateMember",
      { membershipId: rowFor(artist.userId)._id, role: "owner" },
      producer.token,
    ),
  );
  suite.denied(
    "a producer cannot invite a new owner",
    await mutation(
      "studios:invite",
      { studioId: owner.studioId, email: uniqueEmail("evil"), role: "owner" },
      producer.token,
    ),
  );
  suite.denied(
    "a producer cannot demote the owner",
    await mutation(
      "studios:updateMember",
      { membershipId: rowFor(owner.userId)._id, role: "viewer" },
      producer.token,
    ),
  );
  suite.denied(
    "a producer cannot remove the owner",
    await mutation(
      "studios:removeMember",
      { membershipId: rowFor(owner.userId)._id },
      producer.token,
    ),
  );
  suite.allowed(
    "the owner still has access to their own studio afterwards",
    await query("studios:get", { studioId: owner.studioId }, owner.token),
  );
  suite.allowed(
    "a producer can still do their real job (invite an artist)",
    await mutation(
      "studios:invite",
      { studioId: owner.studioId, email: uniqueEmail("legit"), role: "artist" },
      producer.token,
    ),
  );

  /* ==================== 2. the six-role capability matrix ================ */
  // Each role attempts every capability it must NOT have. Expectations follow
  // ROLE_CAPS in convex/lib/permissions.ts and spec §3.
  const cases = [
    // creative_director: no studio.manage, no production.manage, no report.publish
    ["creative director", director.token, [
      ["invite a member", "mutation", "studios:invite", { studioId: owner.studioId, email: uniqueEmail("cd"), role: "artist" }],
      ["seed the QC template", "mutation", "qc:seedDefaultTemplate", { studioId: owner.studioId }],
      ["rename the production", "mutation", "productions:update", { productionId, name: "CD" }],
      ["set gate approvers", "mutation", "productions:setGateApprovers", { stageInstanceId, approverIds: [director.userId] }],
      ["add an external link", "mutation", "externalLinks:add", { productionId, kind: "other", title: "x", url: "https://e.example.com" }],
    ]],
    // supervisor: no studio.manage, no production.manage, no report.publish, no gate.decide
    ["supervisor", supervisor.token, [
      ["invite a member", "mutation", "studios:invite", { studioId: owner.studioId, email: uniqueEmail("sv"), role: "artist" }],
      ["rename the production", "mutation", "productions:update", { productionId, name: "SV" }],
      ["publish a report", "mutation", "reports:generateNow", { productionId }],
      ["approve the stage gate", "mutation", "approvals:decideGate", { stageInstanceId, decision: "approved" }],
    ]],
    // artist: version.create + comment.create only, and content.edit on own shots
    ["artist", artist.token, [
      ["invite a member", "mutation", "studios:invite", { studioId: owner.studioId, email: uniqueEmail("ar"), role: "artist" }],
      ["create a shot", "mutation", "shots:create", { productionId, code: "ART_SH001" }],
      ["edit someone else's shot", "mutation", "shots:update", { shotId: otherShotId, title: "nope" }],
      ["pick their own version", "mutation", "versions:pick", { versionId: ownVersion.versionId }],
      ["approve the stage gate", "mutation", "approvals:decideGate", { stageInstanceId, decision: "approved" }],
      ["start a QC run", "mutation", "qc:createRun", { productionId, name: "nope" }],
      ["publish a report", "mutation", "reports:generateNow", { productionId }],
    ]],
    // viewer: comment.create only
    ["viewer", viewer.token, [
      ["create a shot", "mutation", "shots:create", { productionId, code: "VW_SH001" }],
      ["upload a version", "mutation", "versions:generateUploadUrl", { productionId }],
      ["pick a version", "mutation", "versions:pick", { versionId: ownVersion.versionId }],
      ["invite a member", "mutation", "studios:invite", { studioId: owner.studioId, email: uniqueEmail("vw"), role: "artist" }],
      ["start a QC run", "mutation", "qc:createRun", { productionId, name: "nope" }],
    ]],
  ];
  for (const [label, token, attempts] of cases) {
    for (const [what, kind, path, args] of attempts) {
      suite.denied(`${label} cannot ${what}`, await rpcByKind(kind, path, args, token));
    }
  }

  // …and the capabilities each role MUST retain.
  suite.allowed("artist can upload to a shot", await mutation("versions:generateUploadUrl", { productionId }, artist.token));
  suite.allowed("artist can comment", await mutation("comments:add", { productionId, targetType: "shot", targetId: ownShotId, body: "wip", mentions: [] }, artist.token));
  suite.allowed("viewer can read the production", await query("productions:get", { productionId }, viewer.token));
  suite.allowed("viewer can comment", await mutation("comments:add", { productionId, targetType: "shot", targetId: ownShotId, body: "looks good", mentions: [] }, viewer.token));
  suite.allowed("creative director can decide a version", await mutation("versions:shortlist", { versionId: ownVersion.versionId }, director.token));
  suite.allowed("producer can publish a report", await mutation("reports:generateNow", { productionId }, producer.token));

  /* ================= 3. supervisor scope (self-assignment) ============== */
  // A supervisor must not be able to grant themselves decision rights by
  // assigning a shot to themselves.
  const svShot = must(
    await mutation("shots:create", { productionId, code: "SC010_SH030", sceneId }, owner.token),
    "sv shot",
  );
  const svVersion = await uploadVersion(productionId, svShot, owner.token, "sv.png");
  await mutation("shots:update", { shotId: svShot, assigneeId: supervisor.userId }, supervisor.token);
  suite.denied(
    "a supervisor cannot self-assign a shot to gain decision rights over it",
    await mutation("versions:pick", { versionId: svVersion.versionId }, supervisor.token),
  );

  /* ==================== 4. cross-tenant isolation ======================== */
  const stranger = await newOwner("stranger");
  const reads = [
    ["studios:get", { studioId: owner.studioId }],
    ["studios:team", { studioId: owner.studioId }],
    ["productions:get", { productionId }],
    ["productions:listForStudio", { studioId: owner.studioId }],
    ["shots:list", { productionId }],
    ["shots:get", { shotId: ownShotId }],
    ["versions:listForShot", { shotId: ownShotId }],
    ["assets:listForShot", { shotId: ownShotId }],
    ["comments:list", { targetType: "shot", targetId: ownShotId }],
    ["activity:feed", { productionId }],
    ["approvals:ledger", { productionId }],
    ["reports:list", { productionId }],
    ["qc:listRuns", { productionId }],
    ["externalLinks:list", { productionId }],
  ];
  for (const [path, args] of reads) {
    suite.denied(`a stranger cannot read ${path}`, await query(path, args, stranger.token));
    suite.denied(`an anonymous caller cannot read ${path}`, await query(path, args, null));
  }
  const writes = [
    ["shots:create", { productionId, code: "PWN_SH001" }],
    ["shots:update", { shotId: ownShotId, title: "PWNED" }],
    ["versions:pick", { versionId: ownVersion.versionId }],
    ["comments:add", { productionId, targetType: "shot", targetId: ownShotId, body: "x", mentions: [] }],
    ["productions:update", { productionId, name: "PWNED" }],
    ["approvals:decideGate", { stageInstanceId, decision: "approved" }],
  ];
  for (const [path, args] of writes) {
    suite.denied(`a stranger cannot write via ${path}`, await mutation(path, args, stranger.token));
    suite.denied(`an anonymous caller cannot write via ${path}`, await mutation(path, args, null));
  }
  const search = await query("search:global", { q: "SC010" }, stranger.token);
  suite.check(
    "global search never returns another studio's shots",
    search.ok && (search.value.shots ?? []).length === 0,
    search.ok ? `${(search.value.shots ?? []).length} shots returned` : search.error,
  );

  /* ======================= 5. seed:run must be internal (K-03) ========== */
  suite.denied(
    "seed:run is not callable by an anonymous internet user",
    await action("seed:run", {}, null),
  );
  suite.denied(
    "seed:run is not callable by an authenticated user either",
    await action("seed:run", {}, stranger.token),
  );

  /* ======================= 6. offboarding revokes access ================ */
  const leaverRow = must(
    await query("studios:team", { studioId: owner.studioId }, owner.token),
    "team2",
  ).find((r) => r.userId === artist.userId);
  must(await mutation("studios:removeMember", { membershipId: leaverRow._id }, owner.token), "remove");
  suite.denied(
    "a removed member's existing token can no longer read the production",
    await query("productions:get", { productionId }, artist.token),
  );
  suite.denied(
    "a removed member can no longer upload",
    await mutation("versions:generateUploadUrl", { productionId }, artist.token),
  );
  const leftShot = await query("shots:get", { shotId: ownShotId }, owner.token);
  suite.check(
    "a removed member is no longer left assigned to their shots",
    leftShot.ok && !leftShot.value.assignee,
    leftShot.ok
      ? leftShot.value.assignee
        ? `still assigned to "${leftShot.value.assignee.name}"`
        : "unassigned"
      : leftShot.error,
  );
  const keptVersions = await query("versions:listForShot", { shotId: ownShotId }, owner.token);
  suite.check(
    "a removed member's uploaded work and attribution survive",
    keptVersions.ok &&
      keptVersions.value.length > 0 &&
      keptVersions.value[0].createdByUser?.name &&
      keptVersions.value[0].createdByUser.name !== "Unknown",
    keptVersions.ok ? `${keptVersions.value.length} versions, createdBy "${keptVersions.value[0]?.createdByUser?.name}"` : keptVersions.error,
  );

  return suite;
}

function rpcByKind(kind, path, args, token) {
  return kind === "query" ? query(path, args, token) : mutation(path, args, token);
}
