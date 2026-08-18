import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
  canDecideForShot,
  PermissionError,
  roleHas,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notifyMany } from "./lib/notify";
import { SHOT_STATUS_BY_KEY } from "./lib/domain";

/**
 * Versions — the Options → Pick loop (spec §5). A version is one option for a
 * shot; exactly one version per shot can ever be "picked".
 */

// ---------------------------------------------------------------------------
// Validators shared by the public and internal entry points.
// ---------------------------------------------------------------------------

const promptMetaValidator = v.object({
  tool: v.optional(v.string()),
  model: v.optional(v.string()),
  prompt: v.optional(v.string()),
  seed: v.optional(v.string()),
  params: v.optional(v.string()),
});

const assetInputValidator = v.object({
  provider: v.union(
    v.literal("storage"),
    v.literal("gdrive"),
    v.literal("url"),
  ),
  storageId: v.optional(v.id("_storage")),
  driveFileId: v.optional(v.string()),
  driveParentId: v.optional(v.string()),
  name: v.string(),
  mimeType: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  md5: v.optional(v.string()),
  webViewLink: v.optional(v.string()),
  url: v.optional(v.string()),
  thumbStorageId: v.optional(v.id("_storage")),
  ownerConnectionId: v.optional(v.id("googleConnections")),
});

type PromptMeta = Infer<typeof promptMetaValidator>;
type AssetInput = Infer<typeof assetInputValidator>;

// ---------------------------------------------------------------------------
// Enrichment helpers (shared with assets.ts — assets imports from here so the
// dependency stays one-directional).
// ---------------------------------------------------------------------------

export type UserRef = { _id: Id<"users">; name: string; image?: string };

async function userRef(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<UserRef> {
  const user = await ctx.db.get(userId);
  return {
    _id: userId,
    name: user?.name ?? user?.email ?? "Unknown",
    image: user?.image,
  };
}

export type EnrichedAsset = Doc<"assets"> & {
  thumbUrl: string | null;
  fileUrl: string | null;
};

/**
 * thumbUrl from the cached thumbnail; fileUrl is the thing to open: Convex
 * storage URL for provider "storage", the Drive webViewLink for "gdrive",
 * the raw url for "url". The `missing` flag passes through with ...asset.
 */
export async function enrichAsset(
  ctx: QueryCtx,
  asset: Doc<"assets">,
): Promise<EnrichedAsset> {
  const thumbUrl =
    asset.thumbStorageId !== undefined
      ? await ctx.storage.getUrl(asset.thumbStorageId)
      : null;
  let fileUrl: string | null = null;
  if (asset.provider === "storage" && asset.storageId !== undefined) {
    fileUrl = await ctx.storage.getUrl(asset.storageId);
  } else if (asset.provider === "gdrive") {
    fileUrl = asset.webViewLink ?? null;
  } else if (asset.provider === "url") {
    fileUrl = asset.url ?? null;
  }
  return { ...asset, thumbUrl, fileUrl };
}

export type VersionCard = Doc<"versions"> & {
  asset: EnrichedAsset | null;
  createdByUser: UserRef;
  decidedByUser: UserRef | null;
};

// ---------------------------------------------------------------------------
// The single create path. Uploads (addFromUpload), Drive registrations
// (createWithAsset) and library attaches (assets.attachToShot) all run
// through here — index computation and the options_ready auto-move exist
// exactly once.
// ---------------------------------------------------------------------------

export async function createVersionWithAssetHelper(
  ctx: MutationCtx,
  args: {
    shotId: Id<"shots">;
    createdBy: Id<"users">;
    /** Either a spec for a new asset row, or an existing unattached asset. */
    asset: AssetInput | { existingAssetId: Id<"assets"> };
    promptMeta?: PromptMeta;
    note?: string;
  },
): Promise<{ versionId: Id<"versions">; index: number }> {
  const shot = await ctx.db.get(args.shotId);
  if (!shot) throw new ConvexError("Shot not found");

  const siblings = await ctx.db
    .query("versions")
    .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
    .collect();
  const index = siblings.reduce((max, s) => Math.max(max, s.index), 0) + 1;

  let assetId: Id<"assets">;
  let assetName: string;
  if ("existingAssetId" in args.asset) {
    const existing = await ctx.db.get(args.asset.existingAssetId);
    if (!existing) throw new ConvexError("Asset not found");
    if (existing.productionId !== shot.productionId)
      throw new ConvexError("Asset and shot belong to different productions");
    if (existing.versionId !== undefined)
      throw new ConvexError("This asset already backs a version");
    assetId = existing._id;
    assetName = existing.name;
  } else {
    assetId = await ctx.db.insert("assets", {
      productionId: shot.productionId,
      shotId: shot._id,
      provider: args.asset.provider,
      kind: args.asset.provider === "url" ? "link" : "file",
      driveFileId: args.asset.driveFileId,
      driveParentId: args.asset.driveParentId,
      ownerConnectionId: args.asset.ownerConnectionId,
      name: args.asset.name,
      mimeType: args.asset.mimeType,
      sizeBytes: args.asset.sizeBytes,
      md5: args.asset.md5,
      webViewLink: args.asset.webViewLink,
      url: args.asset.url,
      storageId: args.asset.storageId,
      thumbStorageId: args.asset.thumbStorageId,
      thumbForMd5:
        args.asset.thumbStorageId !== undefined ? args.asset.md5 : undefined,
      uploadedBy: args.createdBy,
    });
    assetName = args.asset.name;
  }

  const versionId = await ctx.db.insert("versions", {
    shotId: shot._id,
    productionId: shot.productionId,
    index,
    status: "candidate",
    primaryAssetId: assetId,
    createdBy: args.createdBy,
    promptMeta: args.promptMeta,
    note: args.note,
  });

  // Back-patch the asset with its version (and shot, for library assets).
  await ctx.db.patch(assetId, { shotId: shot._id, versionId });

  // Denormalised option count (schema.shots.versionsCount): shots.list must
  // never read a shot's versions to count them. `siblings` is the
  // authoritative count at this point, so writing siblings.length + 1 rather
  // than incrementing also backfills shots created before the field existed.
  await ctx.db.patch(shot._id, { versionsCount: siblings.length + 1 });

  if (shot.coverAssetId === undefined) {
    await ctx.db.patch(shot._id, { coverAssetId: assetId });
  }

  const name = await actorName(ctx, args.createdBy);

  // First options arriving move the shot forward automatically (spec §5).
  if (shot.status === "planned" || shot.status === "generating") {
    await ctx.db.patch(shot._id, { status: "options_ready" });
    await logActivity(ctx, {
      productionId: shot.productionId,
      actorId: args.createdBy,
      type: "shot.status_changed",
      targetType: "shot",
      targetId: shot._id,
      summary: `${name} moved ${shot.code} to ${SHOT_STATUS_BY_KEY.options_ready.label}`,
      data: { from: shot.status, to: "options_ready" },
    });
  }

  await logActivity(ctx, {
    productionId: shot.productionId,
    actorId: args.createdBy,
    type: "version.added",
    targetType: "version",
    targetId: versionId,
    summary: `${name} added v${index} to ${shot.code} (${assetName})`,
  });

  return { versionId, index };
}

/** Internal entry point used by uploads and Drive (contract shape). */
export const createWithAsset = internalMutation({
  args: {
    shotId: v.id("shots"),
    createdBy: v.id("users"),
    asset: assetInputValidator,
    promptMeta: v.optional(promptMetaValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await createVersionWithAssetHelper(ctx, args);
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listForShot = query({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args): Promise<VersionCard[]> => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    await assertMemberForProduction(ctx, shot.productionId);
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_shot", (q) => q.eq("shotId", args.shotId))
      .collect();
    versions.sort((a, b) => a.index - b.index);
    return await Promise.all(
      versions.map(async (version) => {
        const assetDoc =
          version.primaryAssetId !== undefined
            ? await ctx.db.get(version.primaryAssetId)
            : null;
        return {
          ...version,
          asset: assetDoc ? await enrichAsset(ctx, assetDoc) : null,
          createdByUser: await userRef(ctx, version.createdBy),
          decidedByUser:
            version.decidedBy !== undefined
              ? await userRef(ctx, version.decidedBy)
              : null,
        };
      }),
    );
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const generateUploadUrl = mutation({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args): Promise<string> => {
    await assertCanForProduction(ctx, args.productionId, "version.create");
    return await ctx.storage.generateUploadUrl();
  },
});

export const addFromUpload = mutation({
  args: {
    shotId: v.id("shots"),
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    // A separately uploaded, downscaled thumbnail. When absent an image is
    // still its own thumbnail, so old clients keep working unchanged.
    thumbStorageId: v.optional(v.id("_storage")),
    promptMeta: v.optional(promptMetaValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const shot = await ctx.db.get(args.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { userId, production } = await assertCanForProduction(
      ctx,
      shot.productionId,
      "version.create",
    );
    const isImage = args.mimeType?.startsWith("image/") ?? false;
    const result = await createVersionWithAssetHelper(ctx, {
      shotId: args.shotId,
      createdBy: userId,
      asset: {
        provider: "storage",
        storageId: args.storageId,
        name: args.name,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        // A client-side downscale wins; otherwise images are their own
        // thumbnail until Drive supplies a better one.
        thumbStorageId:
          args.thumbStorageId ?? (isImage ? args.storageId : undefined),
      },
      promptMeta: args.promptMeta,
      note: args.note,
    });
    if (production.hub !== undefined) {
      try {
        await ctx.scheduler.runAfter(0, internal.drive.mirrorUploadToHub, {
          versionId: result.versionId,
        });
      } catch (error) {
        // Mirroring is best-effort — never fail the upload over it.
        console.error("Could not schedule drive.mirrorUploadToHub", error);
      }
    }
    return result;
  },
});

/** Resolve version + shot and assert the caller may decide on this shot. */
async function requireDecision(
  ctx: MutationCtx,
  versionId: Id<"versions">,
): Promise<{
  version: Doc<"versions">;
  shot: Doc<"shots">;
  production: Doc<"productions">;
  userId: Id<"users">;
  member: Doc<"memberships">;
}> {
  const version = await ctx.db.get(versionId);
  if (!version) throw new ConvexError("Version not found");
  const shot = await ctx.db.get(version.shotId);
  if (!shot) throw new ConvexError("Shot not found");
  const { userId, member, production } = await assertMemberForProduction(
    ctx,
    version.productionId,
  );
  if (!(await canDecideForShot(ctx, member, shot, userId))) {
    throw new PermissionError(
      "You can't decide on versions for this shot",
    );
  }
  return { version, shot, production, userId, member };
}

export const shortlist = mutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, args) => {
    const { version, shot, userId } = await requireDecision(
      ctx,
      args.versionId,
    );
    if (version.status !== "candidate" && version.status !== "shortlisted") {
      throw new ConvexError(`Can't shortlist a ${version.status} version`);
    }
    const next =
      version.status === "candidate" ? "shortlisted" : "candidate";
    await ctx.db.patch(version._id, { status: next });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: version.productionId,
      actorId: userId,
      type: "version.shortlisted",
      targetType: "version",
      targetId: version._id,
      summary:
        next === "shortlisted"
          ? `${name} shortlisted v${version.index} for ${shot.code}`
          : `${name} removed v${version.index} of ${shot.code} from the shortlist`,
    });
    return next;
  },
});

export const reject = mutation({
  args: { versionId: v.id("versions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { version, shot, userId } = await requireDecision(
      ctx,
      args.versionId,
    );
    if (version.status === "picked") {
      throw new ConvexError(
        "This version is picked — pick a different version to supersede it",
      );
    }
    if (version.status === "rejected") {
      throw new ConvexError("This version is already rejected");
    }
    await ctx.db.patch(version._id, {
      status: "rejected",
      decidedBy: userId,
      decidedAt: Date.now(),
      decisionNote: args.note,
    });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: version.productionId,
      actorId: userId,
      type: "version.rejected",
      targetType: "version",
      targetId: version._id,
      summary: `${name} rejected v${version.index} for ${shot.code}${
        args.note !== undefined && args.note !== "" ? ` — '${args.note}'` : ""
      }`,
    });
    return null;
  },
});

export const unreject = mutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, args) => {
    const { version, shot, userId } = await requireDecision(
      ctx,
      args.versionId,
    );
    if (version.status !== "rejected") {
      throw new ConvexError("Only rejected versions can be restored");
    }
    // A rejection caused by a standing pick can't be quietly undone.
    if (
      shot.pickedVersionId !== undefined &&
      version.decisionNote !== undefined &&
      version.decisionNote.startsWith("superseded by")
    ) {
      throw new ConvexError(
        "This version was superseded by the current pick",
      );
    }
    await ctx.db.patch(version._id, {
      status: "candidate",
      decidedBy: undefined,
      decidedAt: undefined,
      decisionNote: undefined,
    });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: version.productionId,
      actorId: userId,
      type: "version.unrejected",
      targetType: "version",
      targetId: version._id,
      summary: `${name} restored v${version.index} of ${shot.code} to candidates`,
    });
    return null;
  },
});

/**
 * THE decision. Invariants (spec §6): exactly one picked version per shot;
 * every other in-play sibling is rejected as superseded; the shot records the
 * pick and moves to "picked"; the decision lands in the approvals ledger.
 */
export const pick = mutation({
  args: { versionId: v.id("versions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { version, shot, production, userId } = await requireDecision(
      ctx,
      args.versionId,
    );
    if (version.status === "picked") {
      throw new ConvexError(`v${version.index} is already picked`);
    }
    // Picks only happen while the shot is still in play — locked statuses
    // (approved and beyond, or killed) must be reopened first.
    if (
      shot.status === "approved" ||
      shot.status === "final" ||
      shot.status === "delivered" ||
      shot.status === "killed"
    ) {
      throw new ConvexError(
        `This shot is already ${shot.status} — reopen it (set an earlier status) before re-picking`,
      );
    }
    const now = Date.now();

    // Exactly one picked per shot: reject every other sibling still in play
    // (candidate, shortlisted — or a previous pick being replaced).
    const siblings = await ctx.db
      .query("versions")
      .withIndex("by_shot", (q) => q.eq("shotId", shot._id))
      .collect();
    const superseded: Doc<"versions">[] = [];
    for (const sibling of siblings) {
      if (sibling._id === version._id) continue;
      if (sibling.status === "rejected") continue;
      await ctx.db.patch(sibling._id, {
        status: "rejected",
        decidedBy: userId,
        decidedAt: now,
        decisionNote: `superseded by v${version.index}`,
      });
      superseded.push(sibling);
    }

    await ctx.db.patch(version._id, {
      status: "picked",
      decidedBy: userId,
      decidedAt: now,
      decisionNote: args.note,
    });
    await ctx.db.patch(shot._id, {
      pickedVersionId: version._id,
      status: "picked",
    });

    // The pick is itself an approval (spec §6) — recorded, self-approved.
    await ctx.db.insert("approvals", {
      productionId: version.productionId,
      scope: "version",
      targetId: version._id,
      requestedBy: userId,
      approverId: userId,
      status: "approved",
      decidedAt: now,
      note: args.note,
    });

    const name = await actorName(ctx, userId);

    // Superseding used to be silent, so the daily report's "Rejections" read 0
    // on days when dozens of options were superseded — reports.ts counts
    // activity rows of type "version.rejected", so one row per superseded
    // sibling is the only shape that keeps that number honest; an aggregate
    // row would count as a single rejection. It is bounded by the shot's
    // option count, matches what a manual reject() writes, and carries
    // data.supersededBy so a feed can collapse the burst if it ever needs to.
    for (const sibling of superseded) {
      await logActivity(ctx, {
        productionId: version.productionId,
        actorId: userId,
        type: "version.rejected",
        targetType: "version",
        targetId: sibling._id,
        summary: `${name} rejected v${sibling.index} for ${shot.code} — superseded by v${version.index}`,
        data: { supersededBy: version.index },
      });
    }

    await logActivity(ctx, {
      productionId: version.productionId,
      actorId: userId,
      type: "version.picked",
      targetType: "version",
      targetId: version._id,
      summary: `${name} picked v${version.index} for ${shot.code}${
        args.note !== undefined && args.note !== "" ? ` — '${args.note}'` : ""
      }`,
    });

    const recipients: Id<"users">[] = [version.createdBy];
    if (shot.assigneeId !== undefined) recipients.push(shot.assigneeId);
    await notifyMany(ctx, recipients, {
      actorId: userId,
      productionId: version.productionId,
      type: "version_picked",
      title: `${name} picked v${version.index} for ${shot.code}`,
      body: args.note,
      href: `/p/${version.productionId}/shots/${shot._id}`,
    });

    if (production.hub !== undefined) {
      try {
        await ctx.scheduler.runAfter(0, internal.drive.copyPickToApproved, {
          versionId: version._id,
        });
      } catch (error) {
        // Filing into Approved/ is best-effort — the pick itself must stand.
        console.error("Could not schedule drive.copyPickToApproved", error);
      }
    }
    return null;
  },
});

export const updateMeta = mutation({
  args: {
    versionId: v.id("versions"),
    promptMeta: v.optional(promptMetaValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) throw new ConvexError("Version not found");
    const shot = await ctx.db.get(version.shotId);
    if (!shot) throw new ConvexError("Shot not found");
    const { userId, member } = await assertMemberForProduction(
      ctx,
      version.productionId,
    );
    if (
      userId !== version.createdBy &&
      !roleHas(member.role, "content.edit")
    ) {
      throw new PermissionError(
        "Only the creator or a content editor can edit version details",
      );
    }
    if (args.promptMeta === undefined && args.note === undefined) return null;
    await ctx.db.patch(version._id, {
      ...(args.promptMeta !== undefined
        ? { promptMeta: args.promptMeta }
        : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
    });
    const name = await actorName(ctx, userId);
    await logActivity(ctx, {
      productionId: version.productionId,
      actorId: userId,
      type: "version.updated",
      targetType: "version",
      targetId: version._id,
      summary: `${name} updated details on v${version.index} of ${shot.code}`,
    });
    return null;
  },
});
