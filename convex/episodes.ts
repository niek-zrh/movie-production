import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertCanForProduction,
  assertMemberForProduction,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";

export const list = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    const episodes = await ctx.db
      .query("episodes")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    return episodes.sort((a, b) => a.number - b.number);
  },
});

export const create = mutation({
  args: {
    productionId: v.id("productions"),
    number: v.number(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, production } = await assertCanForProduction(
      ctx,
      args.productionId,
      "production.manage",
    );

    const number = Math.floor(args.number);
    if (number < 1) throw new Error("Episode number must be 1 or higher");
    const siblings = await ctx.db
      .query("episodes")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    if (siblings.some((e) => e.number === number))
      throw new Error(`Episode ${number} already exists`);

    const title = args.title?.trim() || undefined;
    const episodeId = await ctx.db.insert("episodes", {
      productionId: args.productionId,
      number,
      title,
    });

    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "production.updated",
      targetType: "episode",
      targetId: episodeId,
      summary: `${await actorName(ctx, userId)} added episode ${number}${title ? ` — ${title}` : ""} to ${production.name}`,
    });

    return episodeId;
  },
});

export const update = mutation({
  args: {
    episodeId: v.id("episodes"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const episode = await ctx.db.get(args.episodeId);
    if (!episode) throw new Error("Episode not found");
    const { userId, production } = await assertCanForProduction(
      ctx,
      episode.productionId,
      "production.manage",
    );

    if (args.title === undefined) return; // nothing to do

    const title = args.title.trim() || undefined;
    if (title === episode.title) return; // no-op
    await ctx.db.patch(args.episodeId, { title });

    await logActivity(ctx, {
      productionId: episode.productionId,
      actorId: userId,
      type: "production.updated",
      targetType: "episode",
      targetId: args.episodeId,
      summary:
        title === undefined
          ? `${await actorName(ctx, userId)} cleared the title of episode ${episode.number} in ${production.name}`
          : `${await actorName(ctx, userId)} renamed episode ${episode.number} to "${title}" in ${production.name}`,
    });
  },
});
