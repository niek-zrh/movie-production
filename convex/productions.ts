import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCan,
  assertCanForProduction,
  assertMember,
  assertMemberForProduction,
  canDecideGate,
  getMembership,
  PermissionError,
  roleHas,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { STAGE_BY_KEY, STAGES } from "./lib/domain";

/** Enriched user shape shared across returns (CONTRACTS.md). */
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

/** Drive hub info safe for clients: folder ids only, no connection id. */
type PublicHub = {
  rootFolderId: string;
  folderIds: Record<string, string>;
  driveKind: "myDrive" | "sharedDrive";
  sharedDriveId?: string;
};

/**
 * Production shape returned to clients. `hub.connectionId` is stripped —
 * clients only get presence (`hubConnected`) plus folder ids (CONTRACTS.md:
 * "Never include hub.connectionId semantics beyond presence").
 */
function publicProduction(
  production: Doc<"productions">,
): Omit<Doc<"productions">, "hub"> & {
  hub?: PublicHub;
  hubConnected: boolean;
} {
  const { hub, ...rest } = production;
  return {
    ...rest,
    hub:
      hub === undefined
        ? undefined
        : {
            rootFolderId: hub.rootFolderId,
            folderIds: hub.folderIds,
            driveKind: hub.driveKind,
            sharedDriveId: hub.sharedDriveId,
          },
    hubConnected: hub !== undefined,
  };
}

const productionStatus = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("wrapped"),
);

const stageInstanceStatus = v.union(
  v.literal("not_started"),
  v.literal("active"),
  v.literal("blocked"),
  v.literal("done"),
);

const STAGE_STATUS_LABEL: Record<
  Doc<"stageInstances">["status"],
  string
> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

export const create = mutation({
  args: {
    studioId: v.id("studios"),
    name: v.string(),
    code: v.string(),
    kind: v.union(v.literal("feature"), v.literal("episodic")),
    episodeCount: v.optional(v.number()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"productions">> => {
    const { userId } = await assertCan(
      ctx,
      args.studioId,
      "production.manage",
    );

    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Production name is too short");

    const code = args.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(code))
      throw new ConvexError("Code must be 2–6 characters, A–Z or 0–9");
    const siblings = await ctx.db
      .query("productions")
      .withIndex("by_studio", (q) => q.eq("studioId", args.studioId))
      .collect();
    if (siblings.some((p) => p.code === code))
      throw new ConvexError(`Code ${code} is already used in this studio`);

    const timezone = args.timezone?.trim() || "Europe/Zurich";

    const productionId = await ctx.db.insert("productions", {
      studioId: args.studioId,
      name,
      code,
      kind: args.kind,
      status: "active",
      timezone,
    });

    // Seed the six stage instances: stage 1 active, the rest not started,
    // all gates open with no approvers yet.
    for (const stage of STAGES) {
      await ctx.db.insert("stageInstances", {
        productionId,
        stage: stage.key,
        status: stage.order === 1 ? "active" : "not_started",
        gateApproverIds: [],
        gateStatus: "open",
      });
    }

    if (args.kind === "episodic" && args.episodeCount !== undefined) {
      const count = Math.floor(args.episodeCount);
      if (count < 1 || count > 200)
        throw new ConvexError("Episode count must be between 1 and 200");
      for (let number = 1; number <= count; number++) {
        await ctx.db.insert("episodes", { productionId, number });
      }
    }

    await logActivity(ctx, {
      productionId,
      actorId: userId,
      type: "production.created",
      targetType: "production",
      targetId: productionId,
      summary: `${await actorName(ctx, userId)} created production ${code} — ${name}`,
    });

    return productionId;
  },
});

export const listForStudio = query({
  args: { studioId: v.id("studios") },
  handler: async (ctx, args) => {
    await assertMember(ctx, args.studioId);
    const productions = await ctx.db
      .query("productions")
      .withIndex("by_studio", (q) => q.eq("studioId", args.studioId))
      .collect();
    return await Promise.all(
      productions.map(async (production) => {
        const shots = await ctx.db
          .query("shots")
          .withIndex("by_production", (q) =>
            q.eq("productionId", production._id),
          )
          .collect();
        const byStatus: Record<string, number> = {};
        for (const shot of shots) {
          byStatus[shot.status] = (byStatus[shot.status] ?? 0) + 1;
        }
        return {
          ...publicProduction(production),
          shotCounts: { total: shots.length, byStatus },
        };
      }),
    );
  },
});

export const get = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    const { production } = await assertMemberForProduction(
      ctx,
      args.productionId,
    );
    const episodes = (
      await ctx.db
        .query("episodes")
        .withIndex("by_production", (q) =>
          q.eq("productionId", args.productionId),
        )
        .collect()
    ).sort((a, b) => a.number - b.number);
    return { ...publicProduction(production), episodes };
  },
});

export const update = mutation({
  args: {
    productionId: v.id("productions"),
    name: v.optional(v.string()),
    status: v.optional(productionStatus),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, production } = await assertCanForProduction(
      ctx,
      args.productionId,
      "production.manage",
    );

    const changes: string[] = [];
    let name: string | undefined;
    if (args.name !== undefined) {
      name = args.name.trim();
      if (name.length < 2) throw new ConvexError("Production name is too short");
      if (name !== production.name) changes.push(`renamed to "${name}"`);
      else name = undefined;
    }
    let status: Doc<"productions">["status"] | undefined;
    if (args.status !== undefined && args.status !== production.status) {
      status = args.status;
      changes.push(`status → ${status}`);
    }
    let timezone: string | undefined;
    if (args.timezone !== undefined) {
      timezone = args.timezone.trim();
      if (timezone.length === 0) throw new ConvexError("Timezone cannot be empty");
      if (timezone !== production.timezone)
        changes.push(`timezone → ${timezone}`);
      else timezone = undefined;
    }

    if (changes.length === 0) return; // nothing to do

    await ctx.db.patch(args.productionId, {
      ...(name !== undefined ? { name } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
    });

    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: userId,
      type: "production.updated",
      targetType: "production",
      targetId: args.productionId,
      summary: `${await actorName(ctx, userId)} updated ${production.name}: ${changes.join(", ")}`,
    });
  },
});

export const listStages = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    const instances = await ctx.db
      .query("stageInstances")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
    instances.sort(
      (a, b) => STAGE_BY_KEY[a.stage].order - STAGE_BY_KEY[b.stage].order,
    );
    return await Promise.all(
      instances.map(async (instance) => {
        const meta = STAGE_BY_KEY[instance.stage];
        const approvers = await Promise.all(
          instance.gateApproverIds.map((id) => userRef(ctx, id)),
        );
        return { ...instance, label: meta.label, short: meta.short, approvers };
      }),
    );
  },
});

export const setStageStatus = mutation({
  args: {
    stageInstanceId: v.id("stageInstances"),
    status: stageInstanceStatus,
  },
  handler: async (ctx, args) => {
    const stageInstance = await ctx.db.get(args.stageInstanceId);
    if (!stageInstance) throw new ConvexError("Stage not found");
    const { userId, member } = await assertMemberForProduction(
      ctx,
      stageInstance.productionId,
    );
    const allowed =
      canDecideGate(member, stageInstance, userId) ||
      roleHas(member.role, "production.manage");
    if (!allowed)
      throw new PermissionError("You can't change this stage's status");

    if (stageInstance.status === args.status) return; // no-op

    await ctx.db.patch(args.stageInstanceId, { status: args.status });

    const meta = STAGE_BY_KEY[stageInstance.stage];
    await logActivity(ctx, {
      productionId: stageInstance.productionId,
      actorId: userId,
      type: "stage.status_changed",
      targetType: "stageInstance",
      targetId: args.stageInstanceId,
      summary: `${await actorName(ctx, userId)} set ${meta.label} to ${STAGE_STATUS_LABEL[args.status]}`,
      data: { from: stageInstance.status, to: args.status },
    });
  },
});

export const setGateApprovers = mutation({
  args: {
    stageInstanceId: v.id("stageInstances"),
    approverIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const stageInstance = await ctx.db.get(args.stageInstanceId);
    if (!stageInstance) throw new ConvexError("Stage not found");
    const { production } = await assertCanForProduction(
      ctx,
      stageInstance.productionId,
      "production.manage",
    );

    const approverIds = [...new Set(args.approverIds)];
    for (const approverId of approverIds) {
      const membership = await getMembership(
        ctx,
        production.studioId,
        approverId,
      );
      if (!membership)
        throw new ConvexError("All gate approvers must be studio members");
    }

    await ctx.db.patch(args.stageInstanceId, { gateApproverIds: approverIds });
    // No activity row — config, not state (documented exception, CONTRACTS.md).
  },
});
