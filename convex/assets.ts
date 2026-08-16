import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { createVersionWithAssetHelper, enrichAsset } from "./versions";
import type { EnrichedAsset } from "./versions";

/**
 * Asset library (spec §7). Assets are the files/links behind versions plus
 * anything synced from the Drive hub that hasn't been assigned to a shot yet.
 * Version creation always routes through versions.createVersionWithAssetHelper
 * so index logic lives in exactly one place.
 */

export const listForProduction = query({
  args: {
    productionId: v.id("productions"),
    unassignedOnly: v.optional(v.boolean()),
    q: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EnrichedAsset[]> => {
    await assertMemberForProduction(ctx, args.productionId);
    let assets = await ctx.db
      .query("assets")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .order("desc") // newest first
      .collect();
    if (args.unassignedOnly === true) {
      assets = assets.filter(
        (asset) =>
          asset.shotId === undefined &&
          asset.versionId === undefined &&
          asset.kind === "file",
      );
    }
    const needle = args.q?.trim().toLowerCase();
    if (needle !== undefined && needle.length > 0) {
      assets = assets.filter((asset) =>
        asset.name.toLowerCase().includes(needle),
      );
    }
    return await Promise.all(assets.map((asset) => enrichAsset(ctx, asset)));
  },
});

export const listForShot = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args): Promise<EnrichedAsset[]> => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    await assertMemberForProduction(ctx, shot.productionId);
    const assets = await ctx.db
      .query("assets")
      .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
      .order("desc") // newest first
      .collect();
    return await Promise.all(assets.map((asset) => enrichAsset(ctx, asset)));
  },
});

export const attachToShot = mutation({
  args: {
    assetId: v.id("assets"),
    shotId: v.id("shots"),
    asVersion: v.boolean(),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new ConvexError("Asset not found");
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { userId } = await assertCanForProduction(
      ctx,
      shot.productionId,
      "version.create",
    );
    if (asset.productionId !== shot.productionId) {
      throw new ConvexError("Asset and shot belong to different productions");
    }

    if (args.asVersion) {
      // Same internal path as uploads/Drive; it patches asset.shotId,
      // computes the index, auto-moves the shot and logs version.added.
      return await createVersionWithAssetHelper(ctx, {
        shotId: shot._id,
        createdBy: userId,
        asset: { existingAssetId: asset._id },
      });
    }

    if (asset.versionId !== undefined) {
      throw new ConvexError(
        "This file already backs a version — it moves with its shot",
      );
    }
    await ctx.db.patch(asset._id, { shotId: shot._id });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: shot.productionId,
      actorId: userId,
      type: "shot.updated",
      targetType: "shot",
      targetId: shot._id,
      summary: `${name} attached '${asset.name}' to ${shot.code}`,
    });
    return null;
  },
});

export const addLink = mutation({
  args: {
    productionId: v.id("productions"),
    shotId: v.optional(v.id("shots")),
    url: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertCanForProduction(
      ctx,
      args.productionId,
      "version.create",
    );
    const url = args.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new ConvexError("Link must be an http(s) URL");
    }
    const name = args.name.trim();
    if (name.length === 0) throw new ConvexError("Give the link a name");

    let shot: Doc<"shots"> | null = null;
    if (args.shotId !== undefined) {
      shot = await ctx.db.get(args.shotId);
      if (!shot || shot.productionId !== args.productionId) {
        throw new ConvexError("Shot not found in this production");
      }
    }

    const assetId = await ctx.db.insert("assets", {
      productionId: args.productionId,
      shotId: args.shotId,
      provider: "url",
      kind: "link",
      name,
      url,
      uploadedBy: userId,
    });

    const actor = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "asset.added",
      targetType: "asset",
      targetId: assetId,
      summary: shot
        ? `${actor} added link '${name}' to ${shot.code}`
        : `${actor} added link '${name}'`,
    });
    return assetId;
  },
});
