import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Append-only activity feed (spec §6 invariant: every state-changing mutation
 * writes one row with a human-readable summary).
 */
export async function logActivity(
  ctx: MutationCtx,
  args: {
    productionId: Id<"productions">;
    actorId: Id<"users">;
    type: string; // "shot.status_changed", "version.picked", "gate.approved"…
    targetType: string;
    targetId: string;
    summary: string;
    data?: Record<string, unknown>;
  },
): Promise<Id<"activity">> {
  return await ctx.db.insert("activity", {
    productionId: args.productionId,
    actorId: args.actorId,
    type: args.type,
    targetType: args.targetType,
    targetId: args.targetId,
    summary: args.summary,
    data: args.data === undefined ? undefined : JSON.stringify(args.data),
  });
}

export async function actorName(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const user = await ctx.db.get(userId);
  return user?.name ?? user?.email ?? "Someone";
}
