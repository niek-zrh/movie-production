import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * In-app notification fan-out. This is the single place a future Telegram
 * webhook would hook into (DECISIONS.md — Telegram is out of scope for the
 * pilot; add a scheduler call here when it lands).
 */
export async function notify(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    actorId?: Id<"users">; // skip self-notification when actor === recipient
    productionId?: Id<"productions">;
    type: string;
    title: string;
    body?: string;
    href?: string;
  },
): Promise<void> {
  if (args.actorId !== undefined && args.actorId === args.userId) return;
  await ctx.db.insert("notifications", {
    userId: args.userId,
    productionId: args.productionId,
    type: args.type,
    title: args.title,
    body: args.body,
    href: args.href,
  });
}

export async function notifyMany(
  ctx: MutationCtx,
  userIds: Id<"users">[],
  args: Omit<Parameters<typeof notify>[1], "userId">,
): Promise<void> {
  const unique = [...new Set(userIds)];
  for (const userId of unique) {
    await notify(ctx, { ...args, userId });
  }
}
