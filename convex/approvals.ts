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

/** Label + href pair returned for an approval's target (CONTRACTS.md). */
type TargetInfo = { targetLabel: string; href: string };

/**
 * Per-call document memo. A ledger page is the same handful of approvers and
 * the same shots over and over, and every ctx.db.get counts against Convex's
 * 4,096-read ceiling — so each user/target document is fetched exactly once
 * per call. Promises (not results) are cached, so rows enriched concurrently
 * share one read.
 */
type LedgerCache = {
  users: Map<string, Promise<UserRef>>;
  targets: Map<string, Promise<TargetInfo>>;
};

function newLedgerCache(): LedgerCache {
  return { users: new Map(), targets: new Map() };
}

async function loadUserRef(
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

function userRef(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  cache: Map<string, Promise<UserRef>>,
): Promise<UserRef> {
  const cached = cache.get(userId);
  if (cached !== undefined) return cached;
  const pending = loadUserRef(ctx, userId);
  cache.set(userId, pending);
  return pending;
}

/**
 * Human-readable label + app href for an approval's target, shared by
 * `myPending` and `ledger`. `cache` is optional: `ledger` passes one so a
 * shot picked ten times is read once (a pick costs the version *and* its
 * shot); `myPending` has a handful of rows and passes none.
 */
function targetInfo(
  ctx: QueryCtx | MutationCtx,
  approval: Doc<"approvals">,
  production: Doc<"productions">,
  cache?: Map<string, Promise<TargetInfo>>,
): Promise<TargetInfo> {
  // Production is part of the key: `myPending` spans productions and the href
  // is production-scoped.
  const key = `${production._id}:${approval.scope}:${approval.targetId}`;
  const cached = cache?.get(key);
  if (cached !== undefined) return cached;
  const pending = loadTargetInfo(ctx, approval, production);
  cache?.set(key, pending);
  return pending;
}

async function loadTargetInfo(
  ctx: QueryCtx | MutationCtx,
  approval: Doc<"approvals">,
  production: Doc<"productions">,
): Promise<TargetInfo> {
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

    // A fresh request reopens the gate, so the stage may no longer read as
    // complete: invariant — status "done" only while gateStatus is "approved"
    // (CONTRACTS.md approvals.ts). Re-requesting after an approval takes the
    // stage back to "active"; other statuses are left untouched.
    await ctx.db.patch(stageInstance._id, {
      gateStatus: "requested",
      ...(stageInstance.status === "done" ? { status: "active" as const } : {}),
    });

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
    // A decided gate is closed: a second approver must not silently overturn
    // the first (CONTRACTS.md approvals.ts). Reopening is explicit — a fresh
    // `requestGateSignoff` puts the gate back to "requested".
    if (
      stageInstance.gateStatus === "approved" ||
      stageInstance.gateStatus === "rejected"
    ) {
      const decider =
        stageInstance.gateDecidedBy !== undefined
          ? await actorName(ctx, stageInstance.gateDecidedBy)
          : "Someone";
      throw new ConvexError(
        `${decider} already ${stageInstance.gateStatus} this gate — request sign-off again before deciding`,
      );
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
      // Approving a gate also completes the stage (CONTRACTS.md); a rejection
      // takes a completed stage back to "active" — same invariant as above, a
      // stage never reads "done" on a gate that is not approved.
      ...(args.decision === "approved"
        ? { status: "done" as const }
        : stageInstance.status === "done"
          ? { status: "active" as const }
          : {}),
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

/**
 * Hard bounds on one ledger() call. Convex refuses a function that reads more
 * than 4,096 documents, and this query backs the whole Decisions page plus its
 * CSV export (spec F9). Every pick writes an approval, so the old unbounded
 * collect() — plus up to four enrichment reads per row — was the same time
 * bomb that killed shots.list: past a few thousand decisions the page dies for
 * good. We stream by_production newest-first and stop at MAX_LEDGER_ROWS rows
 * after looking at no more than MAX_LEDGER_SCAN approvals, so the worst case
 * is 1,500 + 4 x 500 = 3,500 reads whatever the data looks like.
 *
 * What happens at the ceiling: the newest MAX_LEDGER_ROWS decisions matching
 * the scope are returned, oldest-first history is what falls off, and the CSV
 * exports exactly the rows shown. The row shape is fixed by CONTRACTS.md, so
 * the truncation signal is the length itself — `rows.length === 500` means
 * "there may be older decisions"; the UI does not surface that yet (follow-up:
 * paging the ledger, which needs a shape change).
 *
 * The scan bound only bites with a scope filter: a filtered view searches the
 * newest MAX_LEDGER_SCAN approvals of the production, not all history, so a
 * rare scope on a very long ledger can come back short of its own cap.
 */
const MAX_LEDGER_ROWS = 500;
const MAX_LEDGER_SCAN = 1500;

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
    const scope = args.scope;
    // Index order is creation order, so .order("desc") already yields the
    // newest-first ordering the ledger table and the CSV export assert on —
    // no post-sort, and the cap therefore drops the oldest rows, not a
    // random slice.
    const stream = ctx.db
      .query("approvals")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .order("desc");

    const rows: Doc<"approvals">[] = [];
    let scanned = 0;
    for await (const approval of stream) {
      scanned += 1;
      if (scope === undefined || approval.scope === scope) rows.push(approval);
      if (rows.length >= MAX_LEDGER_ROWS || scanned >= MAX_LEDGER_SCAN) break;
    }

    const cache = newLedgerCache();
    return await Promise.all(
      rows.map(async (approval) => {
        const { targetLabel, href } = await targetInfo(
          ctx,
          approval,
          production,
          cache.targets,
        );
        return {
          ...approval,
          requestedByUser: await userRef(
            ctx,
            approval.requestedBy,
            cache.users,
          ),
          approverUser: await userRef(ctx, approval.approverId, cache.users),
          targetLabel,
          href,
        };
      }),
    );
  },
});
