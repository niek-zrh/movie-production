import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCan,
  assertCanForProduction,
  assertMember,
  assertMemberForProduction,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notify } from "./lib/notify";

// ---------------------------------------------------------------------------
// Validators & shared shapes
// ---------------------------------------------------------------------------

const qcCategory = v.union(
  v.literal("video"),
  v.literal("audio"),
  v.literal("container"),
  v.literal("content"),
  v.literal("metadata"),
);

const checkResult = v.union(
  v.literal("pending"),
  v.literal("pass"),
  v.literal("fail"),
  v.literal("na"),
);

type QcCategory = "video" | "audio" | "container" | "content" | "metadata";

/** Enriched user shape used across returns (CONTRACTS.md). */
type UserRef = { _id: Id<"users">; name: string; image?: string };

async function userRef(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<UserRef> {
  const user = await ctx.db.get(userId);
  return {
    _id: userId,
    name: user?.name ?? user?.email ?? "Unknown",
    image: user?.image,
  };
}

// ---------------------------------------------------------------------------
// Default QC template (spec §12) — seeded per studio, order as listed.
// required defaults to true unless noted.
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATE: {
  category: QcCategory;
  name: string;
  spec: string;
  tolerance?: string;
  required?: boolean;
}[] = [
  // Container
  {
    category: "container",
    name: "Container",
    spec: "MXF OP1a (or ProRes .mov per channel spec)",
  },
  {
    category: "container",
    name: "Filename convention",
    spec: "{CODE}_{EP}_MASTER_v{n}",
  },
  {
    category: "container",
    name: "MD5 checksum delivered",
    spec: "Checksum file accompanies master",
  },
  { category: "container", name: "Start timecode", spec: "10:00:00:00" },
  {
    category: "container",
    name: "Head: black before program",
    spec: "1s black",
  },
  {
    category: "container",
    name: "Duration matches slate",
    spec: "±1 frame",
    tolerance: "±1 frame",
  },
  // Video
  { category: "video", name: "Codec", spec: "XDCAM HD 50 / ProRes 422 HQ" },
  { category: "video", name: "Resolution", spec: "3840×2160" },
  { category: "video", name: "Frame rate", spec: "25p" },
  { category: "video", name: "Scan", spec: "Progressive" },
  { category: "video", name: "Color space", spec: "Rec.709, gamma 2.4" },
  { category: "video", name: "Video bitrate", spec: "Within channel spec" },
  {
    category: "video",
    name: "No dropped/frozen frames",
    spec: "None present",
  },
  {
    category: "video",
    name: "No visible upscaling artifacts",
    spec: "None visible",
  },
  // Audio
  {
    category: "audio",
    name: "Loudness (EBU R128)",
    spec: "-23 LUFS",
    tolerance: "±0.5 LU",
  },
  { category: "audio", name: "True peak", spec: "≤ -1 dBTP" },
  { category: "audio", name: "Sample rate", spec: "48 kHz" },
  { category: "audio", name: "Bit depth", spec: "24-bit" },
  {
    category: "audio",
    name: "Channel layout",
    spec: "Stereo (+5.1 if required)",
  },
  {
    category: "audio",
    name: "A/V sync",
    spec: "Within ±1 frame",
    tolerance: "±1 frame",
  },
  { category: "audio", name: "No clipping/dropouts", spec: "None present" },
  // Content
  {
    category: "content",
    name: "Poster frame provided",
    spec: "Delivered alongside master",
    required: false,
  },
  {
    category: "content",
    name: "Subtitles file present",
    spec: "SRT/STL",
    required: false,
  },
  {
    category: "content",
    name: "Slate info correct",
    spec: "Title, episode, duration, date",
  },
  // Metadata
  {
    category: "metadata",
    name: "Language/version tag",
    spec: "Correct per delivery",
  },
];

// ---------------------------------------------------------------------------
// QC parameters (studio-level template)
// ---------------------------------------------------------------------------

export const listParameters = query({
  args: {
    studioId: v.id("studios"),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await assertMember(ctx, args.studioId);
    const parameters = await ctx.db
      .query("qcParameters")
      .withIndex("by_studio", (q) => q.eq("studioId", args.studioId))
      .collect();
    const visible =
      args.includeArchived === true
        ? parameters
        : parameters.filter((p) => p.archived !== true);
    return visible.sort((a, b) => a.order - b.order);
  },
});

export const addParameter = mutation({
  args: {
    studioId: v.id("studios"),
    category: qcCategory,
    name: v.string(),
    spec: v.string(),
    tolerance: v.optional(v.string()),
    required: v.boolean(),
  },
  handler: async (ctx, args) => {
    await assertCan(ctx, args.studioId, "studio.manage");
    const name = args.name.trim();
    const spec = args.spec.trim();
    if (!name) throw new Error("Parameter name can't be empty");
    if (!spec) throw new Error("Parameter spec can't be empty");
    const existing = await ctx.db
      .query("qcParameters")
      .withIndex("by_studio", (q) => q.eq("studioId", args.studioId))
      .collect();
    const order = existing.reduce((max, p) => Math.max(max, p.order), 0) + 1;
    // No activity row: QC template is studio-scoped config; activity rows are
    // per-production (documented exception, same as externalLinks).
    return await ctx.db.insert("qcParameters", {
      studioId: args.studioId,
      category: args.category,
      name,
      spec,
      tolerance: args.tolerance,
      required: args.required,
      order,
    });
  },
});

export const updateParameter = mutation({
  args: {
    parameterId: v.id("qcParameters"),
    name: v.optional(v.string()),
    spec: v.optional(v.string()),
    tolerance: v.optional(v.string()),
    required: v.optional(v.boolean()),
    order: v.optional(v.number()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const parameter = await ctx.db.get(args.parameterId);
    if (!parameter) throw new Error("QC parameter not found");
    await assertCan(ctx, parameter.studioId, "studio.manage");
    const patch: Partial<Doc<"qcParameters">> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Parameter name can't be empty");
      patch.name = name;
    }
    if (args.spec !== undefined) {
      const spec = args.spec.trim();
      if (!spec) throw new Error("Parameter spec can't be empty");
      patch.spec = spec;
    }
    if (args.tolerance !== undefined) {
      // Empty string clears the tolerance.
      patch.tolerance =
        args.tolerance.trim() === "" ? undefined : args.tolerance;
    }
    if (args.required !== undefined) patch.required = args.required;
    if (args.order !== undefined) patch.order = args.order;
    if (args.archived !== undefined) patch.archived = args.archived;
    await ctx.db.patch(args.parameterId, patch);
    // No activity row: studio-scoped config (documented exception).
  },
});

export const seedDefaultTemplate = mutation({
  args: { studioId: v.id("studios") },
  handler: async (ctx, args) => {
    await assertCan(ctx, args.studioId, "studio.manage");
    // Idempotent: skip when the studio already has any parameters.
    const existing = await ctx.db
      .query("qcParameters")
      .withIndex("by_studio", (q) => q.eq("studioId", args.studioId))
      .first();
    if (existing) return { seeded: 0 };
    let order = 1;
    for (const p of DEFAULT_TEMPLATE) {
      await ctx.db.insert("qcParameters", {
        studioId: args.studioId,
        category: p.category,
        name: p.name,
        spec: p.spec,
        tolerance: p.tolerance,
        required: p.required ?? true,
        order: order++,
      });
    }
    // No activity row: studio-scoped config (documented exception).
    return { seeded: DEFAULT_TEMPLATE.length };
  },
});

// ---------------------------------------------------------------------------
// QC runs
// ---------------------------------------------------------------------------

export const createRun = mutation({
  args: {
    productionId: v.id("productions"),
    name: v.string(),
    masterAssetId: v.optional(v.id("assets")),
  },
  handler: async (ctx, args) => {
    const { userId, production } = await assertCanForProduction(
      ctx,
      args.productionId,
      "qc.run",
    );
    const name = args.name.trim();
    if (!name) throw new Error("Give the QC run a name");
    if (args.masterAssetId !== undefined) {
      const master = await ctx.db.get(args.masterAssetId);
      if (!master || master.productionId !== args.productionId)
        throw new Error("Master asset not found in this production");
    }
    const parameters = (
      await ctx.db
        .query("qcParameters")
        .withIndex("by_studio", (q) => q.eq("studioId", production.studioId))
        .collect()
    ).filter((p) => p.archived !== true);
    if (parameters.length === 0)
      throw new Error(
        "No QC parameters yet — seed the studio QC template first",
      );
    const qcRunId = await ctx.db.insert("qcRuns", {
      productionId: args.productionId,
      name,
      masterAssetId: args.masterAssetId,
      status: "in_progress",
      startedBy: userId,
    });
    for (const parameter of parameters) {
      await ctx.db.insert("qcChecks", {
        qcRunId,
        parameterId: parameter._id,
        result: "pending",
      });
    }
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "qc.run_started",
      targetType: "qcRun",
      targetId: qcRunId,
      summary: `${await actorName(ctx, userId)} started QC run '${name}' (${parameters.length} checks)`,
    });
    return qcRunId;
  },
});

export const listRuns = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    const runs = await ctx.db
      .query("qcRuns")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .order("desc")
      .collect();
    return await Promise.all(
      runs.map(async (run) => {
        const checks = await ctx.db
          .query("qcChecks")
          .withIndex("by_run", (q) => q.eq("qcRunId", run._id))
          .collect();
        return {
          ...run,
          progress: {
            done: checks.filter((c) => c.result !== "pending").length,
            total: checks.length,
          },
          startedByUser: await userRef(ctx, run.startedBy),
        };
      }),
    );
  },
});

export const getRun = query({
  args: { qcRunId: v.id("qcRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.qcRunId);
    if (!run) throw new Error("QC run not found");
    await assertMemberForProduction(ctx, run.productionId);
    const master =
      run.masterAssetId !== undefined
        ? await ctx.db.get(run.masterAssetId)
        : null;
    const rawChecks = await ctx.db
      .query("qcChecks")
      .withIndex("by_run", (q) => q.eq("qcRunId", run._id))
      .collect();
    const enriched = await Promise.all(
      rawChecks.map(async (check) => {
        const parameter = await ctx.db.get(check.parameterId);
        if (!parameter) return null; // parameter row vanished — skip the check
        return {
          ...check,
          parameter,
          checkedByUser:
            check.checkedBy !== undefined
              ? await userRef(ctx, check.checkedBy)
              : null,
        };
      }),
    );
    const checks = enriched
      .filter((c): c is NonNullable<(typeof enriched)[number]> => c !== null)
      .sort((a, b) => a.parameter.order - b.parameter.order);
    return { ...run, master, checks };
  },
});

export const setCheck = mutation({
  args: {
    checkId: v.id("qcChecks"),
    result: checkResult,
    measured: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const check = await ctx.db.get(args.checkId);
    if (!check) throw new Error("QC check not found");
    const run = await ctx.db.get(check.qcRunId);
    if (!run) throw new Error("QC run not found");
    const { userId } = await assertCanForProduction(
      ctx,
      run.productionId,
      "qc.run",
    );

    const pending = args.result === "pending";
    await ctx.db.patch(args.checkId, {
      result: args.result,
      measured: args.measured,
      note: args.note,
      checkedBy: pending ? undefined : userId,
      checkedAt: pending ? undefined : Date.now(),
    });

    // Recompute run status: any required fail → failed; all required pass →
    // passed; else in_progress. (Reads below see the patch above.)
    const checks = await ctx.db
      .query("qcChecks")
      .withIndex("by_run", (q) => q.eq("qcRunId", run._id))
      .collect();
    let requiredFails = 0;
    let allRequiredPass = true;
    for (const c of checks) {
      const parameter = await ctx.db.get(c.parameterId);
      if (parameter === null || !parameter.required) continue;
      if (c.result === "fail") requiredFails++;
      if (c.result !== "pass") allRequiredPass = false;
    }
    const nextStatus: Doc<"qcRuns">["status"] =
      requiredFails > 0
        ? "failed"
        : allRequiredPass
          ? "passed"
          : "in_progress";

    if (nextStatus === run.status) return;

    if (nextStatus === "in_progress") {
      // Transition back out of terminal: corrections happen as new decisions —
      // clear completedAt, leave old approval rows in place.
      await ctx.db.patch(run._id, {
        status: nextStatus,
        completedAt: undefined,
      });
      return;
    }

    // Transition to a terminal status.
    const now = Date.now();
    const passed = nextStatus === "passed";
    await ctx.db.patch(run._id, { status: nextStatus, completedAt: now });
    await ctx.db.insert("approvals", {
      productionId: run.productionId,
      scope: "delivery",
      targetId: run._id,
      requestedBy: run.startedBy,
      approverId: userId,
      status: passed ? "approved" : "rejected",
      decidedAt: now,
      note: run.name,
    });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: run.productionId,
      actorId: userId,
      type: passed ? "qc.run_passed" : "qc.run_failed",
      targetType: "qcRun",
      targetId: run._id,
      summary: passed
        ? `${name} completed QC run '${run.name}' — all required checks passed`
        : `${name} recorded QC run '${run.name}' as failed (${requiredFails} required check${requiredFails === 1 ? "" : "s"} failing)`,
    });
    await notify(ctx, {
      userId: run.startedBy,
      actorId: userId,
      productionId: run.productionId,
      type: "gate_decided",
      title: passed ? `QC passed: ${run.name}` : `QC failed: ${run.name}`,
      body: passed
        ? "All required checks passed."
        : `${requiredFails} required check${requiredFails === 1 ? "" : "s"} failing.`,
      href: `/p/${run.productionId}/qc`,
    });
  },
});
