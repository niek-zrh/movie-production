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
 * Hard bound on rows SCANNED by one feed() call. The stream already breaks at
 * `limit`, but `types` / `actorId` are matched in JS while it streams, so a
 * filter that matches little or nothing (the Review page asks for
 * `version.picked` only) walked the whole activity table — and past 4,096 rows
 * Convex hard-fails the query, permanently killing the page for that
 * production.
 *
 * At most MAX_FEED_SCAN rows plus the actor lookups (memoised, so at most one
 * per distinct actor in the returned page) are read, which stays inside the
 * ceiling on any table size.
 *
 * What happens at the ceiling: the feed returns only the matches found in the
 * newest MAX_FEED_SCAN rows — possibly fewer than `limit`, possibly none —
 * instead of failing. Both call sites want recent activity (Overview: last 15;
 * Review: today's picks), which lives at the head of the index, and `beforeTs`
 * still pages further back a bounded window at a time.
 */
const MAX_FEED_SCAN = 2000;

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
    let scanned = 0;
    for await (const row of stream) {
      scanned++;
      const matched =
        (args.types === undefined || args.types.includes(row.type)) &&
        (args.actorId === undefined || row.actorId === args.actorId);
      if (matched) {
        rows.push(row);
        if (rows.length >= limit) break;
      }
      // Bound the scan, not just the result — a filter matching nothing must
      // stop here rather than read the table to exhaustion (see above).
      if (scanned >= MAX_FEED_SCAN) break;
    }

    const cache = new Map<Id<"users">, UserRef>();
    const enriched: (Doc<"activity"> & { actor: UserRef })[] = [];
    for (const row of rows) {
      enriched.push({ ...row, actor: await getUserRef(ctx, cache, row.actorId) });
    }
    return enriched;
  },
});

/**
 * Rows for a single target, newest first. The shot detail History tab used to
 * pull the last 100 production-wide rows and filter them in JS, so on any real
 * production a shot's own history was never inside that window (spec F6).
 *
 * A shot's history also lives on its versions — version.added / .picked /
 * .rejected target the version, not the shot — so for targetType "shot" we
 * also read the shot's newest options and merge. Reads stay bounded: at most
 * MAX_VERSION_FANOUT + 1 index ranges of `limit` rows each, well under the
 * 4,096-document ceiling.
 */
const MAX_VERSION_FANOUT = 30;

export const forTarget = query({
  args: {
    productionId: v.id("productions"),
    targetType: v.string(),
    targetId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 100));

    const targets: { targetType: string; targetId: string }[] = [
      { targetType: args.targetType, targetId: args.targetId },
    ];
    if (args.targetType === "shot") {
      const shotId = ctx.db.normalizeId("shots", args.targetId);
      if (shotId !== null) {
        const versions = await ctx.db
          .query("versions")
          .withIndex("by_shot", (q) => q.eq("shotId", shotId))
          .order("desc")
          .take(MAX_VERSION_FANOUT);
        for (const version of versions)
          targets.push({ targetType: "version", targetId: version._id });
      }
    }

    const rows: Doc<"activity">[] = [];
    for (const target of targets) {
      const found = await ctx.db
        .query("activity")
        .withIndex("by_target", (q) =>
          q.eq("targetType", target.targetType).eq("targetId", target.targetId),
        )
        .order("desc")
        .take(limit);
      // targetId is a bare string on this table — never return a row from a
      // production the caller isn't a member of.
      for (const row of found)
        if (row.productionId === args.productionId) rows.push(row);
    }
    rows.sort((a, b) => b._creationTime - a._creationTime);

    const cache = new Map<Id<"users">, UserRef>();
    const enriched: (Doc<"activity"> & { actor: UserRef })[] = [];
    for (const row of rows.slice(0, limit)) {
      enriched.push({ ...row, actor: await getUserRef(ctx, cache, row.actorId) });
    }
    return enriched;
  },
});
