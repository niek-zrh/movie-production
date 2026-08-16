import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
  PermissionError,
  roleHas,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notifyMany } from "./lib/notify";
import { STAGE_BY_KEY } from "./lib/domain";

const commentTargetType = v.union(
  v.literal("shot"),
  v.literal("version"),
  v.literal("stage"),
  v.literal("report"),
  v.literal("qcRun"),
);

type CommentTargetType = "shot" | "version" | "stage" | "report" | "qcRun";

/** Enriched user shape used across returns (CONTRACTS.md). */
type UserRef = { _id: Id<"users">; name: string; image?: string };

async function userRef(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<UserRef> {
  const user = await ctx.db.get(userId);
  return {
    _id: userId,
    name: user?.name ?? user?.email ?? "Unknown",
    image: user?.image,
  };
}

function snippet(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

const FALLBACK_LABEL: Record<CommentTargetType, string> = {
  shot: "a shot",
  version: "a version",
  stage: "a stage",
  report: "a report",
  qcRun: "a QC run",
};

function fallbackHref(
  productionId: Id<"productions">,
  targetType: CommentTargetType,
  targetId: string,
): string {
  switch (targetType) {
    case "shot":
      return `/p/${productionId}/shots/${targetId}`;
    case "stage":
      return `/p/${productionId}/board`;
    case "report":
      return `/p/${productionId}/reports`;
    case "qcRun":
      return `/p/${productionId}/qc`;
    case "version":
      // Version pages live under their shot; the client passes hrefHint.
      return `/p/${productionId}`;
  }
}

/**
 * Resolve a comment target to its production plus a human label and href.
 * Returns null when the targetId doesn't resolve to a known document.
 */
async function resolveCommentTarget(
  ctx: QueryCtx | MutationCtx,
  targetType: CommentTargetType,
  targetId: string,
): Promise<{
  productionId: Id<"productions">;
  label: string;
  href: string;
} | null> {
  switch (targetType) {
    case "shot": {
      const id = ctx.db.normalizeId("shots", targetId);
      const shot = id ? await ctx.db.get(id) : null;
      if (!shot) return null;
      return {
        productionId: shot.productionId,
        label: shot.code,
        href: `/p/${shot.productionId}/shots/${shot._id}`,
      };
    }
    case "version": {
      const id = ctx.db.normalizeId("versions", targetId);
      const version = id ? await ctx.db.get(id) : null;
      if (!version) return null;
      const shot = await ctx.db.get(version.shotId);
      return {
        productionId: version.productionId,
        label: shot ? `v${version.index} of ${shot.code}` : `v${version.index}`,
        href: shot
          ? `/p/${version.productionId}/shots/${shot._id}`
          : `/p/${version.productionId}`,
      };
    }
    case "stage": {
      const id = ctx.db.normalizeId("stageInstances", targetId);
      const stageInstance = id ? await ctx.db.get(id) : null;
      if (!stageInstance) return null;
      return {
        productionId: stageInstance.productionId,
        label: `the ${STAGE_BY_KEY[stageInstance.stage].label} stage`,
        href: `/p/${stageInstance.productionId}/board`,
      };
    }
    case "report": {
      const id = ctx.db.normalizeId("dailyReports", targetId);
      const report = id ? await ctx.db.get(id) : null;
      if (!report) return null;
      return {
        productionId: report.productionId,
        label: `the daily report for ${report.date}`,
        href: `/p/${report.productionId}/reports`,
      };
    }
    case "qcRun": {
      const id = ctx.db.normalizeId("qcRuns", targetId);
      const run = id ? await ctx.db.get(id) : null;
      if (!run) return null;
      return {
        productionId: run.productionId,
        label: `QC run "${run.name}"`,
        href: `/p/${run.productionId}/qc`,
      };
    }
  }
}

export const list = query({
  args: { targetType: commentTargetType, targetId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("comments")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId),
      )
      .collect();
    const resolved = await resolveCommentTarget(
      ctx,
      args.targetType,
      args.targetId,
    );
    const productionId = resolved?.productionId ?? rows[0]?.productionId;
    if (productionId === undefined) return [];
    await assertMemberForProduction(ctx, productionId);
    return await Promise.all(
      rows
        .filter((c) => c.productionId === productionId)
        .sort((a, b) => a._creationTime - b._creationTime)
        .map(async (c) => ({
          ...c,
          author: await userRef(ctx, c.authorId),
          mentionUsers: await Promise.all(
            c.mentions.map((m) => userRef(ctx, m)),
          ),
        })),
    );
  },
});

export const add = mutation({
  args: {
    productionId: v.id("productions"),
    targetType: commentTargetType,
    targetId: v.string(),
    body: v.string(),
    mentions: v.array(v.id("users")),
    hrefHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertCanForProduction(
      ctx,
      args.productionId,
      "comment.create",
    );
    const body = args.body.trim();
    if (!body) throw new Error("Comment can't be empty");
    const resolved = await resolveCommentTarget(
      ctx,
      args.targetType,
      args.targetId,
    );
    if (resolved && resolved.productionId !== args.productionId) {
      throw new Error("Target does not belong to this production");
    }

    const mentions = [...new Set(args.mentions)];
    const commentId = await ctx.db.insert("comments", {
      productionId: args.productionId,
      targetType: args.targetType,
      targetId: args.targetId,
      authorId: userId,
      body,
      mentions,
    });

    const name = await actorName(ctx, userId);
    const href =
      args.hrefHint ??
      resolved?.href ??
      fallbackHref(args.productionId, args.targetType, args.targetId);
    await notifyMany(ctx, mentions, {
      actorId: userId,
      productionId: args.productionId,
      type: "mention",
      title: `${name} mentioned you`,
      body: snippet(body, 120),
      href,
    });
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "comment.added",
      targetType: args.targetType,
      targetId: args.targetId,
      summary: `${name} commented on ${
        resolved?.label ?? FALLBACK_LABEL[args.targetType]
      } — "${snippet(body, 80)}"`,
    });
    return commentId;
  },
});

export const resolve = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");
    const { userId, member } = await assertMemberForProduction(
      ctx,
      comment.productionId,
    );
    if (comment.authorId !== userId && !roleHas(member.role, "content.edit")) {
      throw new PermissionError(
        "Only the author or an editor can resolve this comment",
      );
    }
    await ctx.db.patch(comment._id, {
      resolvedBy: userId,
      resolvedAt: Date.now(),
    });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: comment.productionId,
      actorId: userId,
      type: "comment.resolved",
      targetType: comment.targetType,
      targetId: comment.targetId,
      summary: `${name} resolved a comment — "${snippet(comment.body, 80)}"`,
    });
  },
});
