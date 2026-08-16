import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { shotStatus, stageKey } from "./schema";
import {
  assertCanForProduction,
  assertMemberForProduction,
  canEditShot,
  getMembership,
  PermissionError,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notify } from "./lib/notify";
import { SHOT_STATUS_BY_KEY, STAGE_BY_KEY } from "./lib/domain";

/** Enriched user shape shared across returns (CONTRACTS "UserRef"). */
type UserRef = { _id: Id<"users">; name: string; image?: string };

function toUserRef(user: Doc<"users"> | null): UserRef | null {
  if (!user) return null;
  return {
    _id: user._id,
    name: user.name ?? user.email ?? "Unknown",
    image: user.image,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ShotCard enrichment (CONTRACTS §shots): assignee/scene/episode lookups,
 * versionsCount via the versions by_shot index, coverThumbUrl resolved from
 * coverAsset.thumbStorageId — null-safe at every hop.
 */
async function enrichShot(ctx: QueryCtx, shot: Doc<"shots">) {
  const assignee =
    shot.assigneeId !== undefined
      ? toUserRef(await ctx.db.get(shot.assigneeId))
      : null;
  const sceneDoc =
    shot.sceneId !== undefined ? await ctx.db.get(shot.sceneId) : null;
  const scene = sceneDoc
    ? { _id: sceneDoc._id, code: sceneDoc.code, title: sceneDoc.title }
    : null;
  const episodeDoc =
    shot.episodeId !== undefined ? await ctx.db.get(shot.episodeId) : null;
  const episode = episodeDoc
    ? { _id: episodeDoc._id, number: episodeDoc.number }
    : null;
  const versions = await ctx.db
    .query("versions")
    .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
    .collect();
  let coverThumbUrl: string | null = null;
  if (shot.coverAssetId !== undefined) {
    const coverAsset = await ctx.db.get(shot.coverAssetId);
    if (coverAsset && coverAsset.thumbStorageId !== undefined) {
      coverThumbUrl = await ctx.storage.getUrl(coverAsset.thumbStorageId);
    }
  }
  return {
    ...shot,
    assignee,
    scene,
    episode,
    versionsCount: versions.length,
    coverThumbUrl,
  };
}

/**
 * All filters optional & combinable; filtered in JS after the index query.
 * The id filters accept plain strings (they often arrive from URL params) and
 * are resolved via normalizeId — a malformed value matches nothing instead of
 * crashing the query.
 */
export const list = query({
  args: {
    productionId: v.id("productions"),
    status: v.optional(shotStatus),
    stage: v.optional(stageKey),
    sceneId: v.optional(v.string()),
    assigneeId: v.optional(v.string()),
    episodeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    let sceneId: Id<"scenes"> | undefined;
    if (args.sceneId !== undefined) {
      const normalized = ctx.db.normalizeId("scenes", args.sceneId);
      if (normalized === null) return [];
      sceneId = normalized;
    }
    let assigneeId: Id<"users"> | undefined;
    if (args.assigneeId !== undefined) {
      const normalized = ctx.db.normalizeId("users", args.assigneeId);
      if (normalized === null) return [];
      assigneeId = normalized;
    }
    let episodeId: Id<"episodes"> | undefined;
    if (args.episodeId !== undefined) {
      const normalized = ctx.db.normalizeId("episodes", args.episodeId);
      if (normalized === null) return [];
      episodeId = normalized;
    }
    let shots = await ctx.db
      .query("shots")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    if (args.status !== undefined)
      shots = shots.filter((s) => s.status === args.status);
    if (args.stage !== undefined)
      shots = shots.filter((s) => s.stage === args.stage);
    if (sceneId !== undefined)
      shots = shots.filter((s) => s.sceneId === sceneId);
    if (assigneeId !== undefined)
      shots = shots.filter((s) => s.assigneeId === assigneeId);
    if (episodeId !== undefined)
      shots = shots.filter((s) => s.episodeId === episodeId);
    shots.sort((a, b) => a.order - b.order);
    return await Promise.all(shots.map((shot) => enrichShot(ctx, shot)));
  },
});

export const get = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { production } = await assertMemberForProduction(
      ctx,
      shot.productionId,
    );
    const card = await enrichShot(ctx, shot);
    let pickedVersionIndex: number | null = null;
    if (shot.pickedVersionId !== undefined) {
      const picked = await ctx.db.get(shot.pickedVersionId);
      pickedVersionIndex = picked?.index ?? null;
    }
    return {
      ...card,
      production: {
        _id: production._id,
        name: production.name,
        code: production.code,
        timezone: production.timezone,
      },
      pickedVersionIndex,
    };
  },
});

export const create = mutation({
  args: {
    productionId: v.id("productions"),
    code: v.string(),
    title: v.optional(v.string()),
    sceneId: v.optional(v.id("scenes")),
    episodeId: v.optional(v.id("episodes")),
    stage: v.optional(stageKey),
    assigneeId: v.optional(v.id("users")),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, production } = await assertCanForProduction(
      ctx,
      args.productionId,
      "content.edit",
    );
    const code = args.code.trim().toUpperCase();
    if (code.length === 0) throw new ConvexError("Shot code is required");
    if (args.sceneId !== undefined) {
      const scene = await ctx.db.get(args.sceneId);
      if (!scene || scene.productionId !== args.productionId)
        throw new ConvexError("Scene not found in this production");
    }
    if (args.episodeId !== undefined) {
      const episode = await ctx.db.get(args.episodeId);
      if (!episode || episode.productionId !== args.productionId)
        throw new ConvexError("Episode not found in this production");
    }
    if (args.assigneeId !== undefined) {
      const membership = await getMembership(
        ctx,
        production.studioId,
        args.assigneeId,
      );
      if (!membership)
        throw new ConvexError("Assignee is not a member of this studio");
    }
    if (args.dueDate !== undefined && !DATE_RE.test(args.dueDate))
      throw new ConvexError("Due date must be YYYY-MM-DD");
    const existing = await ctx.db
      .query("shots")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    if (existing.some((s) => s.code === code))
      throw new ConvexError(`Shot code ${code} already exists in this production`);
    const order = existing.reduce((max, s) => Math.max(max, s.order), 0) + 1;
    const shotId = await ctx.db.insert("shots", {
      productionId: args.productionId,
      code,
      title: args.title,
      sceneId: args.sceneId,
      episodeId: args.episodeId,
      status: "planned",
      stage: args.stage ?? "production",
      assigneeId: args.assigneeId,
      dueDate: args.dueDate,
      order,
    });
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "shot.created",
      targetType: "shot",
      targetId: shotId,
      summary: `${await actorName(ctx, userId)} created shot ${code}`,
    });
    return shotId;
  },
});

/**
 * One code per array entry (the client splits the pasted text). Trims,
 * uppercases, dedupes, skips codes already in the production. ONE activity
 * row for the whole batch.
 */
export const bulkCreate = mutation({
  args: {
    productionId: v.id("productions"),
    codes: v.array(v.string()),
    sceneId: v.optional(v.id("scenes")),
    episodeId: v.optional(v.id("episodes")),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertCanForProduction(
      ctx,
      args.productionId,
      "content.edit",
    );
    if (args.sceneId !== undefined) {
      const scene = await ctx.db.get(args.sceneId);
      if (!scene || scene.productionId !== args.productionId)
        throw new ConvexError("Scene not found in this production");
    }
    if (args.episodeId !== undefined) {
      const episode = await ctx.db.get(args.episodeId);
      if (!episode || episode.productionId !== args.productionId)
        throw new ConvexError("Episode not found in this production");
    }
    const existing = await ctx.db
      .query("shots")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    const taken = new Set(existing.map((s) => s.code));
    let order = existing.reduce((max, s) => Math.max(max, s.order), 0);
    let created = 0;
    const skipped: string[] = [];
    for (const raw of args.codes) {
      const code = raw.trim().toUpperCase();
      if (code.length === 0) continue;
      if (taken.has(code)) {
        skipped.push(code);
        continue;
      }
      taken.add(code);
      order += 1;
      await ctx.db.insert("shots", {
        productionId: args.productionId,
        code,
        sceneId: args.sceneId,
        episodeId: args.episodeId,
        status: "planned",
        stage: "production",
        order,
      });
      created += 1;
    }
    if (created > 0) {
      await logActivity(ctx, {
        productionId: args.productionId,
        actorId: userId,
        type: "shot.created",
        targetType: "production",
        targetId: args.productionId,
        summary: `${await actorName(ctx, userId)} created ${created} shot${created === 1 ? "" : "s"}`,
        data: skipped.length > 0 ? { skipped } : undefined,
      });
    }
    return { created, skipped };
  },
});

export const update = mutation({
  args: {
    shotId: v.id("shots"),
    title: v.optional(v.string()),
    sceneId: v.optional(v.id("scenes")),
    assigneeId: v.optional(v.id("users")),
    // null clears the due date; a string sets it (YYYY-MM-DD).
    dueDate: v.optional(v.union(v.string(), v.null())),
    order: v.optional(v.number()),
    episodeId: v.optional(v.id("episodes")),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { userId, member, production } = await assertMemberForProduction(
      ctx,
      shot.productionId,
    );
    if (!canEditShot(member, shot, userId))
      throw new PermissionError("You can't edit this shot");

    const patch: {
      title?: string;
      sceneId?: Id<"scenes">;
      assigneeId?: Id<"users">;
      dueDate?: string | undefined;
      order?: number;
      episodeId?: Id<"episodes">;
    } = {};
    const changes: string[] = [];

    if (args.title !== undefined && args.title !== shot.title) {
      patch.title = args.title;
      changes.push(`title → "${args.title}"`);
    }
    if (args.sceneId !== undefined && args.sceneId !== shot.sceneId) {
      const scene = await ctx.db.get(args.sceneId);
      if (!scene || scene.productionId !== shot.productionId)
        throw new ConvexError("Scene not found in this production");
      patch.sceneId = args.sceneId;
      changes.push(`scene → ${scene.code}`);
    }
    let newAssigneeId: Id<"users"> | undefined;
    if (args.assigneeId !== undefined && args.assigneeId !== shot.assigneeId) {
      const membership = await getMembership(
        ctx,
        production.studioId,
        args.assigneeId,
      );
      if (!membership)
        throw new ConvexError("Assignee is not a member of this studio");
      const assigneeUser = await ctx.db.get(args.assigneeId);
      patch.assigneeId = args.assigneeId;
      newAssigneeId = args.assigneeId;
      changes.push(
        `assignee → ${assigneeUser?.name ?? assigneeUser?.email ?? "Unknown"}`,
      );
    }
    if (args.dueDate === null) {
      // Patching with an explicit undefined removes the field.
      if (shot.dueDate !== undefined) {
        patch.dueDate = undefined;
        changes.push("due date cleared");
      }
    } else if (args.dueDate !== undefined && args.dueDate !== shot.dueDate) {
      if (!DATE_RE.test(args.dueDate))
        throw new ConvexError("Due date must be YYYY-MM-DD");
      patch.dueDate = args.dueDate;
      changes.push(`due → ${args.dueDate}`);
    }
    if (args.order !== undefined && args.order !== shot.order) {
      patch.order = args.order;
      changes.push("order");
    }
    if (args.episodeId !== undefined && args.episodeId !== shot.episodeId) {
      const episode = await ctx.db.get(args.episodeId);
      if (!episode || episode.productionId !== shot.productionId)
        throw new ConvexError("Episode not found in this production");
      patch.episodeId = args.episodeId;
      changes.push(`episode → EP${String(episode.number).padStart(2, "0")}`);
    }

    if (changes.length === 0) return;
    await ctx.db.patch(shot._id, patch);

    const actor = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: shot.productionId,
      actorId: userId,
      type: "shot.updated",
      targetType: "shot",
      targetId: shot._id,
      summary: `${actor} updated ${shot.code} (${changes.join(", ")})`,
    });

    if (newAssigneeId !== undefined) {
      await notify(ctx, {
        userId: newAssigneeId,
        actorId: userId,
        productionId: shot.productionId,
        type: "shot_assigned",
        title: `${actor} assigned you ${shot.code}`,
        body: shot.title,
        href: `/p/${shot.productionId}/shots/${shot._id}`,
      });
    }
  },
});

export const setStatus = mutation({
  args: { shotId: v.id("shots"), status: shotStatus },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { userId, member } = await assertMemberForProduction(
      ctx,
      shot.productionId,
    );
    if (!canEditShot(member, shot, userId, args.status))
      throw new PermissionError("You can't move this shot to that status");
    if (args.status === shot.status) return;
    // Spec §6 invariants.
    if (args.status === "approved" && shot.pickedVersionId === undefined)
      throw new ConvexError("Pick a version before approving this shot");
    if (args.status === "delivered") {
      const delivery = await ctx.db
        .query("stageInstances")
        .withIndex("by_production", (q) =>
          q.eq("productionId", shot.productionId),
        )
        .filter((q) => q.eq(q.field("stage"), "delivery"))
        .unique();
      if (delivery !== null && delivery.gateStatus === "rejected")
        throw new ConvexError(
          "The delivery gate is rejected — resolve it before delivering shots",
        );
    }
    await ctx.db.patch(shot._id, { status: args.status });
    await logActivity(ctx, {
      productionId: shot.productionId,
      actorId: userId,
      type: "shot.status_changed",
      targetType: "shot",
      targetId: shot._id,
      summary: `${await actorName(ctx, userId)} moved ${shot.code} to ${SHOT_STATUS_BY_KEY[args.status].label}`,
      data: { from: shot.status, to: args.status },
    });
  },
});

export const setStage = mutation({
  args: { shotId: v.id("shots"), stage: stageKey },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { userId } = await assertCanForProduction(
      ctx,
      shot.productionId,
      "content.edit",
    );
    if (args.stage === shot.stage) return;
    await ctx.db.patch(shot._id, { stage: args.stage });
    await logActivity(ctx, {
      productionId: shot.productionId,
      actorId: userId,
      type: "shot.stage_changed",
      targetType: "shot",
      targetId: shot._id,
      summary: `${await actorName(ctx, userId)} moved ${shot.code} to ${STAGE_BY_KEY[args.stage].label}`,
      data: { from: shot.stage, to: args.stage },
    });
  },
});
