import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * One-off data migrations, run by hand:
 *   npx convex run migrations:backfillVersionsCount '{}'
 *
 * Internal on purpose — nothing here should ever be reachable over HTTP.
 */

/**
 * `shots.versionsCount` was denormalised so shots.list stops reading every
 * version of every shot (that N+1 inside an unbounded collect is what made a
 * production unopenable past ~4k shots). Rows written before the field existed
 * read as 0 — visibly wrong on the Shots table, grid, Board and Review queue,
 * which all show an option count.
 *
 * Pages through the shots table in batches so one call can never approach
 * Convex's per-transaction read limit; re-run until it reports `done: true`.
 * Idempotent: a shot whose stored count already matches is left alone.
 */
export const backfillVersionsCount = internalMutation({
  args: { cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? 200, 1), 500);
    const page = await ctx.db
      .query("shots")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const shot of page.page) {
      const versions = await ctx.db
        .query("versions")
        .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
        .collect();
      if (shot.versionsCount === versions.length) continue;
      await ctx.db.patch(shot._id, { versionsCount: versions.length });
      patched += 1;
    }

    return {
      scanned: page.page.length,
      patched,
      done: page.isDone,
      // Feed this back in as `cursor` to continue.
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
