import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
  requireUserId,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import {
  canonicalApprovedName,
  extensionFor,
  HUB_FOLDERS,
} from "./lib/domain";
import {
  aboutUser,
  CONFIG_ERROR,
  CONSENT_URL,
  copyFile,
  createFolder,
  DRIVE_SCOPE,
  DriveAuthError,
  exchangeCode,
  FOLDER_MIME,
  getFileBytes,
  getFreshToken,
  googleEnv,
  listFiles,
  multipartUpload,
  permissionCreate,
  qEscape,
  redirectUri,
} from "./lib/google";
import type { DriveFile } from "./lib/google";

/**
 * Google Drive integration (spec §7): connect flow, hub scaffold, uploads,
 * picker attach, pick filing and metadata sync. Actions have no ctx.db, so all
 * reads/writes go through the internal queries/mutations defined below.
 * Degrades gracefully: without env vars beginConnect throws a clear config
 * error, and the internal hooks return quietly when no hub is connected.
 */

type HubInfo = NonNullable<Doc<"productions">["hub"]>;

const promptMetaValidator = v.object({
  tool: v.optional(v.string()),
  model: v.optional(v.string()),
  prompt: v.optional(v.string()),
  seed: v.optional(v.string()),
  params: v.optional(v.string()),
});

type PromptMeta = {
  tool?: string;
  model?: string;
  prompt?: string;
  seed?: string;
  params?: string;
};

type CreateWithAssetArgs = {
  shotId: Id<"shots">;
  createdBy: Id<"users">;
  asset: {
    provider: "storage" | "gdrive" | "url";
    storageId?: Id<"_storage">;
    driveFileId?: string;
    driveParentId?: string;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    md5?: string;
    webViewLink?: string;
    url?: string;
    thumbStorageId?: Id<"_storage">;
    ownerConnectionId?: Id<"googleConnections">;
  };
  promptMeta?: PromptMeta;
  note?: string;
};

/**
 * versions.createWithAsset lands in a sibling slice; reference it by name so
 * this module typechecks before codegen picks that module up. Runtime-wise
 * this is identical to internal.versions.createWithAsset.
 */
const createWithAssetRef = makeFunctionReference<
  "mutation",
  CreateWithAssetArgs,
  { versionId: Id<"versions">; index: number }
>("versions:createWithAsset");

/** Normalize DriveAuthError into the exact message the UI shows. */
async function freshTokenOrClean(
  ctx: ActionCtx,
  connectionId: Id<"googleConnections">,
): Promise<string> {
  try {
    return await getFreshToken(ctx, connectionId);
  } catch (e) {
    if (e instanceof DriveAuthError) {
      throw new ConvexError("Drive connection expired — reconnect");
    }
    throw e;
  }
}

function randomStateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ===========================================================================
// Public surface
// ===========================================================================

export const connectionStatus = query({
  args: { productionId: v.optional(v.id("productions")) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    myConnection: { email: string; revoked: boolean } | null;
    hub: {
      connected: boolean;
      rootFolderId?: string;
      ownerEmail?: string;
      revoked?: boolean;
    };
  }> => {
    const userId = await requireUserId(ctx);
    let hub: {
      connected: boolean;
      rootFolderId?: string;
      ownerEmail?: string;
      revoked?: boolean;
    } = { connected: false };
    if (args.productionId !== undefined) {
      const { production } = await assertMemberForProduction(
        ctx,
        args.productionId,
      );
      if (production.hub) {
        const conn = await ctx.db.get(production.hub.connectionId);
        hub = {
          connected: true,
          rootFolderId: production.hub.rootFolderId,
          ...(conn !== null ? { ownerEmail: conn.email } : {}),
          revoked: conn?.revoked === true,
        };
      }
    }
    const mine = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      myConnection:
        mine === null
          ? null
          : { email: mine.email, revoked: mine.revoked === true },
      hub,
    };
  },
});

export const beginConnect = mutation({
  args: { returnTo: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await requireUserId(ctx);
    const env = googleEnv();
    if (!env) throw new ConvexError(CONFIG_ERROR);
    if (!args.returnTo.startsWith("/")) {
      throw new Error("returnTo must be an app path like /p/…/settings");
    }
    const stateToken = randomStateToken();
    await ctx.db.insert("driveConnectStates", {
      stateToken,
      userId,
      returnTo: args.returnTo,
    });
    const params = new URLSearchParams({
      client_id: env.clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: stateToken,
    });
    // No activity row: connecting an account is user-scoped config with no
    // production context (documented deviation).
    return { url: `${CONSENT_URL}?${params.toString()}` };
  },
});

/** OAuth callback body — called by drive_http.ts with {code, state}. */
export const completeConnection = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ returnTo: string }> => {
    const state = await ctx.runQuery(internal.drive.connectStateByToken, {
      stateToken: args.state,
    });
    if (!state) throw new Error("Drive connect state not found or expired");
    const tokens = await exchangeCode(args.code);
    const about = await aboutUser(tokens.accessToken);
    await ctx.runMutation(internal.drive.saveConnection, {
      stateId: state.stateId,
      userId: state.userId,
      googleUserId: about.permissionId,
      email: about.emailAddress,
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken !== undefined
        ? { refreshToken: tokens.refreshToken }
        : {}),
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    });
    return { returnTo: state.returnTo };
  },
});

export const scaffoldHub = action({
  args: {
    productionId: v.id("productions"),
    parentFolderId: v.optional(v.string()),
    sharedDriveId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ rootFolderId: string }> => {
    const info = await ctx.runQuery(internal.drive.scaffoldContext, {
      productionId: args.productionId,
    });
    if (info.hubExists) {
      throw new ConvexError("This production already has a Drive hub");
    }
    if (info.connectionId === null) {
      throw new ConvexError("Connect your Google Drive first (Settings → Drive)");
    }
    const token = await freshTokenOrClean(ctx, info.connectionId);

    const rootName = `${info.code} — ${info.name}`;
    const rootParent = args.parentFolderId ?? args.sharedDriveId;
    const root = await createFolder(token, rootName, rootParent);

    // Build the HUB_FOLDERS tree; parents always precede children in the list.
    const idByPath = new Map<string, string>();
    const folderIds: Record<string, string> = {};
    for (const entry of HUB_FOLDERS) {
      const leafName = entry.path[entry.path.length - 1];
      if (leafName === undefined) continue;
      const parentPath = entry.path.slice(0, -1).join("/");
      const parentId =
        parentPath === "" ? root.id : (idByPath.get(parentPath) ?? root.id);
      const folder = await createFolder(token, leafName, parentId);
      idByPath.set(entry.path.join("/"), folder.id);
      folderIds[entry.key] = folder.id;
    }

    await ctx.runMutation(internal.drive.setHub, {
      productionId: args.productionId,
      actorId: info.userId,
      rootName,
      hub: {
        connectionId: info.connectionId,
        rootFolderId: root.id,
        folderIds,
        driveKind: args.sharedDriveId !== undefined ? "sharedDrive" : "myDrive",
        ...(args.sharedDriveId !== undefined
          ? { sharedDriveId: args.sharedDriveId }
          : {}),
      },
    });

    // Share the root with every member that has an email — best-effort each.
    for (const member of info.members) {
      if (member.email === info.connectionEmail) continue;
      try {
        await permissionCreate(token, root.id, {
          role: member.role === "viewer" ? "commenter" : "writer",
          emailAddress: member.email,
        });
      } catch (e) {
        console.log(
          `scaffoldHub: could not share hub with ${member.email}: ${String(e)}`,
        );
      }
    }
    return { rootFolderId: root.id };
  },
});

/** Short-lived token pass for the Google Picker — MY connection only. */
export const getPickerConfig = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ accessToken: string; apiKey: string; appId: string }> => {
    const mine = await ctx.runQuery(internal.drive.myConnection, {});
    if (!mine) {
      throw new ConvexError("Connect your Google Drive first (Settings → Drive)");
    }
    const accessToken = await freshTokenOrClean(ctx, mine.connectionId);
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID ?? "";
    return {
      accessToken,
      apiKey: process.env.GOOGLE_PICKER_API_KEY ?? "",
      // The Picker appId is the GCP project number — the client_id prefix.
      appId: clientId.split("-")[0] ?? "",
    };
  },
});

export const uploadToShot = action({
  args: {
    shotId: v.id("shots"),
    bytes: v.bytes(),
    name: v.string(),
    mimeType: v.string(),
    promptMeta: v.optional(promptMetaValidator),
    note: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ versionId: Id<"versions">; index: number }> => {
    const info = await ctx.runQuery(internal.drive.uploadContext, {
      shotId: args.shotId,
    });
    if (!info.hub) {
      throw new ConvexError("No Drive hub connected — connect one in settings");
    }
    const token = await freshTokenOrClean(ctx, info.hub.connectionId);
    const { optionsId } = await ensureShotFolders(ctx, token, info.hub, info.shot);
    const file = await multipartUpload(token, {
      name: args.name,
      mimeType: args.mimeType,
      parents: [optionsId],
      bytes: args.bytes,
    });
    let thumbStorageId: Id<"_storage"> | undefined;
    if (args.mimeType.startsWith("image/")) {
      thumbStorageId = await ctx.storage.store(
        new Blob([args.bytes], { type: args.mimeType }),
      );
    }
    return await ctx.runMutation(createWithAssetRef, {
      shotId: args.shotId,
      createdBy: info.userId,
      asset: {
        provider: "gdrive",
        driveFileId: file.id,
        driveParentId: optionsId,
        name: file.name ?? args.name,
        mimeType: args.mimeType,
        sizeBytes:
          file.size !== undefined ? Number(file.size) : args.bytes.byteLength,
        ...(file.md5Checksum !== undefined ? { md5: file.md5Checksum } : {}),
        ...(file.webViewLink !== undefined
          ? { webViewLink: file.webViewLink }
          : {}),
        ...(thumbStorageId !== undefined ? { thumbStorageId } : {}),
        ownerConnectionId: info.hub.connectionId,
      },
      ...(args.promptMeta !== undefined ? { promptMeta: args.promptMeta } : {}),
      ...(args.note !== undefined ? { note: args.note } : {}),
    });
  },
});

export const attachFromPicker = action({
  args: {
    shotId: v.id("shots"),
    files: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        mimeType: v.optional(v.string()),
      }),
    ),
    asVersions: v.boolean(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ attached: number; skipped: string[] }> => {
    const info = await ctx.runQuery(internal.drive.uploadContext, {
      shotId: args.shotId,
    });
    if (!info.hub) {
      throw new ConvexError("No Drive hub connected — connect one in settings");
    }
    if (info.myConnectionId === null) {
      throw new ConvexError("Connect your Google Drive first (Settings → Drive)");
    }
    const myToken = await freshTokenOrClean(ctx, info.myConnectionId);
    const hubToken =
      info.myConnectionId === info.hub.connectionId
        ? myToken
        : await freshTokenOrClean(ctx, info.hub.connectionId);
    const { optionsId } = await ensureShotFolders(
      ctx,
      hubToken,
      info.hub,
      info.shot,
    );

    let attached = 0;
    const skipped: string[] = [];
    for (const picked of args.files) {
      try {
        const bytes = await getFileBytes(myToken, picked.id);
        const mimeType = picked.mimeType ?? "application/octet-stream";
        const file = await multipartUpload(hubToken, {
          name: picked.name,
          mimeType,
          parents: [optionsId],
          bytes,
        });
        let thumbStorageId: Id<"_storage"> | undefined;
        if (mimeType.startsWith("image/")) {
          thumbStorageId = await ctx.storage.store(
            new Blob([bytes], { type: mimeType }),
          );
        }
        if (args.asVersions) {
          await ctx.runMutation(createWithAssetRef, {
            shotId: args.shotId,
            createdBy: info.userId,
            asset: {
              provider: "gdrive",
              driveFileId: file.id,
              driveParentId: optionsId,
              name: picked.name,
              mimeType,
              sizeBytes:
                file.size !== undefined ? Number(file.size) : bytes.byteLength,
              ...(file.md5Checksum !== undefined
                ? { md5: file.md5Checksum }
                : {}),
              ...(file.webViewLink !== undefined
                ? { webViewLink: file.webViewLink }
                : {}),
              ...(thumbStorageId !== undefined ? { thumbStorageId } : {}),
              ownerConnectionId: info.hub.connectionId,
            },
          });
        } else {
          await ctx.runMutation(internal.drive.insertPickerAsset, {
            productionId: info.productionId,
            shotId: args.shotId,
            shotCode: info.shot.code,
            uploadedBy: info.userId,
            driveFileId: file.id,
            driveParentId: optionsId,
            name: picked.name,
            mimeType,
            sizeBytes:
              file.size !== undefined ? Number(file.size) : bytes.byteLength,
            ...(file.md5Checksum !== undefined
              ? { md5: file.md5Checksum }
              : {}),
            ...(file.webViewLink !== undefined
              ? { webViewLink: file.webViewLink }
              : {}),
            ...(thumbStorageId !== undefined ? { thumbStorageId } : {}),
            ownerConnectionId: info.hub.connectionId,
          });
        }
        attached++;
      } catch (e) {
        if (e instanceof DriveAuthError) {
          throw new ConvexError("Drive connection expired — reconnect");
        }
        console.log(
          `attachFromPicker: skipped ${picked.name}: ${String(e)}`,
        );
        skipped.push(picked.name);
      }
    }
    return { attached, skipped };
  },
});

/** Mirrors a Convex-storage upload into Options/ once a hub is connected. */
export const mirrorUploadToHub = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, args): Promise<null> => {
    const info = await ctx.runQuery(internal.drive.versionContext, {
      versionId: args.versionId,
    });
    if (!info || !info.hub || !info.asset) return null;
    if (info.asset.provider !== "storage" || info.asset.storageId === undefined)
      return null;
    const blob = await ctx.storage.get(info.asset.storageId);
    if (blob === null) return null;

    let token: string;
    try {
      token = await getFreshToken(ctx, info.hub.connectionId);
    } catch (e) {
      if (e instanceof DriveAuthError) {
        console.log("mirrorUploadToHub: hub connection revoked — skipping");
        return null;
      }
      throw e;
    }
    const { optionsId } = await ensureShotFolders(ctx, token, info.hub, info.shot);
    const mimeType = info.asset.mimeType ?? blob.type ?? "application/octet-stream";
    const file = await multipartUpload(token, {
      name: info.asset.name,
      mimeType,
      parents: [optionsId],
      bytes: await blob.arrayBuffer(),
    });
    await ctx.runMutation(internal.drive.flipAssetToGdrive, {
      assetId: info.asset._id,
      driveFileId: file.id,
      driveParentId: optionsId,
      ...(file.md5Checksum !== undefined ? { md5: file.md5Checksum } : {}),
      ...(file.size !== undefined ? { sizeBytes: Number(file.size) } : {}),
      ...(file.webViewLink !== undefined
        ? { webViewLink: file.webViewLink }
        : {}),
      ownerConnectionId: info.hub.connectionId,
      useStorageAsThumb: mimeType.startsWith("image/"),
    });
    return null;
  },
});

/** Files the picked version into Approved/ under its canonical name. */
export const copyPickToApproved = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, args): Promise<null> => {
    const info = await ctx.runQuery(internal.drive.versionContext, {
      versionId: args.versionId,
    });
    if (!info || !info.hub || !info.asset) return null;

    let token: string;
    try {
      token = await getFreshToken(ctx, info.hub.connectionId);
    } catch (e) {
      if (e instanceof DriveAuthError) {
        console.log("copyPickToApproved: hub connection revoked — skipping");
        return null;
      }
      throw e;
    }
    const { approvedId } = await ensureShotFolders(ctx, token, info.hub, info.shot);
    const name = canonicalApprovedName({
      productionCode: info.productionCode,
      ...(info.episodeNumber !== null
        ? { episodeNumber: info.episodeNumber }
        : {}),
      shotCode: info.shot.code,
      versionIndex: info.version.index,
      extension: extensionFor(info.asset.name, info.asset.mimeType),
    });

    let file: DriveFile | null = null;
    if (info.asset.provider === "gdrive" && info.asset.driveFileId !== undefined) {
      file = await copyFile(token, info.asset.driveFileId, {
        name,
        parents: [approvedId],
      });
    } else if (
      info.asset.provider === "storage" &&
      info.asset.storageId !== undefined
    ) {
      const blob = await ctx.storage.get(info.asset.storageId);
      if (blob === null) return null;
      file = await multipartUpload(token, {
        name,
        mimeType: info.asset.mimeType ?? blob.type ?? "application/octet-stream",
        parents: [approvedId],
        bytes: await blob.arrayBuffer(),
      });
    }
    if (file === null) return null;

    await ctx.runMutation(internal.drive.insertApprovedAsset, {
      productionId: info.productionId,
      shotId: info.shot._id,
      shotCode: info.shot.code,
      versionId: args.versionId,
      actorId: info.version.decidedBy ?? info.version.createdBy,
      driveFileId: file.id,
      driveParentId: approvedId,
      name,
      ...(file.mimeType !== undefined
        ? { mimeType: file.mimeType }
        : info.asset.mimeType !== undefined
          ? { mimeType: info.asset.mimeType }
          : {}),
      ...(file.size !== undefined ? { sizeBytes: Number(file.size) } : {}),
      ...(file.md5Checksum !== undefined ? { md5: file.md5Checksum } : {}),
      ...(file.webViewLink !== undefined
        ? { webViewLink: file.webViewLink }
        : {}),
      ownerConnectionId: info.hub.connectionId,
    });
    return null;
  },
});

export const syncNow = action({
  args: { productionId: v.id("productions") },
  handler: async (
    ctx,
    args,
  ): Promise<{ newFiles: number; updated: number; missing: number }> => {
    const sctx = await ctx.runQuery(internal.drive.syncContextForMember, {
      productionId: args.productionId,
    });
    if (sctx.hub === null || sctx.hubUserId === null) {
      return { newFiles: 0, updated: 0, missing: 0 };
    }
    let counts: SyncCounts;
    try {
      counts = await runSync(ctx, {
        productionId: args.productionId,
        hub: sctx.hub,
        hubUserId: sctx.hubUserId,
        shotFolderIds: sctx.shotFolderIds,
      });
    } catch (e) {
      if (e instanceof DriveAuthError) {
        throw new ConvexError("Drive connection expired — reconnect");
      }
      throw e;
    }
    await ctx.runMutation(internal.drive.logSynced, {
      productionId: args.productionId,
      actorId: sctx.userId,
      newFiles: counts.newFiles,
      updated: counts.updated,
      missing: counts.missing,
      viaCron: false,
    });
    return counts;
  },
});

/** 5-minute metadata sync for every active production with a connected hub. */
export const cronSync = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const productions = await ctx.runQuery(internal.drive.hubProductions, {});
    for (const { productionId } of productions) {
      try {
        const sctx = await ctx.runQuery(internal.drive.syncContext, {
          productionId,
        });
        if (sctx.hub === null || sctx.hubUserId === null) continue;
        const counts = await runSync(ctx, {
          productionId,
          hub: sctx.hub,
          hubUserId: sctx.hubUserId,
          shotFolderIds: sctx.shotFolderIds,
        });
        if (counts.newFiles + counts.updated + counts.missing > 0) {
          await ctx.runMutation(internal.drive.logSynced, {
            productionId,
            actorId: sctx.hubUserId,
            newFiles: counts.newFiles,
            updated: counts.updated,
            missing: counts.missing,
            viaCron: true,
          });
        }
      } catch (e) {
        if (e instanceof DriveAuthError) continue; // revoked hub — stay quiet
        console.log(`drive.cronSync failed for ${productionId}: ${String(e)}`);
      }
    }
    return null;
  },
});

// ===========================================================================
// Shared action-side helpers
// ===========================================================================

/**
 * Lazily ensure "04 Production/Shots/{code}/" with "Options" and "Approved"
 * children, persisting shot.driveFolderId the first time.
 */
async function ensureShotFolders(
  ctx: ActionCtx,
  token: string,
  hub: HubInfo,
  shot: { _id: Id<"shots">; code: string; driveFolderId: string | null },
): Promise<{ shotFolderId: string; optionsId: string; approvedId: string }> {
  const shotsRoot: string | undefined = hub.folderIds["production.shots"];
  if (shotsRoot === undefined) {
    throw new ConvexError("Hub is missing the Shots folder — re-scaffold the hub");
  }
  let shotFolderId = shot.driveFolderId;
  if (shotFolderId === null) {
    const existing = await listFiles(
      token,
      `'${qEscape(shotsRoot)}' in parents and name = '${qEscape(shot.code)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
    const candidateId =
      existing[0]?.id ?? (await createFolder(token, shot.code, shotsRoot)).id;
    // Compare-and-set: a concurrent upload may have won the race — converge
    // on whichever folder id the mutation kept.
    shotFolderId = await ctx.runMutation(internal.drive.setShotDriveFolder, {
      shotId: shot._id,
      driveFolderId: candidateId,
    });
  }
  const children = await listFiles(
    token,
    `'${qEscape(shotFolderId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
  );
  const childId = (name: string): string | undefined =>
    children.find((c) => c.name === name)?.id;
  const optionsId =
    childId("Options") ?? (await createFolder(token, "Options", shotFolderId)).id;
  const approvedId =
    childId("Approved") ??
    (await createFolder(token, "Approved", shotFolderId)).id;
  return { shotFolderId, optionsId, approvedId };
}

type SyncCounts = { newFiles: number; updated: number; missing: number };

/** Shared sync core for syncNow and cronSync. Throws DriveAuthError. */
async function runSync(
  ctx: ActionCtx,
  args: {
    productionId: Id<"productions">;
    hub: HubInfo;
    hubUserId: Id<"users">;
    shotFolderIds: string[];
  },
): Promise<SyncCounts> {
  const token = await getFreshToken(ctx, args.hub.connectionId);
  const counts: SyncCounts = { newFiles: 0, updated: 0, missing: 0 };
  const shotFolderSet = new Set(args.shotFolderIds);
  const visited = new Set<string>();
  const queue: string[] = [
    args.hub.rootFolderId,
    ...Object.values(args.hub.folderIds),
    ...args.shotFolderIds,
  ];
  while (queue.length > 0) {
    const folderId = queue.shift();
    if (folderId === undefined || visited.has(folderId)) continue;
    visited.add(folderId);

    let files: DriveFile[];
    try {
      files = await listFiles(token, `'${qEscape(folderId)}' in parents`);
    } catch (e) {
      console.log(`drive sync: could not list folder ${folderId}: ${String(e)}`);
      continue;
    }
    // Descend one level into shot folders (their Options/ and Approved/).
    if (shotFolderSet.has(folderId)) {
      for (const f of files) {
        if (f.mimeType === FOLDER_MIME && f.trashed !== true) queue.push(f.id);
      }
    }
    const regular = files.filter((f) => f.mimeType !== FOLDER_MIME);
    if (regular.length === 0) continue;

    const result = await ctx.runMutation(internal.drive.upsertSyncedFiles, {
      productionId: args.productionId,
      uploadedBy: args.hubUserId,
      connectionId: args.hub.connectionId,
      parentId: folderId,
      files: regular.map((f) => ({
        id: f.id,
        name: f.name,
        trashed: f.trashed === true,
        ...(f.mimeType !== undefined ? { mimeType: f.mimeType } : {}),
        ...(f.md5Checksum !== undefined ? { md5: f.md5Checksum } : {}),
        ...(f.size !== undefined ? { sizeBytes: Number(f.size) } : {}),
        ...(f.webViewLink !== undefined ? { webViewLink: f.webViewLink } : {}),
      })),
    });
    counts.newFiles += result.newFiles;
    counts.updated += result.updated;
    counts.missing += result.missing;

    // Cache Drive thumbnails; any non-OK response skips quietly.
    const byId = new Map(files.map((f) => [f.id, f] as const));
    for (const thumb of result.thumbsNeeded) {
      const link = byId.get(thumb.driveFileId)?.thumbnailLink;
      if (link === undefined) continue;
      try {
        const res = await fetch(link, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const blob = await res.blob();
        const thumbStorageId = await ctx.storage.store(blob);
        await ctx.runMutation(internal.drive.setAssetThumb, {
          assetId: thumb.assetId,
          thumbStorageId,
          ...(thumb.md5 !== null ? { thumbForMd5: thumb.md5 } : {}),
        });
      } catch {
        // skip quietly — thumbnails are best-effort
      }
    }
  }
  return counts;
}

// ===========================================================================
// Internal queries — action-side reads (never exposed to clients; the token
// fields returned by connectionForToken exist only for lib/google.ts).
// ===========================================================================

export const connectionForToken = internalQuery({
  args: { connectionId: v.id("googleConnections") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number;
    revoked: boolean;
  } | null> => {
    const conn = await ctx.db.get(args.connectionId);
    if (conn === null) return null;
    return {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken ?? null,
      expiresAt: conn.expiresAt,
      revoked: conn.revoked === true,
    };
  },
});

export const connectStateByToken = internalQuery({
  args: { stateToken: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    stateId: Id<"driveConnectStates">;
    userId: Id<"users">;
    returnTo: string;
  } | null> => {
    const state = await ctx.db
      .query("driveConnectStates")
      .withIndex("by_token", (q) => q.eq("stateToken", args.stateToken))
      .unique();
    if (state === null) return null;
    // Stale OAuth states must not be replayable.
    if (Date.now() - state._creationTime > 10 * 60 * 1000) return null;
    return { stateId: state._id, userId: state.userId, returnTo: state.returnTo };
  },
});

export const myConnection = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    connectionId: Id<"googleConnections">;
    email: string;
    revoked: boolean;
  } | null> => {
    const userId = await requireUserId(ctx);
    const conn = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (conn === null) return null;
    return {
      connectionId: conn._id,
      email: conn.email,
      revoked: conn.revoked === true,
    };
  },
});

type ScaffoldContext = {
  userId: Id<"users">;
  connectionId: Id<"googleConnections"> | null;
  connectionEmail: string | null;
  name: string;
  code: string;
  hubExists: boolean;
  members: { email: string; role: string }[];
};

export const scaffoldContext = internalQuery({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args): Promise<ScaffoldContext> => {
    const { userId, production } = await assertCanForProduction(
      ctx,
      args.productionId,
      "production.manage",
    );
    const mine = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_studio", (q) => q.eq("studioId", production.studioId))
      .collect();
    const members: { email: string; role: string }[] = [];
    for (const membership of memberships) {
      const user =
        membership.userId !== undefined
          ? await ctx.db.get(membership.userId)
          : null;
      const email = user?.email ?? membership.invitedEmail ?? null;
      if (email !== null) members.push({ email, role: membership.role });
    }
    return {
      userId,
      connectionId: mine?._id ?? null,
      connectionEmail: mine?.email ?? null,
      name: production.name,
      code: production.code,
      hubExists: production.hub !== undefined,
      members,
    };
  },
});

type UploadContext = {
  userId: Id<"users">;
  productionId: Id<"productions">;
  shot: { _id: Id<"shots">; code: string; driveFolderId: string | null };
  hub: HubInfo | null;
  myConnectionId: Id<"googleConnections"> | null;
};

export const uploadContext = internalQuery({
  args: { shotId: v.id("shots") },
  handler: async (ctx, args): Promise<UploadContext> => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    const { userId, production } = await assertCanForProduction(
      ctx,
      shot.productionId,
      "version.create",
    );
    const mine = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      userId,
      productionId: production._id,
      shot: {
        _id: shot._id,
        code: shot.code,
        driveFolderId: shot.driveFolderId ?? null,
      },
      hub: production.hub ?? null,
      myConnectionId: mine?._id ?? null,
    };
  },
});

type VersionContext = {
  version: {
    _id: Id<"versions">;
    index: number;
    createdBy: Id<"users">;
    decidedBy: Id<"users"> | null;
  };
  shot: { _id: Id<"shots">; code: string; driveFolderId: string | null };
  productionId: Id<"productions">;
  productionCode: string;
  episodeNumber: number | null;
  hub: HubInfo | null;
  asset: Doc<"assets"> | null;
};

export const versionContext = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, args): Promise<VersionContext | null> => {
    const version = await ctx.db.get(args.versionId);
    if (version === null) return null;
    const shot = await ctx.db.get(version.shotId);
    if (shot === null) return null;
    const production = await ctx.db.get(shot.productionId);
    if (production === null) return null;
    const asset =
      version.primaryAssetId !== undefined
        ? await ctx.db.get(version.primaryAssetId)
        : null;
    const episode =
      shot.episodeId !== undefined ? await ctx.db.get(shot.episodeId) : null;
    return {
      version: {
        _id: version._id,
        index: version.index,
        createdBy: version.createdBy,
        decidedBy: version.decidedBy ?? null,
      },
      shot: {
        _id: shot._id,
        code: shot.code,
        driveFolderId: shot.driveFolderId ?? null,
      },
      productionId: production._id,
      productionCode: production.code,
      episodeNumber: episode?.number ?? null,
      hub: production.hub ?? null,
      asset,
    };
  },
});

type SyncContextResult = {
  userId: Id<"users"> | null;
  hub: HubInfo | null;
  hubUserId: Id<"users"> | null;
  shotFolderIds: string[];
};

async function buildSyncContext(
  ctx: QueryCtx,
  production: Doc<"productions">,
): Promise<Omit<SyncContextResult, "userId">> {
  if (!production.hub) return { hub: null, hubUserId: null, shotFolderIds: [] };
  const conn = await ctx.db.get(production.hub.connectionId);
  const shots = await ctx.db
    .query("shots")
    .withIndex("by_production", (q) => q.eq("productionId", production._id))
    .collect();
  return {
    hub: production.hub,
    hubUserId: conn?.userId ?? null,
    shotFolderIds: shots.flatMap((s) =>
      s.driveFolderId !== undefined ? [s.driveFolderId] : [],
    ),
  };
}

/** Sync context with membership assertion — for the user-facing syncNow. */
export const syncContextForMember = internalQuery({
  args: { productionId: v.id("productions") },
  handler: async (
    ctx,
    args,
  ): Promise<SyncContextResult & { userId: Id<"users"> }> => {
    const { userId, production } = await assertMemberForProduction(
      ctx,
      args.productionId,
    );
    return { userId, ...(await buildSyncContext(ctx, production)) };
  },
});

/** Sync context without auth — for cronSync only (internal). */
export const syncContext = internalQuery({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args): Promise<SyncContextResult> => {
    const production = await ctx.db.get(args.productionId);
    if (production === null) {
      return { userId: null, hub: null, hubUserId: null, shotFolderIds: [] };
    }
    return { userId: null, ...(await buildSyncContext(ctx, production)) };
  },
});

export const hubProductions = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ productionId: Id<"productions"> }[]> => {
    const productions = await ctx.db.query("productions").collect();
    return productions
      .filter((p) => p.status === "active" && p.hub !== undefined)
      .map((p) => ({ productionId: p._id }));
  },
});

// ===========================================================================
// Internal mutations — action-side writes. Plumbing mutations (tokens, folder
// ids, per-file sync upserts) log no activity by design: the contract's
// drive.* rows are written once per user-visible event instead.
// ===========================================================================

export const persistToken = internalMutation({
  args: {
    connectionId: v.id("googleConnections"),
    accessToken: v.string(),
    expiresAt: v.number(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.connectionId, {
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
      ...(args.refreshToken !== undefined
        ? { refreshToken: args.refreshToken }
        : {}),
    });
    return null;
  },
});

export const markRevoked = internalMutation({
  args: { connectionId: v.id("googleConnections") },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.connectionId, { revoked: true });
    return null;
  },
});

export const saveConnection = internalMutation({
  args: {
    stateId: v.id("driveConnectStates"),
    userId: v.id("users"),
    googleUserId: v.string(),
    email: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"googleConnections">> => {
    const state = await ctx.db.get(args.stateId);
    if (state !== null) await ctx.db.delete(args.stateId);
    const existing = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        googleUserId: args.googleUserId,
        email: args.email,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken ?? existing.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
        revoked: undefined, // reconnecting clears a revoked flag
      });
      return existing._id;
    }
    return await ctx.db.insert("googleConnections", {
      userId: args.userId,
      googleUserId: args.googleUserId,
      email: args.email,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      expiresAt: args.expiresAt,
      scopes: args.scopes,
    });
  },
});

export const setHub = internalMutation({
  args: {
    productionId: v.id("productions"),
    actorId: v.id("users"),
    rootName: v.string(),
    hub: v.object({
      connectionId: v.id("googleConnections"),
      rootFolderId: v.string(),
      folderIds: v.record(v.string(), v.string()),
      driveKind: v.union(v.literal("myDrive"), v.literal("sharedDrive")),
      sharedDriveId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args): Promise<null> => {
    const production = await ctx.db.get(args.productionId);
    if (production === null) throw new Error("Production not found");
    await ctx.db.patch(args.productionId, { hub: args.hub });
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: args.actorId,
      type: "drive.hub_created",
      targetType: "production",
      targetId: args.productionId,
      summary: `${await actorName(ctx, args.actorId)} created the Drive hub "${args.rootName}" (${Object.keys(args.hub.folderIds).length + 1} folders)`,
    });
    return null;
  },
});

export const setShotDriveFolder = internalMutation({
  args: { shotId: v.id("shots"), driveFolderId: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const shot = await ctx.db.get(args.shotId);
    if (shot === null) throw new Error("Shot not found");
    if (shot.driveFolderId !== undefined) return shot.driveFolderId;
    await ctx.db.patch(args.shotId, { driveFolderId: args.driveFolderId });
    return args.driveFolderId;
  },
});

export const insertPickerAsset = internalMutation({
  args: {
    productionId: v.id("productions"),
    shotId: v.id("shots"),
    shotCode: v.string(),
    uploadedBy: v.id("users"),
    driveFileId: v.string(),
    driveParentId: v.string(),
    name: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    md5: v.optional(v.string()),
    webViewLink: v.optional(v.string()),
    thumbStorageId: v.optional(v.id("_storage")),
    ownerConnectionId: v.id("googleConnections"),
  },
  handler: async (ctx, args): Promise<Id<"assets">> => {
    const assetId = await ctx.db.insert("assets", {
      productionId: args.productionId,
      shotId: args.shotId,
      provider: "gdrive",
      kind: "file",
      driveFileId: args.driveFileId,
      driveParentId: args.driveParentId,
      ownerConnectionId: args.ownerConnectionId,
      name: args.name,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      md5: args.md5,
      webViewLink: args.webViewLink,
      thumbStorageId: args.thumbStorageId,
      thumbForMd5: args.thumbStorageId !== undefined ? args.md5 : undefined,
      syncedAt: Date.now(),
      uploadedBy: args.uploadedBy,
    });
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: args.uploadedBy,
      type: "shot.updated",
      targetType: "shot",
      targetId: args.shotId,
      summary: `${await actorName(ctx, args.uploadedBy)} attached ${args.name} to ${args.shotCode} from Drive`,
    });
    return assetId;
  },
});

export const flipAssetToGdrive = internalMutation({
  args: {
    assetId: v.id("assets"),
    driveFileId: v.string(),
    driveParentId: v.string(),
    md5: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    webViewLink: v.optional(v.string()),
    ownerConnectionId: v.id("googleConnections"),
    useStorageAsThumb: v.boolean(),
  },
  handler: async (ctx, args): Promise<null> => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) return null;
    const thumbStorageId =
      asset.thumbStorageId ??
      (args.useStorageAsThumb ? asset.storageId : undefined);
    await ctx.db.patch(args.assetId, {
      provider: "gdrive",
      driveFileId: args.driveFileId,
      driveParentId: args.driveParentId,
      md5: args.md5,
      ...(args.sizeBytes !== undefined ? { sizeBytes: args.sizeBytes } : {}),
      ...(args.webViewLink !== undefined
        ? { webViewLink: args.webViewLink }
        : {}),
      ownerConnectionId: args.ownerConnectionId,
      // Keep the original Convex-storage bytes as the thumbnail source.
      ...(thumbStorageId !== undefined ? { thumbStorageId } : {}),
      ...(thumbStorageId !== undefined && args.md5 !== undefined
        ? { thumbForMd5: args.md5 }
        : {}),
      syncedAt: Date.now(),
    });
    return null;
  },
});

export const insertApprovedAsset = internalMutation({
  args: {
    productionId: v.id("productions"),
    shotId: v.id("shots"),
    shotCode: v.string(),
    versionId: v.id("versions"),
    actorId: v.id("users"),
    driveFileId: v.string(),
    driveParentId: v.string(),
    name: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    md5: v.optional(v.string()),
    webViewLink: v.optional(v.string()),
    ownerConnectionId: v.id("googleConnections"),
  },
  handler: async (ctx, args): Promise<Id<"assets">> => {
    const assetId = await ctx.db.insert("assets", {
      productionId: args.productionId,
      shotId: args.shotId,
      versionId: args.versionId,
      provider: "gdrive",
      kind: "file",
      driveFileId: args.driveFileId,
      driveParentId: args.driveParentId,
      ownerConnectionId: args.ownerConnectionId,
      name: args.name,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      md5: args.md5,
      webViewLink: args.webViewLink,
      syncedAt: Date.now(),
      uploadedBy: args.actorId,
    });
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: args.actorId,
      type: "drive.approved_filed",
      targetType: "version",
      targetId: args.versionId,
      summary: `${await actorName(ctx, args.actorId)} filed ${args.name} into Approved/ for ${args.shotCode}`,
    });
    return assetId;
  },
});

const syncedFileValidator = v.object({
  id: v.string(),
  name: v.string(),
  trashed: v.boolean(),
  mimeType: v.optional(v.string()),
  md5: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  webViewLink: v.optional(v.string()),
});

type UpsertSyncedResult = {
  newFiles: number;
  updated: number;
  missing: number;
  thumbsNeeded: {
    assetId: Id<"assets">;
    driveFileId: string;
    md5: string | null;
  }[];
};

export const upsertSyncedFiles = internalMutation({
  args: {
    productionId: v.id("productions"),
    uploadedBy: v.id("users"),
    connectionId: v.id("googleConnections"),
    parentId: v.string(),
    files: v.array(syncedFileValidator),
  },
  handler: async (ctx, args): Promise<UpsertSyncedResult> => {
    const now = Date.now();
    const result: UpsertSyncedResult = {
      newFiles: 0,
      updated: 0,
      missing: 0,
      thumbsNeeded: [],
    };
    for (const file of args.files) {
      const existing = await ctx.db
        .query("assets")
        .withIndex("by_driveFileId", (q) => q.eq("driveFileId", file.id))
        .first();
      if (existing === null) {
        if (file.trashed) continue; // never knew it, never will
        const assetId = await ctx.db.insert("assets", {
          productionId: args.productionId,
          provider: "gdrive",
          kind: "file",
          driveFileId: file.id,
          driveParentId: args.parentId,
          ownerConnectionId: args.connectionId,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          md5: file.md5,
          webViewLink: file.webViewLink,
          syncedAt: now,
          uploadedBy: args.uploadedBy,
        });
        result.newFiles++;
        result.thumbsNeeded.push({
          assetId,
          driveFileId: file.id,
          md5: file.md5 ?? null,
        });
        continue;
      }
      const changed =
        existing.name !== file.name ||
        existing.md5 !== file.md5 ||
        existing.sizeBytes !== file.sizeBytes ||
        existing.webViewLink !== file.webViewLink ||
        (existing.missing === true) !== file.trashed;
      if (changed) {
        await ctx.db.patch(existing._id, {
          name: file.name,
          mimeType: file.mimeType ?? existing.mimeType,
          sizeBytes: file.sizeBytes,
          md5: file.md5,
          webViewLink: file.webViewLink ?? existing.webViewLink,
          missing: file.trashed ? true : undefined,
          syncedAt: now,
        });
        result.updated++;
      }
      if (file.trashed) {
        result.missing++;
        continue;
      }
      const needsThumb =
        existing.thumbStorageId === undefined ||
        (file.md5 !== undefined &&
          existing.thumbForMd5 !== undefined &&
          existing.thumbForMd5 !== file.md5);
      if (needsThumb) {
        result.thumbsNeeded.push({
          assetId: existing._id,
          driveFileId: file.id,
          md5: file.md5 ?? null,
        });
      }
    }
    return result;
  },
});

export const setAssetThumb = internalMutation({
  args: {
    assetId: v.id("assets"),
    thumbStorageId: v.id("_storage"),
    thumbForMd5: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const asset = await ctx.db.get(args.assetId);
    if (asset === null) return null;
    await ctx.db.patch(args.assetId, {
      thumbStorageId: args.thumbStorageId,
      thumbForMd5: args.thumbForMd5,
    });
    return null;
  },
});

export const logSynced = internalMutation({
  args: {
    productionId: v.id("productions"),
    actorId: v.id("users"),
    newFiles: v.number(),
    updated: v.number(),
    missing: v.number(),
    viaCron: v.boolean(),
  },
  handler: async (ctx, args): Promise<null> => {
    const parts = [`${args.newFiles} new file(s)`];
    if (args.updated > 0) parts.push(`${args.updated} updated`);
    if (args.missing > 0) parts.push(`${args.missing} missing`);
    const summary = args.viaCron
      ? `Drive sync found ${parts.join(", ")}`
      : `${await actorName(ctx, args.actorId)} synced the Drive hub — ${parts.join(", ")}`;
    await logActivity(ctx, {
      productionId: args.productionId,
      actorId: args.actorId,
      type: "drive.synced",
      targetType: "production",
      targetId: args.productionId,
      summary,
    });
    return null;
  },
});
