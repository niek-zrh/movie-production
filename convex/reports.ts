import { ConvexError, v } from "convex/values";
import { formatInTimeZone } from "date-fns-tz";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notifyMany } from "./lib/notify";

/** Enriched user shape returned to clients (CONTRACTS.md `UserRef`). */
type UserRef = { _id: Id<"users">; name: string; image?: string };

async function getUserRef(
  ctx: QueryCtx | MutationCtx,
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

function localDate(timezone: string, ts: number): string {
  return formatInTimeZone(ts, timezone, "yyyy-MM-dd");
}

/**
 * date-fns-tz throws a RangeError on a zone it does not know, which surfaces
 * as a bare "Server Error". Timezones are validated on write now
 * (productions.create/update), but rows written before that can still hold a
 * bad one, so every single-production path checks the zone up front and
 * reports it in plain language instead.
 */
function assertUsableTimezone(production: Doc<"productions">): void {
  try {
    formatInTimeZone(Date.now(), production.timezone, "yyyy-MM-dd");
  } catch {
    throw new ConvexError(
      `Production "${production.name}" has an invalid timezone ("${production.timezone}"). A producer can fix it in production settings.`,
    );
  }
}

/**
 * All activity rows of a production whose _creationTime falls on local date
 * `date` in the production's timezone, oldest first. Filtering every row
 * through formatInTimeZone is the simplest correct day-window computation at
 * pilot scale — no epoch math.
 */
async function activityForLocalDate(
  ctx: QueryCtx | MutationCtx,
  productionId: Id<"productions">,
  timezone: string,
  date: string,
): Promise<Doc<"activity">[]> {
  const rows = await ctx.db
    .query("activity")
    .withIndex("by_production", (q) => q.eq("productionId", productionId))
    .collect();
  return rows.filter((row) => localDate(timezone, row._creationTime) === date);
}

const isHighlightPriority = (row: Doc<"activity">): boolean =>
  row.type === "version.picked" || row.type.startsWith("gate.");

/** Up to 10 summaries: picks & gate rows first, then the rest, newest-first. */
function buildHighlights(rows: Doc<"activity">[]): string[] {
  const newestFirst = [...rows].sort(
    (a, b) => b._creationTime - a._creationTime,
  );
  const priority = newestFirst.filter(isHighlightPriority);
  const rest = newestFirst.filter((row) => !isHighlightPriority(row));
  return [...priority, ...rest].slice(0, 10).map((row) => row.summary);
}

function computeStats(rows: Doc<"activity">[]): Doc<"dailyReports">["stats"] {
  const count = (...types: string[]): number =>
    rows.filter((row) => types.includes(row.type)).length;
  return {
    versionsAdded: count("version.added"),
    picks: count("version.picked"),
    rejections: count("version.rejected"),
    shotsMoved: count("shot.status_changed", "shot.stage_changed"),
    commentsAdded: count("comment.added"),
    gatesDecided: count("gate.approved", "gate.rejected"),
  };
}

async function reportForDate(
  ctx: QueryCtx | MutationCtx,
  productionId: Id<"productions">,
  date: string,
): Promise<Doc<"dailyReports"> | null> {
  return await ctx.db
    .query("dailyReports")
    .withIndex("by_production_date", (q) =>
      q.eq("productionId", productionId).eq("date", date),
    )
    .unique();
}

/**
 * Idempotent upsert of the daily report for `date`. Published reports are
 * frozen — they are returned untouched.
 */
async function generateReportForDate(
  ctx: MutationCtx,
  production: Doc<"productions">,
  date: string,
): Promise<{ reportId: Id<"dailyReports">; frozen: boolean }> {
  const existing = await reportForDate(ctx, production._id, date);
  if (existing && existing.publishedBy !== undefined) {
    return { reportId: existing._id, frozen: true };
  }
  const rows = await activityForLocalDate(
    ctx,
    production._id,
    production.timezone,
    date,
  );
  const stats = computeStats(rows);
  const highlights = buildHighlights(rows);
  if (existing) {
    await ctx.db.patch(existing._id, {
      stats,
      highlights,
      generatedAt: Date.now(),
    });
    return { reportId: existing._id, frozen: false };
  }
  const reportId = await ctx.db.insert("dailyReports", {
    productionId: production._id,
    date,
    stats,
    highlights,
    generatedAt: Date.now(),
  });
  return { reportId, frozen: false };
}

export const generateForDate = internalMutation({
  args: { productionId: v.id("productions"), date: v.string() },
  handler: async (ctx, args) => {
    const production = await ctx.db.get(args.productionId);
    if (!production) return null;
    assertUsableTimezone(production);
    await generateReportForDate(ctx, production, args.date);
    return null;
  },
});

/**
 * Hourly cron. For every active production past 18:00 local time, ensure
 * today's report exists — generated once, then left alone (regeneration is a
 * human action via generateNow).
 *
 * Every production is isolated: one unusable timezone (or any other per-row
 * failure) used to throw out of the shared handler and abort the tick for the
 * whole deployment, so nobody got a report, every hour, silently. A failing
 * production is logged with enough identity to fix it and the loop continues.
 */
export const cronTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const productions = await ctx.db.query("productions").collect();
    for (const production of productions) {
      if (production.status !== "active") continue;
      try {
        const hour = Number(formatInTimeZone(now, production.timezone, "HH"));
        if (hour < 18) continue;
        const today = localDate(production.timezone, now);
        const existing = await reportForDate(ctx, production._id, today);
        if (existing) continue;
        await generateReportForDate(ctx, production, today);
      } catch (error) {
        console.error(
          `reports.cronTick: skipped production ${production.code} "${production.name}" (${production._id}, timezone "${production.timezone}")`,
          error,
        );
      }
    }
    return null;
  },
});

export const generateNow = mutation({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const { production } = await assertCanForProduction(
      ctx,
      args.productionId,
      "report.publish",
    );
    assertUsableTimezone(production);
    const today = localDate(production.timezone, Date.now());
    const { reportId, frozen } = await generateReportForDate(
      ctx,
      production,
      today,
    );
    if (frozen) {
      throw new ConvexError("Today's report is already published and frozen");
    }
    return reportId;
  },
});

export const publish = mutation({
  args: { reportId: v.id("dailyReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError("Report not found");
    const { userId, production } = await assertCanForProduction(
      ctx,
      report.productionId,
      "report.publish",
    );
    if (report.publishedBy !== undefined) {
      throw new ConvexError("This report is already published");
    }
    await ctx.db.patch(report._id, { publishedBy: userId });

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_studio", (q) => q.eq("studioId", production.studioId))
      .collect();
    const memberIds = memberships.flatMap((m) =>
      m.userId !== undefined ? [m.userId] : [],
    );
    await notifyMany(ctx, memberIds, {
      actorId: userId,
      productionId: production._id,
      type: "report_published",
      title: `Daily report published — ${production.name} (${report.date})`,
      href: `/p/${production._id}/reports`,
    });

    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: production._id,
      actorId: userId,
      type: "report.published",
      targetType: "dailyReport",
      targetId: report._id,
      summary: `${name} published the daily report for ${report.date}`,
    });
    return null;
  },
});

export const list = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    return await ctx.db
      .query("dailyReports")
      .withIndex("by_production_date", (q) =>
        q.eq("productionId", args.productionId),
      )
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { reportId: v.id("dailyReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError("Report not found");
    const { production } = await assertMemberForProduction(
      ctx,
      report.productionId,
    );
    assertUsableTimezone(production);
    // Invariant: the day list and the stat tiles must describe the same window.
    // A published report is frozen (CONTRACTS.md) and its stats were computed
    // at `generatedAt`, so the list is bounded there too — otherwise the list
    // keeps growing next to tiles that no longer count it. An unpublished
    // report is still live, so it shows the whole day.
    const cutoff =
      report.publishedBy !== undefined ? report.generatedAt : Infinity;
    const rows = (
      await activityForLocalDate(
        ctx,
        production._id,
        production.timezone,
        report.date,
      )
    ).filter((row) => row._creationTime <= cutoff);
    rows.sort((a, b) => a._creationTime - b._creationTime); // oldest first
    const cache = new Map<Id<"users">, UserRef>();
    const dayActivity: (Doc<"activity"> & { actor: UserRef })[] = [];
    for (const row of rows) {
      dayActivity.push({
        ...row,
        actor: await getUserRef(ctx, cache, row.actorId),
      });
    }
    return { ...report, dayActivity };
  },
});
