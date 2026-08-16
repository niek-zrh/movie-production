import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUserId } from "./lib/permissions";

const GROUP_CAP = 8;

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

    for (const membership of memberships) {
      const studioProductions = await ctx.db
        .query("productions")
        .withIndex("by_studio", (q) => q.eq("studioId", membership.studioId))
        .collect();

      for (const production of studioProductions) {
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

        if (shots.length < GROUP_CAP) {
          const rows = await ctx.db
            .query("shots")
            .withIndex("by_production", (q) =>
              q.eq("productionId", production._id),
            )
            .collect();
          for (const shot of rows) {
            if (shots.length >= GROUP_CAP) break;
            if (matches(shot.code) || matches(shot.title)) {
              shots.push({
                _id: shot._id,
                code: shot.code,
                title: shot.title,
                productionId: production._id,
                productionName: production.name,
              });
            }
          }
        }

        if (scenes.length < GROUP_CAP) {
          const rows = await ctx.db
            .query("scenes")
            .withIndex("by_production", (q) =>
              q.eq("productionId", production._id),
            )
            .collect();
          for (const scene of rows) {
            if (scenes.length >= GROUP_CAP) break;
            if (matches(scene.code) || matches(scene.title)) {
              scenes.push({
                _id: scene._id,
                code: scene.code,
                title: scene.title,
                productionId: production._id,
                productionName: production.name,
              });
            }
          }
        }

        if (assets.length < GROUP_CAP) {
          const rows = await ctx.db
            .query("assets")
            .withIndex("by_production", (q) =>
              q.eq("productionId", production._id),
            )
            .collect();
          for (const asset of rows) {
            if (assets.length >= GROUP_CAP) break;
            if (matches(asset.name)) {
              assets.push({
                _id: asset._id,
                name: asset.name,
                productionId: production._id,
                productionName: production.name,
                shotId: asset.shotId,
              });
            }
          }
        }
      }
    }

    return { shots, scenes, productions, assets };
  },
});
