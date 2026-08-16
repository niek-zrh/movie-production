import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertMemberForProduction,
  canDecideGate,
  getMembership,
  PermissionError,
  requireUserId,
  roleHas,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notifyMany } from "./lib/notify";
import { STAGE_BY_KEY } from "./lib/domain";

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

/**
 * Human-readable label + app href for an approval's target, shared by
 * `myPending` and `ledger`.
 */
async function targetInfo(
  ctx: QueryCtx | MutationCtx,
  approval: Doc<"approvals">,
  production: Doc<"productions">,
): Promise<{ targetLabel: string; href: string }> {
  const base = `/p/${production._id}`;
  switch (approval.scope) {
    case "stage_gate": {
      const id = ctx.db.normalizeId("stageInstances", approval.targetId);
      const stageInstance = id ? await ctx.db.get(id) : null;
      const label = stageInstance
        ? STAGE_BY_KEY[stageInstance.stage].label
        : "Stage";
      return {
        targetLabel: `Gate: ${label} — ${production.name}`,
        href: `${base}/board`,
      };
    }
    case "delivery": {
      const id = ctx.db.normalizeId("qcRuns", approval.targetId);
      const run = id ? await ctx.db.get(id) : null;
      return {
        targetLabel: `QC: ${run?.name ?? "QC run"}`,
        href: `${base}/qc`,
      };
    }
    case "version": {
      const id = ctx.db.normalizeId("versions", approval.targetId);
      const version = id ? await ctx.db.get(id) : null;
      const shot = version ? await ctx.db.get(version.shotId) : null;
      return shot
        ? { targetLabel: shot.code, href: `${base}/shots/${shot._id}` }
        : { targetLabel: "Version", href: base };
    }
    case "shot": {
      const id = ctx.db.normalizeId("shots", approval.targetId);
      const shot = id ? await ctx.db.get(id) : null;
      return shot
        ? { targetLabel: shot.code, href: `${base}/shots/${shot._id}` }
        : { targetLabel: "Shot", href: base };
    }
  }
}

export const requestGateSignoff = mutation({
  args: { stageInstanceId: v.id("stageInstances") },
  handler: async (ctx, args) => {
    const stageInstance = await ctx.db.get(args.stageInstanceId);
    if (!stageInstance) throw new ConvexError("Stage not found");
    const { userId, member, production } = await assertMemberForProduction(
      ctx,
      stageInstance.productionId,
    );
    if (
      !roleHas(member.role, "content.edit") &&
      !roleHas(member.role, "production.manage")
    ) {
      throw new PermissionError(
        `Your role (${member.role}) cannot request gate sign-off`,
      );
    }
    if (stageInstance.gateApproverIds.length === 0) {
      throw new ConvexError("Set gate approvers in production settings first");
    }

    await ctx.db.patch(stageInstance._id, { gateStatus: "requested" });

    const existing = await ctx.db
      .query("approvals")
      .withIndex("by_target", (q) =>
        q.eq("scope", "stage_gate").eq("targetId", args.stageInstanceId),
      )
      .collect();
    const alreadyPending = new Set(
      existing.filter((r) => r.status === "pending").map((r) => r.approverId),
    );
    for (const approverId of stageInstance.gateApproverIds) {
      if (alreadyPending.has(approverId)) continue; // skip existing pending
      await ctx.db.insert("approvals", {
        productionId: stageInstance.productionId,
        scope: "stage_gate",
        targetId: args.stageInstanceId,
        requestedBy: userId,
        approverId,
        status: "pending",
      });
    }

    const name = await actorName(ctx, userId);
    const label = STAGE_BY_KEY[stageInstance.stage].label;
    await notifyMany(ctx, stageInstance.gateApproverIds, {
      actorId: userId,
      productionId: stageInstance.productionId,
      type: "approval_requested",
      title: `${name} requested gate sign-off: ${label}`,
      body: production.name,
      href: `/p/${stageInstance.productionId}/board`,
    });
    await logActivity(ctx, {
      productionId: stageInstance.productionId,
      actorId: userId,
      type: "gate.requested",
      targetType: "stageInstance",
      targetId: args.stageInstanceId,
      summary: `${name} requested sign-off on the ${label} gate`,
    });
  },
});

export const decideGate = mutation({
  args: {
    stageInstanceId: v.id("stageInstances"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stageInstance = await ctx.db.get(args.stageInstanceId);
    if (!stageInstance) throw new ConvexError("Stage not found");
    const { userId, member, production } = await assertMemberForProduction(
      ctx,
      stageInstance.productionId,
    );
    if (!canDecideGate(member, stageInstance, userId)) {
      throw new PermissionError("You are not an approver for this gate");
    }
    const note = args.note?.trim() ? args.note.trim() : undefined;
    if (args.decision === "rejected" && note === undefined) {
      throw new ConvexError("A note is required when rejecting a gate");
    }

    const now = Date.now();
    await ctx.db.patch(stageInstance._id, {
      gateStatus: args.decision,
      gateDecidedBy: userId,
      gateDecidedAt: now,
      gateNote: note,
      // Approving a gate also completes the stage (CONTRACTS.md).
      ...(args.decision === "approved" ? { status: "done" as const } : {}),
    });

    const name = await actorName(ctx, userId);
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_target", (q) =>
        q.eq("scope", "stage_gate").eq("targetId", args.stageInstanceId),
      )
      .collect();
    const pending = rows.filter((r) => r.status === "pending");
    let deciderHadPendingRow = false;
    for (const row of pending) {
      if (row.approverId === userId) {
        deciderHadPendingRow = true;
        await ctx.db.patch(row._id, {
          status: args.decision,
          decidedAt: now,
          note,
        });
      } else {
        // Other approvers' pending rows resolve with the same decision.
        await ctx.db.patch(row._id, {
          status: args.decision,
          decidedAt: now,
          note: `decided by ${name}`,
        });
      }
    }
    if (!deciderHadPendingRow) {
      await ctx.db.insert("approvals", {
        productionId: stageInstance.productionId,
        scope: "stage_gate",
        targetId: args.stageInstanceId,
        requestedBy: userId,
        approverId: userId,
        status: args.decision,
        decidedAt: now,
        note,
      });
    }

    // Notify the original requesters + production producers (gate_decided).
    const producerIds = (
      await ctx.db
        .query("memberships")
        .withIndex("by_studio", (q) => q.eq("studioId", production.studioId))
        .collect()
    ).flatMap((m) =>
      (m.role === "producer" || m.role === "owner") && m.userId !== undefined
        ? [m.userId]
        : [],
    );
    const label = STAGE_BY_KEY[stageInstance.stage].label;
    const verb = args.decision === "approved" ? "approved" : "rejected";
    await notifyMany(
      ctx,
      [...pending.map((r) => r.requestedBy), ...producerIds],
      {
        actorId: userId,
        productionId: stageInstance.productionId,
        type: "gate_decided",
        title: `${name} ${verb} the ${label} gate`,
        body: note ?? production.name,
        href: `/p/${stageInstance.productionId}/board`,
      },
    );
    await logActivity(ctx, {
      productionId: stageInstance.productionId,
      actorId: userId,
      type: args.decision === "approved" ? "gate.approved" : "gate.rejected",
      targetType: "stageInstance",
      targetId: args.stageInstanceId,
      summary: note
        ? `${name} ${verb} the ${label} gate — "${note}"`
        : `${name} ${verb} the ${label} gate`,
    });
  },
});

export const myPending = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_approver_status", (q) =>
        q.eq("approverId", userId).eq("status", "pending"),
      )
      .collect();
    rows.sort((a, b) => b._creationTime - a._creationTime);

    const out: Array<
      Doc<"approvals"> & {
        productionName: string;
        targetLabel: string;
        href: string;
      }
    > = [];
    for (const approval of rows) {
      const production = await ctx.db.get(approval.productionId);
      if (!production) continue;
      // Membership assertion per row — drop rows from studios I've left.
      const member = await getMembership(ctx, production.studioId, userId);
      if (!member) continue;
      const { targetLabel, href } = await targetInfo(ctx, approval, production);
      out.push({
        ...approval,
        productionName: production.name,
        targetLabel,
        href,
      });
    }
    return out;
  },
});

export const ledger = query({
  args: {
    productionId: v.id("productions"),
    scope: v.optional(
      v.union(
        v.literal("stage_gate"),
        v.literal("shot"),
        v.literal("version"),
        v.literal("delivery"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { production } = await assertMemberForProduction(
      ctx,
      args.productionId,
    );
    let rows = await ctx.db
      .query("approvals")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    if (args.scope !== undefined) {
      rows = rows.filter((r) => r.scope === args.scope);
    }
    rows.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(
      rows.map(async (approval) => {
        const { targetLabel, href } = await targetInfo(
          ctx,
          approval,
          production,
        );
        return {
          ...approval,
          requestedByUser: await userRef(ctx, approval.requestedBy),
          approverUser: await userRef(ctx, approval.approverId),
          targetLabel,
          href,
        };
      }),
    );
  },
});
