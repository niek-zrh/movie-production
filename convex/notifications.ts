import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { PermissionError, requireUserId } from "./lib/permissions";

/**
 * In-app notification inbox. All functions are scoped to the signed-in user
 * (`requireUserId` is the membership gate here — rows are per-user, not
 * per-studio). Notification mutations write no activity rows: they mutate
 * private inbox state, not production state (documented exception to the
 * activity rule — the notifications contract lists no activity types).
 */

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 50), 200));
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    const nameCache = new Map<Id<"productions">, string | undefined>();
    const enriched = [];
    for (const row of rows) {
      let productionName: string | undefined;
      if (row.productionId !== undefined) {
        if (nameCache.has(row.productionId)) {
          productionName = nameCache.get(row.productionId);
        } else {
          const production = await ctx.db.get(row.productionId);
          productionName = production?.name;
          nameCache.set(row.productionId, productionName);
        }
      }
      enriched.push({ ...row, productionName });
    }
    return enriched;
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    // The UI caps the badge at 99, so 99 unread rows is all we ever count.
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", userId).eq("readAt", undefined),
      )
      .take(99);
    return unread.length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;
    if (notification.userId !== userId) {
      throw new PermissionError("Not your notification");
    }
    if (notification.readAt === undefined) {
      await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    }
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", userId).eq("readAt", undefined),
      )
      .collect();
    const now = Date.now();
    for (const notification of unread) {
      await ctx.db.patch(notification._id, { readAt: now });
    }
    return null;
  },
});
