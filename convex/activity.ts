import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { assertMemberForProduction } from "./lib/permissions";

/** Enriched user shape returned to clients (CONTRACTS.md `UserRef`). */
type UserRef = { _id: Id<"users">; name: string; image?: string };

async function getUserRef(
  ctx: QueryCtx,
  cache: Map<Id<"users">, UserRef>,
  userId: Id<"users">,
): Promise<UserRef> {
  const cached = cache.get(userId);
  if (cached) return cached;
  const user = await ctx.db.get(userId);
  const ref: UserRef = {
    _id: userId,
    name: user?.name ?? user?.email ?? "Unknown",
    image: user?.image,
  };
  cache.set(userId, ref);
  return ref;
}

/**
 * Activity feed for a production, newest first. Optional `types` / `actorId`
 * filters are applied in JS after the indexed scan; `beforeTs` pages older
 * rows via a `_creationTime` upper bound on the index range.
 */
export const feed = query({
  args: {
    productionId: v.id("productions"),
    types: v.optional(v.array(v.string())),
    actorId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
    beforeTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 200));

    const stream = ctx.db
      .query("activity")
      .withIndex("by_production", (q) => {
        const base = q.eq("productionId", args.productionId);
        return args.beforeTs === undefined
          ? base
          : base.lt("_creationTime", args.beforeTs);
      })
      .order("desc");

    const rows: Doc<"activity">[] = [];
    for await (const row of stream) {
      if (args.types !== undefined && !args.types.includes(row.type)) continue;
      if (args.actorId !== undefined && row.actorId !== args.actorId) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }

    const cache = new Map<Id<"users">, UserRef>();
    const enriched: (Doc<"activity"> & { actor: UserRef })[] = [];
    for (const row of rows) {
      enriched.push({ ...row, actor: await getUserRef(ctx, cache, row.actorId) });
    }
    return enriched;
  },
});
