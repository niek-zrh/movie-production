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
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanForProduction,
  assertMemberForProduction,
  requireUserId,
} from "./lib/permissions";
import { actorName, logActivity } from "./lib/activity";
import { notify } from "./lib/notify";
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
  driveRequest,
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

const DRIVE_API = "https://www.googleapis.com/drive/v3";

/**
 * Ceiling for a Picker attach. The action holds the downloaded bytes AND the
 * multipart body it builds from them, so an unbounded pick (a studio picks
 * camera masters) runs the action out of memory and the whole attach dies with
 * nothing useful on screen. Named in the error so the number is never a
 * mystery (spec §7.3).
 */
const MAX_PICKER_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PICKER_FILE_LABEL = "50 MB";

/**
 * Its own class so attachFromPicker can let the limit through while every
 * other per-file failure stays a quiet "skipped" (a Drive hiccup on one file
 * must never fail the attach).
 */
class PickTooLargeError extends ConvexError<string> {}

/**
 * Last-resort thumbnail size. Drive's own thumbnailLink is the thumbnail we
 * want; storing the original instead only makes sense for something already
 * small enough to serve into a 36px row.
 */
const MAX_INLINE_THUMB_BYTES = 2 * 1024 * 1024;

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Cache Drive's own thumbnail (thumbnailLink, part of FILE_FIELDS) into Convex
 * storage. Best-effort by design: any failure returns undefined and the next
 * sync pass retries it, because a missing thumbnail must never fail a write.
 */
async function cacheDriveThumb(
  ctx: ActionCtx,
  token: string,
  thumbnailLink: string | undefined,
): Promise<Id<"_storage"> | undefined> {
  if (thumbnailLink === undefined) return undefined;
  try {
    const res = await fetch(thumbnailLink, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    return await ctx.storage.store(await res.blob());
  } catch {
    return undefined; // thumbnails are best-effort
  }
}

type DrivePermission = {
  id: string;
  type?: string;
  role?: string;
  emailAddress?: string;
};

/** permissions.list on one file — used to find a member's grant by email. */
async function permissionsList(
  token: string,
  fileId: string,
): Promise<DrivePermission[]> {
  const data = await driveRequest<{ permissions?: DrivePermission[] }>(
    token,
    `/files/${encodeURIComponent(fileId)}/permissions`,
    undefined,
    { fields: "permissions(id,type,role,emailAddress)" },
  );
  return data.permissions ?? [];
}

/**
 * permissions.delete answers 204 with an empty body, which driveRequest cannot
 * carry (it parses JSON), so this one call goes out as a plain fetch. A 404 is
 * success: the grant is already gone.
 */
async function permissionDelete(
  token: string,
  fileId: string,
  permissionId: string,
): Promise<void> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Drive permissions.delete failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
}

/**
 * The caller's own Drive connection: newest first, preferring one that still
 * works. Reconnecting with a DIFFERENT Google account adds a row instead of
 * overwriting one a hub points at (see saveConnection), so a user can hold
 * more than one — "mine" is the latest account they consented with, while
 * every hub keeps the account that created it.
 */
async function myConnectionRow(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Doc<"googleConnections"> | null> {
  const rows = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();
  return rows.find((r) => r.revoked !== true) ?? rows[0] ?? null;
}

/**
 * Productions whose hub is bound to one of these connections. Full scan, like
 * hubProductions — a pilot studio has a handful of productions and there is no
 * index on hub.connectionId.
 */
async function productionsForConnections(
  ctx: MutationCtx,
  connectionIds: Id<"googleConnections">[],
): Promise<Doc<"productions">[]> {
  if (connectionIds.length === 0) return [];
  const ids = new Set<string>(connectionIds);
  const productions = await ctx.db.query("productions").collect();
  return productions.filter(
    (p) => p.hub !== undefined && ids.has(p.hub.connectionId),
  );
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
    const mine = await myConnectionRow(ctx, userId);
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

    // Share the root with every member that has joined — best-effort each.
    // (Pending invites are shared when they accept, see scaffoldContext.)
    for (const member of info.members) {
      if (
        info.connectionEmail !== null &&
        sameEmail(member.email, info.connectionEmail)
      ) {
        continue; // the hub owner already owns the folder
      }
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
    // Drive's generated thumbnail first — storing the original as the "thumb"
    // serves a full-resolution frame into a 36px row (§7). Only a file already
    // small enough to be a thumbnail stands in when Drive has none yet; bigger
    // ones wait for the sync pass that caches thumbnailLink.
    let thumbStorageId = await cacheDriveThumb(ctx, token, file.thumbnailLink);
    if (
      thumbStorageId === undefined &&
      args.mimeType.startsWith("image/") &&
      args.bytes.byteLength <= MAX_INLINE_THUMB_BYTES
    ) {
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

    // Ask Drive for the sizes before downloading anything: this action holds
    // each file whole, and meeting a camera master halfway through the loop
    // would OOM it with the attach already half done (spec §7.3).
    const tooLarge: string[] = [];
    for (const picked of args.files) {
      const size = await pickedFileSize(myToken, picked.id);
      if (size !== null && size > MAX_PICKER_FILE_BYTES) {
        tooLarge.push(`${picked.name} (${megabytes(size)})`);
      }
    }
    if (tooLarge.length > 0) {
      throw new ConvexError(
        `Kinolab copies files up to ${MAX_PICKER_FILE_LABEL} from Drive — too large: ${tooLarge.join(", ")}. Share those as a link instead.`,
      );
    }

    let attached = 0;
    const skipped: string[] = [];
    for (const picked of args.files) {
      try {
        const mimeType = picked.mimeType ?? "application/octet-stream";
        const { file, sizeBytes } = await copyPickedFileToHub(
          myToken,
          hubToken,
          picked,
          { mimeType, parentId: optionsId },
        );
        // Drive's own thumbnail, never the full-resolution original: this ends
        // up in a 36px list row (§7). Drive may not have generated one yet —
        // then the asset goes in without, and the next sync pass fills it.
        const thumbStorageId = await cacheDriveThumb(
          ctx,
          hubToken,
          file.thumbnailLink,
        );
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
                file.size !== undefined ? Number(file.size) : sizeBytes,
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
            sizeBytes: file.size !== undefined ? Number(file.size) : sizeBytes,
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
        // The size limit is the user's to know; anything else stays a skip.
        if (e instanceof PickTooLargeError) throw e;
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
    // Only a sync that actually changed something gets a row: "Sync now" is
    // one click any member can repeat, and an activity feed full of identical
    // "synced — 0 new file(s)" lines buries the production's real history.
    if (hasChanges(counts)) {
      await ctx.runMutation(internal.drive.logSynced, {
        productionId: args.productionId,
        actorId: sctx.userId,
        newFiles: counts.newFiles,
        updated: counts.updated,
        missing: counts.missing,
        viaCron: false,
      });
    }
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
        if (hasChanges(counts)) {
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

/**
 * Share this studio's hubs with a member who just joined (spec §7).
 * scaffoldHub only shares with people who have accepted, so this is the other
 * half of that rule — scheduled from studios.claimInvitesForUser. Best-effort
 * throughout: sign-in must never depend on Drive.
 */
export const shareHubsWithMember = internalAction({
  args: { studioId: v.id("studios"), userId: v.id("users") },
  handler: async (ctx, args): Promise<null> => {
    const targets = await ctx.runQuery(internal.drive.studioHubTargets, {
      studioId: args.studioId,
      userId: args.userId,
    });
    if (targets.email === null || targets.role === null) return null;
    for (const hub of targets.hubs) {
      if (hub.ownerEmail !== null && sameEmail(hub.ownerEmail, targets.email)) {
        continue; // the hub owner already owns the folder
      }
      try {
        const token = await getFreshToken(ctx, hub.connectionId);
        await permissionCreate(token, hub.rootFolderId, {
          role: targets.role === "viewer" ? "commenter" : "writer",
          emailAddress: targets.email,
        });
      } catch (e) {
        console.log(
          `shareHubsWithMember: could not share ${hub.productionName} with ${targets.email}: ${String(e)}`,
        );
      }
    }
    return null;
  },
});

/**
 * Drop a removed member's Drive permission on every hub of this studio.
 * Revoking app access leaves Drive untouched otherwise, so an ex-member keeps
 * writer rights on confidential pre-release material forever (spec §7).
 * Scheduled from studios.removeMember and best-effort per hub: a Drive failure
 * is logged, never thrown, so removal itself is already done and final.
 */
export const revokeMemberAccess = internalAction({
  args: { studioId: v.id("studios"), email: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const { hubs } = await ctx.runQuery(internal.drive.studioHubTargets, {
      studioId: args.studioId,
    });
    for (const hub of hubs) {
      // Removing the hub owner's own grant would orphan the hub; Drive would
      // refuse anyway (they own the folder).
      if (hub.ownerEmail !== null && sameEmail(hub.ownerEmail, args.email)) {
        console.log(
          `revokeMemberAccess: ${args.email} owns the hub for ${hub.productionName} — leaving Drive access in place`,
        );
        continue;
      }
      try {
        const token = await getFreshToken(ctx, hub.connectionId);
        const permissions = await permissionsList(token, hub.rootFolderId);
        for (const permission of permissions) {
          if (permission.type !== "user" || permission.role === "owner") continue;
          if (
            permission.emailAddress === undefined ||
            !sameEmail(permission.emailAddress, args.email)
          ) {
            continue;
          }
          await permissionDelete(token, hub.rootFolderId, permission.id);
          console.log(
            `revokeMemberAccess: removed ${args.email} from ${hub.productionName}`,
          );
        }
      } catch (e) {
        console.log(
          `revokeMemberAccess: could not revoke ${args.email} on ${hub.productionName}: ${String(e)}`,
        );
      }
    }
    return null;
  },
});

// ===========================================================================
// Shared action-side helpers
// ===========================================================================

/** Google addresses are case-insensitive; our rows are not normalized. */
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * files.get for the size alone. null when Drive will not say (a Google Doc has
 * no size, an unreadable file is reported as skipped by the copy loop anyway).
 */
async function pickedFileSize(
  token: string,
  fileId: string,
): Promise<number | null> {
  try {
    const meta = await driveRequest<{ size?: string }>(
      token,
      `/files/${encodeURIComponent(fileId)}`,
      undefined,
      { fields: "id,size" },
    );
    return meta.size !== undefined ? Number(meta.size) : null;
  } catch (e) {
    console.log(
      `attachFromPicker: could not read Drive metadata for ${fileId}: ${String(e)}`,
    );
    return null;
  }
}

/**
 * Read a picked file with the member's token and write the copy into the hub
 * with the hub owner's. The bytes stay scoped to this helper, so one file at a
 * time is held and it is released as soon as the upload returns (spec §7.3).
 */
async function copyPickedFileToHub(
  myToken: string,
  hubToken: string,
  picked: { id: string; name: string },
  args: { mimeType: string; parentId: string },
): Promise<{ file: DriveFile; sizeBytes: number }> {
  const bytes = await getFileBytes(myToken, picked.id);
  // Second gate: Drive reports no size for some files, so check what we got.
  if (bytes.byteLength > MAX_PICKER_FILE_BYTES) {
    throw new PickTooLargeError(
      `${picked.name} is ${megabytes(bytes.byteLength)} — Kinolab copies files up to ${MAX_PICKER_FILE_LABEL} from Drive. Share it as a link instead.`,
    );
  }
  const file = await multipartUpload(hubToken, {
    name: picked.name,
    mimeType: args.mimeType,
    parents: [args.parentId],
    bytes,
  });
  return { file, sizeBytes: bytes.byteLength };
}

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
    const candidateId = await ensureFolder(token, shotsRoot, shot.code);
    // Compare-and-set: a concurrent upload may have won the race — converge
    // on whichever folder id the mutation kept.
    const kept = await ctx.runMutation(internal.drive.setShotDriveFolder, {
      shotId: shot._id,
      driveFolderId: candidateId,
    });
    if (kept !== candidateId) {
      console.log(
        `ensureShotFolders: ${shot.code} raced — keeping ${kept}, Drive folder ${candidateId} is unused`,
      );
    }
    shotFolderId = kept;
  }
  const children = await listFolderChildren(token, shotFolderId);
  const optionsId = await ensureFolder(token, shotFolderId, "Options", children);
  const approvedId = await ensureFolder(
    token,
    shotFolderId,
    "Approved",
    children,
  );
  return { shotFolderId, optionsId, approvedId };
}

/** Sub-folders of one folder — the lookup behind ensureFolder. */
async function listFolderChildren(
  token: string,
  parentId: string,
): Promise<DriveFile[]> {
  return await listFiles(
    token,
    `'${qEscape(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
  );
}

/**
 * Lowest id wins, so two actions that both see the same duplicates choose the
 * same folder instead of each filing into its own.
 */
function pickFolder(files: DriveFile[], name: string): string | undefined {
  return files
    .filter((f) => f.name === name && f.trashed !== true)
    .map((f) => f.id)
    .sort()[0];
}

/**
 * Idempotent folder creation per (parent, name): concurrent uploads to the
 * same shot used to create the shot folder and its Options/ + Approved/
 * children twice over, leaving duplicates and orphans in the studio's Drive.
 * After creating, we re-list and converge on the lowest id, so whoever lost
 * the race still files into the winner's folder. Nothing is ever deleted —
 * a stray empty folder is cheap, a trashed one full of dailies is not.
 */
async function ensureFolder(
  token: string,
  parentId: string,
  name: string,
  known?: DriveFile[],
): Promise<string> {
  // Named lookup, not the whole parent: Shots/ holds one folder per shot.
  const byName = async (): Promise<DriveFile[]> =>
    await listFiles(
      token,
      `'${qEscape(parentId)}' in parents and name = '${qEscape(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
  const found = pickFolder(known ?? (await byName()), name);
  if (found !== undefined) return found;
  const created = await createFolder(token, name, parentId);
  const winner = pickFolder(await byName(), name) ?? created.id;
  if (winner !== created.id) {
    console.log(
      `ensureFolder: "${name}" was created twice under ${parentId} — using ${winner}`,
    );
  }
  return winner;
}

type SyncCounts = { newFiles: number; updated: number; missing: number };

/**
 * Did this pass change anything? `missing` is a standing count — a trashed file
 * is counted again on every pass — so only rows we inserted or patched make a
 * sync worth an activity row (a file that goes missing patches its row, so it
 * still shows up as `updated`).
 */
function hasChanges(counts: SyncCounts): boolean {
  return counts.newFiles + counts.updated > 0;
}

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
      // The hub root is the one folder this token must be able to open: it
      // created it. If it cannot, the hub is gone or belongs to another Google
      // account, and counting zeros would report "up to date" over a hub we
      // cannot see at all (spec §7).
      if (folderId === args.hub.rootFolderId) {
        console.log(`drive sync: hub root ${folderId} unreadable: ${String(e)}`);
        throw new ConvexError(
          "Kinolab can't open this production's hub folder in Drive — reconnect the Google account that created the hub (Settings → Drive hub)",
        );
      }
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
      const thumbStorageId = await cacheDriveThumb(
        ctx,
        token,
        byId.get(thumb.driveFileId)?.thumbnailLink,
      );
      if (thumbStorageId === undefined) continue;
      await ctx.runMutation(internal.drive.setAssetThumb, {
        assetId: thumb.assetId,
        thumbStorageId,
        ...(thumb.md5 !== null ? { thumbForMd5: thumb.md5 } : {}),
      });
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
    const conn = await myConnectionRow(ctx, userId);
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
    const mine = await myConnectionRow(ctx, userId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_studio", (q) => q.eq("studioId", production.studioId))
      .collect();
    const members: { email: string; role: string }[] = [];
    for (const membership of memberships) {
      // Only people who actually joined. A pending invite is just an address:
      // handing it writer access to confidential pre-release material — access
      // nothing later revokes — must not happen before it is accepted. The
      // share happens on join instead (studios.claimInvitesForUser →
      // drive.shareHubsWithMember).
      if (membership.userId === undefined) continue;
      const user = await ctx.db.get(membership.userId);
      if (user?.email) members.push({ email: user.email, role: membership.role });
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
    const mine = await myConnectionRow(ctx, userId);
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

type StudioHub = {
  productionId: Id<"productions">;
  productionName: string;
  connectionId: Id<"googleConnections">;
  rootFolderId: string;
  ownerEmail: string | null;
};

/** Every connected hub of one studio, with the email whose token owns it. */
async function studioHubs(
  ctx: QueryCtx,
  studioId: Id<"studios">,
): Promise<StudioHub[]> {
  const productions = await ctx.db
    .query("productions")
    .withIndex("by_studio", (q) => q.eq("studioId", studioId))
    .collect();
  const hubs: StudioHub[] = [];
  for (const production of productions) {
    if (production.hub === undefined) continue;
    const conn = await ctx.db.get(production.hub.connectionId);
    hubs.push({
      productionId: production._id,
      productionName: production.name,
      connectionId: production.hub.connectionId,
      rootFolderId: production.hub.rootFolderId,
      ownerEmail: conn?.email ?? null,
    });
  }
  return hubs;
}

export const studioHubTargets = internalQuery({
  args: { studioId: v.id("studios"), userId: v.optional(v.id("users")) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    hubs: StudioHub[];
    email: string | null;
    role: string | null;
  }> => {
    const hubs = await studioHubs(ctx, args.studioId);
    if (args.userId === undefined) return { hubs, email: null, role: null };
    const user = await ctx.db.get(args.userId);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_studio_user", (q) =>
        q.eq("studioId", args.studioId).eq("userId", args.userId),
      )
      .unique();
    return {
      hubs,
      email: user?.email ?? null,
      role: membership?.role ?? null,
    };
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
    const rows = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect(); // oldest first

    const fresh = {
      googleUserId: args.googleUserId,
      email: args.email,
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
      scopes: args.scopes,
      revoked: undefined, // reconnecting clears a revoked flag
    };

    // The common case: the SAME Google account reconnects (expired refresh
    // token). Patch its row in place — hubs bound to it start working again.
    const same = rows.find((r) => r.googleUserId === args.googleUserId);
    if (same !== undefined) {
      await ctx.db.patch(same._id, {
        ...fresh,
        refreshToken: args.refreshToken ?? same.refreshToken,
      });
      return same._id;
    }

    /**
     * A DIFFERENT Google account. Under `drive.file` the new token can see
     * nothing the old account created, so overwriting a row that a
     * production.hub points at would leave every hub write and every sync
     * talking to a Drive where the hub does not exist — and sync would keep
     * reporting "up to date" forever (spec §7). Rows a hub depends on are
     * therefore never repointed: the hub keeps naming the account that built
     * it, the UI keeps showing it as the hub owner, and its writes fail loudly
     * ("Drive connection expired — reconnect") instead of quietly.
     */
    const hubbed = await productionsForConnections(
      ctx,
      rows.map((r) => r._id),
    );
    const hubbedIds = new Set<string>(
      hubbed.flatMap((p) => (p.hub !== undefined ? [p.hub.connectionId] : [])),
    );
    const reusable = rows.filter((r) => !hubbedIds.has(r._id));
    const target = reusable[reusable.length - 1];

    let connectionId: Id<"googleConnections">;
    if (target !== undefined) {
      // No hub depends on this row — switching accounts on it is harmless.
      await ctx.db.patch(target._id, {
        ...fresh,
        refreshToken: args.refreshToken ?? target.refreshToken,
      });
      connectionId = target._id;
    } else {
      connectionId = await ctx.db.insert("googleConnections", {
        userId: args.userId,
        googleUserId: args.googleUserId,
        email: args.email,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt: args.expiresAt,
        scopes: args.scopes,
      });
    }

    // Say it out loud on every production that stayed behind: silence here is
    // exactly how a studio ends up believing its files are safe.
    const actor = await actorName(ctx, args.userId);
    for (const production of hubbed) {
      if (production.hub === undefined) continue;
      const owner = await ctx.db.get(production.hub.connectionId);
      const ownerEmail = owner?.email ?? "another Google account";
      await logActivity(ctx, {
        productionId: production._id,
        actorId: args.userId,
        type: "drive.hub_owner_mismatch",
        targetType: "production",
        targetId: production._id,
        summary: `${actor} connected Google account ${args.email}, but this Drive hub was created by ${ownerEmail} — hub writes and sync keep using ${ownerEmail}`,
      });
      await notify(ctx, {
        userId: args.userId,
        productionId: production._id,
        type: "drive.hub_owner_mismatch",
        title: "Drive hub belongs to a different Google account",
        body: `You connected ${args.email}, but the Drive hub for ${production.name} was created by ${ownerEmail}. Google only lets Kinolab see files it created for that account, so the hub still runs on ${ownerEmail} — reconnect with that account to keep uploads and sync working.`,
        href: `/p/${production._id}/settings`,
      });
    }
    return connectionId;
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
