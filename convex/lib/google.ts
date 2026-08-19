/**
 * Google Drive v3 + OAuth helpers (spec §7) — plain fetch REST, no googleapis
 * dependency, no "use node". Server-side only: access tokens flow through here
 * and MUST NEVER be returned to clients (the single sanctioned exception is
 * drive.getPickerConfig, which hands the caller their OWN short-lived token).
 */

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const CONSENT_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const FILE_FIELDS =
  "id,name,mimeType,size,md5Checksum,webViewLink,trashed,thumbnailLink";

/**
 * Names the ENV PLANE, not just the variables. Convex functions read the
 * deployment's own environment (`npx convex env set …` / the Convex
 * dashboard). Setting these in Docker, compose or Dokploy's Environment tab
 * configures the frontend container instead, which this code never sees — the
 * mistake is invisible and the message is the only place it surfaces.
 */
export const CONFIG_ERROR =
  "Google Drive is not configured yet — set GOOGLE_DRIVE_CLIENT_ID and " +
  "GOOGLE_DRIVE_CLIENT_SECRET on the CONVEX DEPLOYMENT (npx convex env set …, " +
  "or the Convex dashboard). Docker/Dokploy environment variables do not reach " +
  "Convex functions. Check with: npx convex env list — see README §Google setup";

/** Thrown when a connection is revoked or its refresh token stops working. */
export class DriveAuthError extends Error {
  constructor() {
    super("Drive connection expired — reconnect");
    this.name = "DriveAuthError";
  }
}

export function googleEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function requireGoogleEnv(): { clientId: string; clientSecret: string } {
  const env = googleEnv();
  if (!env) throw new Error(CONFIG_ERROR);
  return env;
}

/** OAuth redirect URI — must match the GCP console configuration exactly. */
export function redirectUri(): string {
  return `${process.env.CONVEX_SITE_URL}/google/drive/callback`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function tokenPost(
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: TokenResponse }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  return { ok: res.ok, status: res.status, data };
}

/** Exchange an OAuth authorization code for tokens (connect callback). */
export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
}> {
  const { clientId, clientSecret } = requireGoogleEnv();
  const { ok, status, data } = await tokenPost({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  if (!ok || !data.access_token) {
    throw new Error(
      `Google code exchange failed (${status}): ${data.error ?? "no access_token"}`,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scopes: (data.scope ?? DRIVE_SCOPE).split(" ").filter(Boolean),
  };
}

/**
 * Return a valid access token for a connection, refreshing when it expires in
 * under 60s. Persists refreshed tokens; `invalid_grant` marks the connection
 * revoked and throws DriveAuthError ("Drive connection expired — reconnect").
 */
export async function getFreshToken(
  ctx: ActionCtx,
  connectionId: Id<"googleConnections">,
): Promise<string> {
  const conn = await ctx.runQuery(internal.drive.connectionForToken, {
    connectionId,
  });
  if (!conn) throw new Error("Drive connection not found");
  if (conn.revoked) throw new DriveAuthError();
  if (conn.expiresAt >= Date.now() + 60_000) return conn.accessToken;

  if (conn.refreshToken === null) {
    await ctx.runMutation(internal.drive.markRevoked, { connectionId });
    throw new DriveAuthError();
  }
  const { clientId, clientSecret } = requireGoogleEnv();
  const { ok, data } = await tokenPost({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: conn.refreshToken,
    grant_type: "refresh_token",
  });
  if (!ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      await ctx.runMutation(internal.drive.markRevoked, { connectionId });
      throw new DriveAuthError();
    }
    throw new Error(`Google token refresh failed: ${data.error ?? "unknown"}`);
  }
  await ctx.runMutation(internal.drive.persistToken, {
    connectionId,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    ...(data.refresh_token !== undefined
      ? { refreshToken: data.refresh_token }
      : {}),
  });
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Drive v3 REST helpers
// ---------------------------------------------------------------------------

export type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string; // Drive returns sizes as strings
  md5Checksum?: string;
  webViewLink?: string;
  trashed?: boolean;
  thumbnailLink?: string;
};

/** Escape a value for use inside single quotes in a Drive `q` expression. */
export function qEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Low-level Drive v3 request. Always appends `supportsAllDrives=true`.
 * `path` is relative to https://www.googleapis.com/drive/v3 (or absolute).
 */
export async function driveRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${DRIVE_API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("supportsAllDrives", "true");
  const extraHeaders = (init?.headers ?? {}) as Record<string, string>;
  const res = await fetch(url.toString(), {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Drive API ${res.status} ${init?.method ?? "GET"} ${url.pathname}: ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

export async function createFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<DriveFile> {
  return await driveRequest<DriveFile>(
    token,
    "/files",
    jsonInit("POST", {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId !== undefined ? { parents: [parentId] } : {}),
    }),
    { fields: "id,name,mimeType" },
  );
}

/** files.list with pagination (also sets includeItemsFromAllDrives=true). */
export async function listFiles(token: string, q: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  let page = 0;
  do {
    const data = await driveRequest<{
      files?: DriveFile[];
      nextPageToken?: string;
    }>(token, "/files", undefined, {
      q,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "1000",
      includeItemsFromAllDrives: "true",
      ...(pageToken !== undefined ? { pageToken } : {}),
    });
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
    page++;
  } while (pageToken !== undefined && page < 100);
  return files;
}

export async function copyFile(
  token: string,
  fileId: string,
  args: { name: string; parents: string[] },
): Promise<DriveFile> {
  return await driveRequest<DriveFile>(
    token,
    `/files/${fileId}/copy`,
    jsonInit("POST", args),
    { fields: FILE_FIELDS },
  );
}

/** files.create with media — multipart/related built by hand (spec §7.3). */
export async function multipartUpload(
  token: string,
  args: {
    name: string;
    mimeType: string;
    parents: string[];
    bytes: ArrayBuffer | Uint8Array;
  },
): Promise<DriveFile> {
  const boundary = `slate_boundary_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: args.name,
    mimeType: args.mimeType,
    parents: args.parents,
  });
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${args.mimeType}\r\n\r\n`,
  );
  const media =
    args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes);
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + media.length + tail.length);
  body.set(head, 0);
  body.set(media, head.length);
  body.set(tail, head.length + media.length);

  const url = new URL(DRIVE_UPLOAD);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", FILE_FIELDS);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive upload failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as DriveFile;
}

export async function permissionCreate(
  token: string,
  fileId: string,
  args: { role: "writer" | "commenter" | "reader"; emailAddress: string },
): Promise<void> {
  await driveRequest<{ id?: string }>(
    token,
    `/files/${fileId}/permissions`,
    jsonInit("POST", {
      role: args.role,
      type: "user",
      emailAddress: args.emailAddress,
    }),
    { sendNotificationEmail: "false" },
  );
}

/** GET /files/{id}?alt=media — the raw bytes. */
export async function getFileBytes(
  token: string,
  fileId: string,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Could not read Drive file ${fileId} (${res.status})`);
  }
  return await res.arrayBuffer();
}

/** Who is this token? GET /about?fields=user. */
export async function aboutUser(token: string): Promise<{
  emailAddress: string;
  permissionId: string;
  displayName?: string;
}> {
  const data = await driveRequest<{
    user?: {
      emailAddress?: string;
      permissionId?: string;
      displayName?: string;
    };
  }>(token, "/about", undefined, { fields: "user" });
  if (!data.user?.emailAddress || !data.user.permissionId) {
    throw new Error("Could not read the Google account behind this token");
  }
  return {
    emailAddress: data.user.emailAddress,
    permissionId: data.user.permissionId,
    displayName: data.user.displayName,
  };
}
