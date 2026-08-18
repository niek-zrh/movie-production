import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { createVersionWithAssetHelper } from "./versions";
import type { EnrichedAsset } from "./versions";

/**
 * Asset library (spec §7). Assets are the files/links behind versions plus
 * anything synced from the Drive hub that hasn't been assigned to a shot yet.
 * Version creation always routes through versions.createVersionWithAssetHelper
 * so index logic lives in exactly one place.
 */

/**
 * Hard bound on the rows one list returns. Convex refuses a function that
 * reads more than 4,096 documents, and an enriched asset costs the row plus
 * up to two ctx.storage.getUrl lookups (thumb + file) — the old unbounded
 * collect() therefore bricked the Files page for good somewhere past ~1,400
 * assets, well inside this pilot's projected ~6,000 versions.
 *
 * At the cap the newest MAX_LIST_ASSETS rows come back and the array is
 * exactly that long. The shape is unchanged (CONTRACTS §assets), so a caller
 * that wants to say "showing the newest 750" tests `assets.length` against
 * this ceiling; `q` / `unassignedOnly` narrow the scan server-side, so older
 * files stay reachable by name instead of only through this newest page.
 */
const MAX_LIST_ASSETS = 750;

/**
 * Hard bound on the rows one list *examines*. A filter that matches almost
 * nothing (unassignedOnly on a fully assigned production) would otherwise
 * stream the whole table looking for MAX_LIST_ASSETS hits and hit the read
 * ceiling anyway. Past this many rows a filtered view shows the newest
 * matches rather than every match — never a silent partial for the unfiltered
 * Files page, which stops at MAX_LIST_ASSETS first.
 *
 * Worst case for one call: 2,000 rows streamed + 2 × 750 URL lookups = 3,500
 * reads, ~600 under the ceiling.
 */
const MAX_ASSET_SCAN = 2000;

/**
 * Per-call storage URL memo. Image uploads reuse the file itself as their
 * thumbnail (versions.addFromUpload: `thumbStorageId ?? storageId`), so naive
 * enrichment resolves the same id twice on every such row, and each getUrl
 * counts against the read ceiling. The promise (not the string) is cached so
 * parallel enrichment can't race two lookups of one id — same trick as the
 * enrich cache in shots.list.
 */
type UrlCache = Map<Id<"_storage">, Promise<string | null>>;

function cachedUrl(
  ctx: QueryCtx,
  cache: UrlCache,
  storageId: Id<"_storage">,
): Promise<string | null> {
  const cached = cache.get(storageId);
  if (cached !== undefined) return cached;
  const pending = ctx.storage.getUrl(storageId);
  cache.set(storageId, pending);
  return pending;
}

/**
 * Same enrichment as versions.enrichAsset — thumbUrl from the cached
 * thumbnail, fileUrl per provider (CONTRACTS §assets) — with the lookups
 * routed through the per-call memo, which that shared helper has no place to
 * hold. Keep the provider branches in step with versions.enrichAsset.
 */
async function enrichAssetCached(
  ctx: QueryCtx,
  asset: Doc<"assets">,
  cache: UrlCache,
): Promise<EnrichedAsset> {
  const thumbUrl =
    asset.thumbStorageId !== undefined
      ? await cachedUrl(ctx, cache, asset.thumbStorageId)
      : null;
  let fileUrl: string | null = null;
  if (asset.provider === "storage" && asset.storageId !== undefined) {
    fileUrl = await cachedUrl(ctx, cache, asset.storageId);
  } else if (asset.provider === "gdrive") {
    fileUrl = asset.webViewLink ?? null;
  } else if (asset.provider === "url") {
    fileUrl = asset.url ?? null;
  }
  return { ...asset, thumbUrl, fileUrl };
}

export const listForProduction = query({
  args: {
    productionId: v.id("productions"),
    unassignedOnly: v.optional(v.boolean()),
    q: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EnrichedAsset[]> => {
    await assertMemberForProduction(ctx, args.productionId);
    const unassignedOnly = args.unassignedOnly === true;
    const needle = args.q?.trim().toLowerCase();
    const stream = ctx.db
      .query("assets")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .order("desc"); // newest first

    // Both filters run while the index streams, so a discarded row never
    // costs a storage lookup and the scan stops at the caps above.
    const assets: Doc<"assets">[] = [];
    let scanned = 0;
    for await (const asset of stream) {
      scanned += 1;
      const unassigned =
        asset.shotId === undefined &&
        asset.versionId === undefined &&
        asset.kind === "file";
      const matchesNeedle =
        needle === undefined ||
        needle.length === 0 ||
        asset.name.toLowerCase().includes(needle);
      if ((!unassignedOnly || unassigned) && matchesNeedle) assets.push(asset);
      if (assets.length >= MAX_LIST_ASSETS || scanned >= MAX_ASSET_SCAN) break;
    }

    const urls: UrlCache = new Map();
    return await Promise.all(
      assets.map((asset) => enrichAssetCached(ctx, asset, urls)),
    );
  },
});

export const listForShot = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args): Promise<EnrichedAsset[]> => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    await assertMemberForProduction(ctx, shot.productionId);
    const stream = ctx.db
      .query("assets")
      .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
      .order("desc"); // newest first

    // One shot holds a handful of files, so the cap is unreachable here in
    // normal use; it exists so a runaway sync can't take the shot's Files tab
    // down the way it took the Files page down (see MAX_LIST_ASSETS).
    const assets: Doc<"assets">[] = [];
    for await (const asset of stream) {
      assets.push(asset);
      if (assets.length >= MAX_LIST_ASSETS) break;
    }

    const urls: UrlCache = new Map();
    return await Promise.all(
      assets.map((asset) => enrichAssetCached(ctx, asset, urls)),
    );
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
