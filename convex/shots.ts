import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
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

/** Codes land in filenames and Drive folders; titles are one line of text. */
const MAX_CODE_LENGTH = 64;
const MAX_TITLE_LENGTH = 200;

/**
 * Hard bound on one list() call. Convex refuses a function that reads more
 * than 4,096 documents, and this query backs the Shots page, the Board AND
 * the Overview — the old unbounded collect() bricked all three past ~4,400
 * shots. An enriched row now costs the shot plus (at most) its cover asset;
 * assignees/scenes/episodes are memoised per call, so 1,000 rows stays well
 * inside the ceiling with room for the enrichment lookups.
 */
const MAX_LIST_SHOTS = 1000;

/**
 * Per-call document memo. list() enriches up to MAX_LIST_SHOTS rows that
 * share a handful of assignees, scenes and episodes; every ctx.db.get counts
 * against the read ceiling, so each document is fetched exactly once. The
 * promise (not the document) is cached so parallel enrichment can't race two
 * reads of the same id.
 */
type EnrichCache = {
  users: Map<string, Promise<Doc<"users"> | null>>;
  scenes: Map<string, Promise<Doc<"scenes"> | null>>;
  episodes: Map<string, Promise<Doc<"episodes"> | null>>;
};

function newEnrichCache(): EnrichCache {
  return { users: new Map(), scenes: new Map(), episodes: new Map() };
}

function cachedGet<T extends "users" | "scenes" | "episodes">(
  ctx: QueryCtx,
  cache: Map<string, Promise<Doc<T> | null>>,
  id: Id<T>,
): Promise<Doc<T> | null> {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const pending = ctx.db.get(id);
  cache.set(id, pending);
  return pending;
}

/** Highest `order` in the production (0 when empty) — one indexed read. */
async function lastOrder(
  ctx: QueryCtx | MutationCtx,
  productionId: Id<"productions">,
): Promise<number> {
  const last = await ctx.db
    .query("shots")
    .withIndex("by_production_order", (q) => q.eq("productionId", productionId))
    .order("desc")
    .first();
  return last?.order ?? 0;
}

/**
 * ShotCard enrichment (CONTRACTS §shots): assignee/scene/episode lookups,
 * versionsCount read from the denormalised counter on the shot, coverThumbUrl
 * resolved from coverAsset.thumbStorageId — null-safe at every hop.
 * versionsCount defaults to 0: shots written before the counter existed carry
 * no value, and no UI call site may see undefined.
 */
async function enrichShot(
  ctx: QueryCtx,
  shot: Doc<"shots">,
  cache: EnrichCache = newEnrichCache(),
) {
  const assignee =
    shot.assigneeId !== undefined
      ? toUserRef(await cachedGet(ctx, cache.users, shot.assigneeId))
      : null;
  const sceneDoc =
    shot.sceneId !== undefined
      ? await cachedGet(ctx, cache.scenes, shot.sceneId)
      : null;
  const scene = sceneDoc
    ? { _id: sceneDoc._id, code: sceneDoc.code, title: sceneDoc.title }
    : null;
  const episodeDoc =
    shot.episodeId !== undefined
      ? await cachedGet(ctx, cache.episodes, shot.episodeId)
      : null;
  const episode = episodeDoc
    ? { _id: episodeDoc._id, number: episodeDoc.number }
    : null;
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
    versionsCount: shot.versionsCount ?? 0,
    coverThumbUrl,
  };
}

/**
 * All filters optional & combinable. `status` narrows through the
 * by_production_status index; the rest are matched while the index streams,
 * so a filtered list never materialises the whole production and the scan
 * stops at MAX_LIST_SHOTS rows (see above — reading every shot was the
 * ceiling, not the filtering).
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
    const status = args.status;
    const stage = args.stage;
    const stream =
      status !== undefined
        ? ctx.db
            .query("shots")
            .withIndex("by_production_status", (q) =>
              q.eq("productionId", args.productionId).eq("status", status),
            )
        : ctx.db
            .query("shots")
            .withIndex("by_production", (q) =>
              q.eq("productionId", args.productionId),
            );

    const shots: Doc<"shots">[] = [];
    for await (const shot of stream) {
      if (stage !== undefined && shot.stage !== stage) continue;
      if (sceneId !== undefined && shot.sceneId !== sceneId) continue;
      if (assigneeId !== undefined && shot.assigneeId !== assigneeId) continue;
      if (episodeId !== undefined && shot.episodeId !== episodeId) continue;
      shots.push(shot);
      if (shots.length >= MAX_LIST_SHOTS) break;
    }
    shots.sort((a, b) => a.order - b.order);

    const cache = newEnrichCache();
    return await Promise.all(
      shots.map((shot) => enrichShot(ctx, shot, cache)),
    );
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
    if (code.length > MAX_CODE_LENGTH)
      throw new ConvexError(
        `Shot code is too long — keep it to ${MAX_CODE_LENGTH} characters`,
      );
    if (args.title !== undefined && args.title.length > MAX_TITLE_LENGTH)
      throw new ConvexError(
        `Shot title is too long — keep it to ${MAX_TITLE_LENGTH} characters`,
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
    // Indexed lookups, not a collect of the production: at a few thousand
    // shots the scan alone exceeded Convex's read ceiling.
    const duplicate = await ctx.db
      .query("shots")
      .withIndex("by_production_code", (q) =>
        q.eq("productionId", args.productionId).eq("code", code),
      )
      .first();
    if (duplicate !== null)
      throw new ConvexError(`Shot code ${code} already exists in this production`);
    const order = (await lastOrder(ctx, args.productionId)) + 1;
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
      versionsCount: 0, // denormalised; versions.ts keeps it current
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
 * A mis-paste used to be permanent: 5,000 codes went in as fast as 5, and
 * nothing could be deleted afterwards. 500 is far more than any real paste
 * and small enough that bulkRemove can undo the same batch in one call.
 */
const MAX_BULK_SHOTS = 500;

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
    if (args.codes.length > MAX_BULK_SHOTS)
      throw new ConvexError(
        `That's ${args.codes.length} shots — paste at most ${MAX_BULK_SHOTS} at a time`,
      );
    // Validated before anything is written so one bad line can't leave half a
    // paste behind (the mutation would roll back anyway, but the message
    // should name what to fix).
    for (const raw of args.codes) {
      if (raw.trim().length > MAX_CODE_LENGTH)
        throw new ConvexError(
          `Shot code "${raw.trim().slice(0, 20)}…" is too long — keep codes to ${MAX_CODE_LENGTH} characters`,
        );
    }
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
    // `taken` only has to catch duplicates inside this batch — codes already
    // in the production are found with one indexed lookup each, which keeps
    // this off the collect-the-whole-production path.
    const taken = new Set<string>();
    let order = await lastOrder(ctx, args.productionId);
    let created = 0;
    const skipped: string[] = [];
    for (const raw of args.codes) {
      const code = raw.trim().toUpperCase();
      if (code.length === 0) continue;
      if (taken.has(code)) {
        skipped.push(code);
        continue;
      }
      const duplicate = await ctx.db
        .query("shots")
        .withIndex("by_production_code", (q) =>
          q.eq("productionId", args.productionId).eq("code", code),
        )
        .first();
      if (duplicate !== null) {
        skipped.push(code);
        taken.add(code);
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
        versionsCount: 0, // denormalised; versions.ts keeps it current
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
      if (args.title.length > MAX_TITLE_LENGTH)
        throw new ConvexError(
          `Shot title is too long — keep it to ${MAX_TITLE_LENGTH} characters`,
        );
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

/**
 * Deletes one shot if nothing hangs off it, otherwise returns the reason it
 * can't go — mirrors scenes.remove refusing while shots still reference the
 * scene. Versions are the decision record, so a shot with options (or with a
 * pick already recorded) has to be emptied deliberately first. The shot's
 * comments and asset rows go with it — they can only dangle otherwise — but
 * activity rows stay: the daily report counts them (reports.ts) and history
 * should keep the fact that the shot existed.
 */
async function removeShotIfSafe(
  ctx: MutationCtx,
  shot: Doc<"shots">,
): Promise<string | null> {
  const version = await ctx.db
    .query("versions")
    .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
    .first();
  if (version !== null) return "it still has options";
  if (shot.pickedVersionId !== undefined) return "it has a picked version";
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_target", (q) =>
      q.eq("targetType", "shot").eq("targetId", shot._id),
    )
    .collect();
  for (const comment of comments) await ctx.db.delete(comment._id);
  // No versions means no asset here backs one; these are loose files/links.
  // The Convex storage blobs and Drive files themselves are left alone.
  const assets = await ctx.db
    .query("assets")
    .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
    .collect();
  for (const asset of assets) await ctx.db.delete(asset._id);
  await ctx.db.delete(shot._id);
  return null;
}

export const remove = mutation({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) return; // already gone — deleting twice is not an error
    const { userId } = await assertCanForProduction(
      ctx,
      shot.productionId,
      "content.edit",
    );
    const blocked = await removeShotIfSafe(ctx, shot);
    if (blocked !== null)
      throw new ConvexError(
        `Can't delete ${shot.code} — ${blocked}. Set it to Killed instead, or remove its options first.`,
      );
    await logActivity(ctx, {
      productionId: shot.productionId,
      actorId: userId,
      type: "shot.removed",
      targetType: "shot",
      targetId: shot._id,
      summary: `${await actorName(ctx, userId)} removed shot ${shot.code}`,
    });
  },
});

/**
 * The undo for a mis-pasted bulkCreate: same per-shot safety rule as remove,
 * shots that aren't safe come back in `skipped` instead of failing the batch.
 * ONE activity row for the whole batch, like bulkCreate.
 */
export const bulkRemove = mutation({
  args: {
    productionId: v.id("productions"),
    shotIds: v.array(v.id("shots")),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertCanForProduction(
      ctx,
      args.productionId,
      "content.edit",
    );
    if (args.shotIds.length > MAX_BULK_SHOTS)
      throw new ConvexError(
        `That's ${args.shotIds.length} shots — delete at most ${MAX_BULK_SHOTS} at a time`,
      );
    let removed = 0;
    const skipped: string[] = [];
    for (const shotId of args.shotIds) {
      const shot = await ctx.db.get(shotId);
      if (!shot) continue; // already gone
      // content.edit was checked for one production only.
      if (shot.productionId !== args.productionId)
        throw new ConvexError("Those shots aren't all in this production");
      const blocked = await removeShotIfSafe(ctx, shot);
      if (blocked !== null) {
        skipped.push(shot.code);
        continue;
      }
      removed += 1;
    }
    if (removed > 0) {
      await logActivity(ctx, {
        productionId: args.productionId,
        actorId: userId,
        type: "shot.removed",
        targetType: "production",
        targetId: args.productionId,
        summary: `${await actorName(ctx, userId)} removed ${removed} shot${removed === 1 ? "" : "s"}`,
        data: skipped.length > 0 ? { skipped } : undefined,
      });
    }
    return { removed, skipped };
  },
});
