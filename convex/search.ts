import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/permissions";

const GROUP_CAP = 8;

/**
 * Read ceilings. Convex refuses a function that reads more than 4,096
 * documents, and this query runs on every keystroke of the ⌘K palette over
 * EVERY production of every studio the caller belongs to — the old
 * collect()-per-production read every shot, every scene and every asset, so
 * one big studio bricked the palette for everyone in it.
 *
 * Each group now streams its index and stops at the 8-hit cap or after
 * MAX_SCAN_PER_GROUP rows, whichever comes first. Worst case is
 * MAX_PRODUCTIONS + 3 × MAX_SCAN_PER_GROUP ≈ 3,500 documents, which leaves
 * room for the membership reads under the ceiling.
 *
 * At the ceiling search degrades instead of failing: a match that lives past
 * the 1,000th row of a group (index order, oldest first, productions
 * concatenated) is not returned, and no error is shown. That is deliberate —
 * the palette is a jump-to, not a report, and the Shots/Scenes page filters
 * stay exhaustive.
 */
const MAX_SCAN_PER_GROUP = 1000;
const MAX_PRODUCTIONS = 500;

type ProductionRef = { _id: Id<"productions">; name: string };

type ShotHit = {
  _id: Id<"shots">;
  code: string;
  title?: string;
  productionId: Id<"productions">;
  productionName: string;
};
type SceneHit = {
  _id: Id<"scenes">;
  code: string;
  title?: string;
  productionId: Id<"productions">;
  productionName: string;
};
type ProductionHit = { _id: Id<"productions">; name: string; code: string };
type AssetHit = {
  _id: Id<"assets">;
  name: string;
  productionId: Id<"productions">;
  productionName: string;
  shotId?: Id<"shots">;
};

/**
 * Global search across every studio the caller belongs to. Case-insensitive
 * substring match on code/title/name, capped at 8 hits per group. A query
 * shorter than 2 characters returns empty groups.
 */
export const global = query({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);

    const shots: ShotHit[] = [];
    const scenes: SceneHit[] = [];
    const productions: ProductionHit[] = [];
    const assets: AssetHit[] = [];

    const needle = args.q.trim().toLowerCase();
    if (needle.length < 2) return { shots, scenes, productions, assets };

    const matches = (value: string | undefined): boolean =>
      value !== undefined && value.toLowerCase().includes(needle);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // The productions in scope, resolved once: all three row groups below need
    // the production's name for their hit shape, so re-reading them per group
    // would triple the cost. Production hits are collected on the same pass.
    const scope: ProductionRef[] = [];
    for (const membership of memberships) {
      if (scope.length >= MAX_PRODUCTIONS) break;
      for await (const production of ctx.db
        .query("productions")
        .withIndex("by_studio", (q) => q.eq("studioId", membership.studioId))) {
        if (
          productions.length < GROUP_CAP &&
          (matches(production.name) || matches(production.code))
        ) {
          productions.push({
            _id: production._id,
            name: production.name,
            code: production.code,
          });
        }
        scope.push({ _id: production._id, name: production.name });
        if (scope.length >= MAX_PRODUCTIONS) break;
      }
    }

    let shotsScanned = 0;
    for (const production of scope) {
      if (shots.length >= GROUP_CAP || shotsScanned >= MAX_SCAN_PER_GROUP)
        break;
      for await (const shot of ctx.db
        .query("shots")
        .withIndex("by_production", (q) =>
          q.eq("productionId", production._id),
        )) {
        shotsScanned++;
        if (matches(shot.code) || matches(shot.title)) {
          shots.push({
            _id: shot._id,
            code: shot.code,
            title: shot.title,
            productionId: production._id,
            productionName: production.name,
          });
          if (shots.length >= GROUP_CAP) break;
        }
        if (shotsScanned >= MAX_SCAN_PER_GROUP) break;
      }
    }

    let scenesScanned = 0;
    for (const production of scope) {
      if (scenes.length >= GROUP_CAP || scenesScanned >= MAX_SCAN_PER_GROUP)
        break;
      for await (const scene of ctx.db
        .query("scenes")
        .withIndex("by_production", (q) =>
          q.eq("productionId", production._id),
        )) {
        scenesScanned++;
        if (matches(scene.code) || matches(scene.title)) {
          scenes.push({
            _id: scene._id,
            code: scene.code,
            title: scene.title,
            productionId: production._id,
            productionName: production.name,
          });
          if (scenes.length >= GROUP_CAP) break;
        }
        if (scenesScanned >= MAX_SCAN_PER_GROUP) break;
      }
    }

    let assetsScanned = 0;
    for (const production of scope) {
      if (assets.length >= GROUP_CAP || assetsScanned >= MAX_SCAN_PER_GROUP)
        break;
      for await (const asset of ctx.db
        .query("assets")
        .withIndex("by_production", (q) =>
          q.eq("productionId", production._id),
        )) {
        assetsScanned++;
        if (matches(asset.name)) {
          assets.push({
            _id: asset._id,
            name: asset.name,
            productionId: production._id,
            productionName: production.name,
            shotId: asset.shotId,
          });
          if (assets.length >= GROUP_CAP) break;
        }
        if (assetsScanned >= MAX_SCAN_PER_GROUP) break;
      }
    }

    return { shots, scenes, productions, assets };
  },
});
