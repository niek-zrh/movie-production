import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";

/** Scenes ordered by `order`, each with its shot count (CONTRACTS §scenes). */
export const list = query({
  args: {
    productionId: v.id("productions"),
    episodeId: v.optional(v.id("episodes")),
  },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    let scenes = await ctx.db
      .query("scenes")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    if (args.episodeId !== undefined) {
      scenes = scenes.filter((s) => s.episodeId === args.episodeId);
    }
    scenes.sort((a, b) => a.order - b.order);
    return await Promise.all(
      scenes.map(async (scene) => {
        const shots = await ctx.db
          .query("shots")
          .withIndex("by_scene", (q) => q.eq("sceneId", scene._id))
          .collect();
        return { ...scene, shotCount: shots.length };
      }),
    );
  },
});

export const create = mutation({
  args: {
    productionId: v.id("productions"),
    episodeId: v.optional(v.id("episodes")),
    code: v.string(),
    title: v.optional(v.string()),
    figmaUrl: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertCanForProduction(
      ctx,
      args.productionId,
      "content.edit",
    );
    const code = args.code.trim().toUpperCase();
    if (code.length === 0) throw new Error("Scene code is required");
    if (args.episodeId !== undefined) {
      const episode = await ctx.db.get(args.episodeId);
      if (!episode || episode.productionId !== args.productionId)
        throw new Error("Episode not found in this production");
    }
    const existing = await ctx.db
      .query("scenes")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    const order = existing.reduce((max, s) => Math.max(max, s.order), 0) + 1;
    const sceneId = await ctx.db.insert("scenes", {
      productionId: args.productionId,
      episodeId: args.episodeId,
      code,
      title: args.title,
      order,
      figmaUrl: args.figmaUrl,
      description: args.description,
    });
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "scene.created",
      targetType: "scene",
      targetId: sceneId,
      summary: `${await actorName(ctx, userId)} created scene ${code}`,
    });
    return sceneId;
  },
});

export const update = mutation({
  args: {
    sceneId: v.id("scenes"),
    title: v.optional(v.string()),
    figmaUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    order: v.optional(v.number()),
    episodeId: v.optional(v.id("episodes")),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new Error("Scene not found");
    const { userId } = await assertCanForProduction(
      ctx,
      scene.productionId,
      "content.edit",
    );
    const patch: {
      title?: string;
      figmaUrl?: string;
      description?: string;
      order?: number;
      episodeId?: Id<"episodes">;
    } = {};
    const changes: string[] = [];
    if (args.title !== undefined && args.title !== scene.title) {
      patch.title = args.title;
      changes.push(`title → "${args.title}"`);
    }
    if (args.figmaUrl !== undefined && args.figmaUrl !== scene.figmaUrl) {
      patch.figmaUrl = args.figmaUrl;
      changes.push("Figma link");
    }
    if (
      args.description !== undefined &&
      args.description !== scene.description
    ) {
      patch.description = args.description;
      changes.push("description");
    }
    if (args.order !== undefined && args.order !== scene.order) {
      patch.order = args.order;
      changes.push("order");
    }
    if (args.episodeId !== undefined && args.episodeId !== scene.episodeId) {
      const episode = await ctx.db.get(args.episodeId);
      if (!episode || episode.productionId !== scene.productionId)
        throw new Error("Episode not found in this production");
      patch.episodeId = args.episodeId;
      changes.push(`episode → EP${String(episode.number).padStart(2, "0")}`);
    }
    if (changes.length === 0) return;
    await ctx.db.patch(scene._id, patch);
    await logActivity(ctx, {
      productionId: scene.productionId,
      actorId: userId,
      type: "scene.updated",
      targetType: "scene",
      targetId: scene._id,
      summary: `${await actorName(ctx, userId)} updated scene ${scene.code} (${changes.join(", ")})`,
    });
  },
});

export const remove = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await ctx.db.get(args.sceneId);
    if (!scene) return;
    const { userId } = await assertCanForProduction(
      ctx,
      scene.productionId,
      "content.edit",
    );
    const referencingShot = await ctx.db
      .query("shots")
      .withIndex("by_scene", (q) => q.eq("sceneId", scene._id))
      .first();
    if (referencingShot !== null)
      throw new Error(
        "This scene still has shots — reassign or remove them first",
      );
    await ctx.db.delete(scene._id);
    await logActivity(ctx, {
      productionId: scene.productionId,
      actorId: userId,
      type: "scene.removed",
      targetType: "scene",
      targetId: scene._id,
      summary: `${await actorName(ctx, userId)} removed scene ${scene.code}`,
    });
  },
});
