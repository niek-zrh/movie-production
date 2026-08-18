# Backend contracts — Convex module surface

This is the binding contract between backend modules and the frontend. If you
are implementing a module, match these names and shapes exactly; note real
deviations at the end of your work. If you are building UI, this is the API
you call via `api.<module>.<fn>`.

Shared rules for every module (non-negotiable):

1. Every **mutation**: permission check → invariant checks → writes → exactly
   one `logActivity` row with a human-readable summary that includes the actor
   name (use `actorName(ctx, userId)` from `./lib/activity`), e.g.
   `"Anna picked v3 for SC010_SH020 — 'best hand anatomy'"`.
2. Every **query**: assert membership (`assertMember` / `assertMemberForProduction`
   from `./lib/permissions`). Never return Google tokens or `googleConnections`
   docs to clients — ever.
3. Convex validators (`v`) on all args; TypeScript strict; no `any`.
4. Use helpers from `convex/lib/`: `permissions.ts` (assertCan,
   assertCanForProduction, assertMember, assertMemberForProduction,
   canDecideGate, canDecideForShot, canEditShot, requireUserId),
   `activity.ts` (logActivity, actorName), `notify.ts` (notify, notifyMany),
   `domain.ts` (STAGES, SHOT_STATUSES, WORKING_STATUSES, canonicalApprovedName,
   HUB_FOLDERS).
5. Timestamps: `Date.now()`. Dates as `"YYYY-MM-DD"` strings in the
   production's timezone (`formatInTimeZone` from `date-fns-tz`).
6. Activity `type` values are dot-namespaced and FIXED (reports count on
   them): `production.created`, `shot.created`, `shot.status_changed`,
   `shot.stage_changed`, `shot.updated`, `version.added`, `version.shortlisted`,
   `version.rejected`, `version.picked`, `gate.requested`, `gate.approved`,
   `gate.rejected`, `comment.added`, `report.published`, `qc.run_started`,
   `qc.run_passed`, `qc.run_failed`, `drive.hub_created`, `drive.synced`.
7. Notification `type` values: `mention`, `approval_requested`,
   `gate_decided`, `version_picked`, `report_published`, `shot_assigned`.
   `href` is an app path like `/p/{productionId}/shots/{shotId}`.

Enriched user shape used across returns:
`{ _id: Id<"users">, name: string, image?: string }` — call it `UserRef`.
Build with a local helper; `name` falls back to email then "Unknown".

---

## productions.ts

- `create` (mutation): `{ studioId, name: string, code: string, kind: "feature"|"episodic", episodeCount?: number, timezone?: string }` → `Id<"productions">`.
  Perm `production.manage`. code uppercased, 2–6 chars A–Z0–9. Creates 6
  stageInstances (from STAGES: stage 1 `active`, others `not_started`, gates
  `open`, `gateApproverIds: []`), episodes 1..episodeCount when episodic,
  timezone default "Europe/Zurich", status "active". Activity `production.created`.
- `listForStudio` (query): `{ studioId }` → productions with
  `{ ...production, shotCounts: { total: number, byStatus: Record<string, number> }, hubConnected: boolean }`. Never include `hub.connectionId` semantics beyond presence; folderIds are fine.
- `get` (query): `{ productionId }` → `{ ...production, hubConnected: boolean, episodes: Doc<"episodes">[] }`.
- `update` (mutation): `{ productionId, name?, status?: "active"|"paused"|"wrapped", timezone? }`. Perm `production.manage`. Activity `shot.updated`-style summary under type `production.created`? No — use type `shot.updated`? No. Use `production.created`? No. **Use activity type `production.updated`** (add to the fixed list). 
- `listStages` (query): `{ productionId }` → stageInstances ordered by STAGES
  order, each enriched `{ ...stageInstance, label, short, approvers: UserRef[] }`.
- `setStageStatus` (mutation): `{ stageInstanceId, status: "not_started"|"active"|"blocked"|"done" }`.
  Permission: `canDecideGate(member, stageInstance, userId)` OR capability
  `production.manage`. Activity `shot.stage_changed`? **No — use `stage.status_changed`** (add to fixed list).
- `setGateApprovers` (mutation): `{ stageInstanceId, approverIds: Id<"users">[] }`. Perm `production.manage`. Verify each is a studio member. No activity row needed (config, not state) — exception to rule 1, documented here.

## episodes.ts

- `list` (query): `{ productionId }` → episodes ordered by number.
- `create` (mutation): `{ productionId, number, title? }` perm `production.manage`.
- `update` (mutation): `{ episodeId, title? }` perm `production.manage`.

## externalLinks.ts

- `list` (query): `{ productionId }` → links.
- `add` (mutation): `{ productionId, kind: "figma"|"sheet"|"miro"|"telegram"|"other", title, url }` perm `production.manage`. Validate http(s) URL.
- `update` (mutation): `{ linkId, title?, url? }` perm `production.manage`.
- `remove` (mutation): `{ linkId }` perm `production.manage`.
(no activity rows for links — config, documented exception)

## scenes.ts

- `list` (query): `{ productionId, episodeId? }` → scenes ordered by `order`, each with `shotCount`.
- `create` (mutation): `{ productionId, episodeId?, code, title?, figmaUrl?, description? }` perm `content.edit`. Order = max+1.
- `update` (mutation): `{ sceneId, title?, figmaUrl?, description?, order?, episodeId? }` perm `content.edit`.
- `remove` (mutation): `{ sceneId }` perm `content.edit`; only when no shots reference it.

## shots.ts

Enriched shot shape `ShotCard`:
`{ ...shot, assignee: UserRef | null, scene: { _id, code, title? } | null, episode: { _id, number } | null, versionsCount: number, coverThumbUrl: string | null }`
(coverThumbUrl: coverAssetId → asset.thumbStorageId → `ctx.storage.getUrl`; else null)

- `list` (query): `{ productionId, status?, stage?, sceneId?, assigneeId?, episodeId? }` → `ShotCard[]` ordered by `order`. All filters optional & combinable, applied while streaming the index (never a full `.collect()` — a production past ~4k shots used to blow Convex's 4,096-document read limit and take the Shots page, Board and Overview down with it). Caps at `MAX_LIST_SHOTS` (1000); the Shots page says so when it hits the cap. `versionsCount` is read from the denormalised field on the shot, never by counting versions.
- `get` (query): `{ shotId }` → `ShotCard & { production: { _id, name, code, timezone }, pickedVersionIndex: number | null, driveFolderId?: string }`.
- `create` (mutation): `{ productionId, code, title?, sceneId?, episodeId?, stage?, assigneeId?, dueDate? }` perm `content.edit`. Unique code per production. Default stage "production", status "planned", order max+1. Activity `shot.created`.
- `bulkCreate` (mutation): `{ productionId, codes: string[], sceneId?, episodeId? }` → `{ created: number, skipped: string[] }`. Perm `content.edit`. Trims, uppercases, dedupes, skips existing. ONE activity row ("Niek created 12 shots"). Max 500 codes per call, code ≤ 64 chars, title ≤ 200 — an uncapped paste used to be unrecoverable because nothing could be deleted.
- `remove` (mutation): `{ shotId }` perm `content.edit`; refuses when the shot has versions or a pick (mirrors `scenes.remove`). Deletes the shot's dangling comments/assets, never its activity rows (reports count on them). ONE activity row.
- `bulkRemove` (mutation): `{ shotIds: Id<"shots">[] }` (max 500) — same per-shot safety rule, so a mis-paste can actually be undone.
- `update` (mutation): `{ shotId, title?, sceneId?, assigneeId?, dueDate?, order?, episodeId? }`. Permission `canEditShot`. Activity `shot.updated` (summarize what changed). If assignee changed → notify new assignee (`shot_assigned`).
- `setStatus` (mutation): `{ shotId, status }`. Permission `canEditShot(member, shot, userId, status)`. Invariants (spec §6): → `approved` requires `pickedVersionId`; → `delivered` requires the production's delivery stageInstance gateStatus !== "rejected". Activity `shot.status_changed` ("Anna moved SC010_SH020 to In review").
- `setStage` (mutation): `{ shotId, stage }`. Perm `content.edit`. Activity `shot.stage_changed`.

## versions.ts

Enriched `VersionCard`:
`{ ...version, asset: (Doc<"assets"> & { thumbUrl: string | null, fileUrl: string | null }) | null, createdByUser: UserRef, decidedByUser: UserRef | null }`
(fileUrl only for provider "storage" via storage.getUrl; gdrive uses webViewLink)

- `listForShot` (query): `{ shotId }` → `VersionCard[]` ordered by index.
- `createWithAsset` (**internalMutation** — used by uploads and Drive):
  `{ shotId, createdBy: Id<"users">, asset: { provider: "storage"|"gdrive"|"url", storageId?, driveFileId?, driveParentId?, name, mimeType?, sizeBytes?, md5?, webViewLink?, url?, thumbStorageId?, ownerConnectionId? }, promptMeta?, note? }`
  → `{ versionId, index }`. Computes index = max+1 per shot. Creates asset row
  (productionId from shot, shotId, versionId back-patched, uploadedBy) then
  version (status "candidate", primaryAssetId). Sets shot.coverAssetId if
  unset. Auto-moves shot planned/generating → options_ready (activity
  `shot.status_changed` by createdBy). Activity `version.added`.
- `generateUploadUrl` (mutation): `{ productionId }` → string. Perm `version.create`.
- `addFromUpload` (mutation): `{ shotId, storageId: Id<"_storage">, name, mimeType?, sizeBytes?, promptMeta?, note?, thumbStorageId? }` → `{ versionId, index }`. Perm `version.create` + calls the same code path as `createWithAsset` (thumbStorageId = the caller's downscaled thumbnail when supplied — the upload dropzone makes one in-browser — else storageId when mimeType starts with "image/"). If the production has a connected hub, ALSO schedule `internal.drive.mirrorUploadToHub` with the new versionId (runAfter 0) — guard with try/catch so absence never breaks upload.
- `shortlist` (mutation): `{ versionId }` → toggles candidate↔shortlisted. Permission `canDecideForShot`. Activity `version.shortlisted`.
- `reject` (mutation): `{ versionId, note? }`. Permission `canDecideForShot`. Sets rejected + decidedBy/At/decisionNote. Activity `version.rejected`.
- `unreject` (mutation): `{ versionId }` → back to candidate (only if shot not picked with this superseded). Permission `canDecideForShot`.
- `pick` (mutation): `{ versionId, note? }`. Permission `canDecideForShot`.
  Invariants: exactly one picked per shot — sets this version `picked`
  (decidedBy/At/decisionNote=note), all sibling candidate/shortlisted →
  `rejected` with decisionNote `"superseded by v{n}"`; shot.pickedVersionId set,
  shot.status → "picked" ; approvals row `{ scope: "version", targetId: versionId, requestedBy: userId, approverId: userId, status: "approved", decidedAt, note }`.
  Activity `version.picked` (include note in summary when present). Notify
  shot assignee + version creator (`version_picked`). If hub connected,
  schedule `internal.drive.copyPickToApproved({ versionId })` (try/catch guard).
- `updateMeta` (mutation): `{ versionId, promptMeta?, note? }`. Creator or `content.edit`.

## assets.ts

- `listForProduction` (query): `{ productionId, unassignedOnly?: boolean, q?: string }` → assets enriched `{ thumbUrl, fileUrl }`, newest first. `unassignedOnly`: no shotId and no versionId and kind "file".
- `listForShot` (query): `{ shotId }` → enriched assets.
- `attachToShot` (mutation): `{ assetId, shotId, asVersion: boolean }`. Perm `version.create`. Patches asset.shotId; when asVersion, creates a version around the existing asset via the same internal path (do NOT duplicate index logic). Activity `version.added` or `shot.updated`.
- `addLink` (mutation): `{ productionId, shotId?, url, name }` provider "url", kind "link". Perm `version.create`.
- `getUploadUrl` — DO NOT create here; it lives in versions.generateUploadUrl.

## approvals.ts

- `requestGateSignoff` (mutation): `{ stageInstanceId }`. Perm: any member with
  `content.edit` OR `production.manage`. Reopening a completed stage resets its
  status to "active" (see the invariant under `decideGate`). Requires `gateApproverIds` non-empty
  (error "Set gate approvers in production settings first"). Sets gateStatus
  "requested"; creates one pending approvals row per approver
  `{ scope: "stage_gate", targetId: stageInstanceId }` (skip existing
  pending); notifies approvers (`approval_requested`). Activity `gate.requested`.
- `decideGate` (mutation): `{ stageInstanceId, decision: "approved"|"rejected", note?: string }`.
  Note REQUIRED when rejecting. Permission `canDecideGate`. Refuses when the
  gate was already decided (a fresh `requestGateSignoff` reopens it). Patches
  stageInstance (gateStatus, gateDecidedBy/At/Note); approve → stage status
  "done". INVARIANT: a stage reads "done" only while its gate is `approved` —
  a rejection, or a fresh sign-off request, takes a completed stage back to
  "active". Updates this approver's pending row (or inserts a decided row if
  none) and resolves all other pending rows for the target with the same
  decision + note "decided by {name}". Activity `gate.approved`/`gate.rejected`.
  Notify the members who requested + production producers (`gate_decided`).
- `myPending` (query): `{}` → pending approvals for me across studios, enriched:
  `{ ...approval, productionName, targetLabel: string, href: string }`
  (stage gate → "Gate: Previews & Review — SIGNAL LOST", href to board; delivery → QC run name, href to /qc).
- `ledger` (query): `{ productionId, scope? }` → decided + pending approvals
  newest first, enriched `{ requestedByUser: UserRef, approverUser: UserRef, targetLabel, href }`.

## comments.ts

- `list` (query): `{ targetType, targetId }` → comments oldest first, enriched `{ author: UserRef, mentionUsers: UserRef[] }`.
- `add` (mutation): `{ productionId, targetType, targetId, body, mentions: Id<"users">[] }`. Perm `comment.create`. Notify mentions (`mention`, href to target: shot → `/p/{pid}/shots/{targetId}`, version → its shot's page — for version targets the client passes shotId via `hrefHint?: string` arg; store nothing extra). Activity `comment.added` (body first 80 chars in summary).
- `resolve` (mutation): `{ commentId }`. Author or `content.edit`.

## activity.ts (NEW top-level module `convex/activity.ts` — the helper stays at `convex/lib/activity.ts`)

- `feed` (query): `{ productionId, types?: string[], actorId?, limit? (default 50), beforeTs? }` → rows newest first enriched `{ actor: UserRef }`.

## notifications.ts

- `list` (query): `{ limit? }` → mine newest first, with `productionName?`.
- `unreadCount` (query): `{}` → number (cap display at 99).
- `markRead` (mutation): `{ notificationId }` (mine only).
- `markAllRead` (mutation): `{}`.

## search.ts

- `global` (query): `{ q: string }` → across my studios:
  `{ shots: { _id, code, title?, productionId, productionName }[], scenes: {...}[], productions: { _id, name, code }[], assets: { _id, name, productionId, productionName, shotId? }[] }`
  Case-insensitive substring, cap 8 per group, empty q → empty groups.

## reports.ts

- `generateForDate` (**internalMutation**): `{ productionId, date: string }` —
  idempotent upsert. Stats from activity rows in the production-tz day window:
  versionsAdded (`version.added`), picks (`version.picked`), rejections
  (`version.rejected`), shotsMoved (`shot.status_changed` + `shot.stage_changed`),
  commentsAdded (`comment.added`), gatesDecided (`gate.approved` + `gate.rejected`).
  Highlights: up to 10 summaries, picks & gates first, then rest newest-first.
- `cronTick` (**internalMutation**): `{}` — for every active production whose
  local time is >= 18:00, ensure today's report exists (generate once; skip if
  a report for today already exists). Keep it idempotent — it runs hourly.
- `generateNow` (mutation): `{ productionId }` → regenerates today (perm `report.publish`).
- `publish` (mutation): `{ reportId }` (perm `report.publish`) — sets
  publishedBy, notifies all studio members (`report_published`). Activity `report.published`. A published report is frozen: `generateForDate` must skip published reports.
- `list` (query): `{ productionId }` → reports newest first.
- `get` (query): `{ reportId }` → `{ ...report, dayActivity: (activity & { actor: UserRef })[] }` (that tz-day's window, oldest first).

## qc.ts

- `listParameters` (query): `{ studioId, includeArchived? }` → ordered by `order`.
- `addParameter` (mutation): `{ studioId, category, name, spec, tolerance?, required }` perm `studio.manage`. order = max+1.
- `updateParameter` (mutation): `{ parameterId, name?, spec?, tolerance?, required?, order?, archived? }` perm `studio.manage`.
- `seedDefaultTemplate` (mutation): `{ studioId }` perm `studio.manage`, idempotent (skips if any parameters exist). Seeds the §12 list (~26 params) with category + required=true except noted.
- `createRun` (mutation): `{ productionId, name, masterAssetId? }` perm `qc.run` → creates run `in_progress` + pending qcChecks for all non-archived params. Activity `qc.run_started`.
- `listRuns` (query): `{ productionId }` → runs newest first with `{ progress: { done, total }, startedByUser: UserRef }`.
- `getRun` (query): `{ qcRunId }` → `{ ...run, master: asset | null, checks: (qcCheck & { parameter: Doc<"qcParameters">, checkedByUser: UserRef | null })[] }` grouped client-side.
- `setCheck` (mutation): `{ checkId, result: "pending"|"pass"|"fail"|"na", measured?, note? }` perm `qc.run`. Recomputes run status: any required fail → `failed`; all required pass → `passed`; else `in_progress`. On transition to terminal status: completedAt, activity `qc.run_passed`/`qc.run_failed`, approvals row `{ scope: "delivery", targetId: qcRunId, status: passed ? "approved" : "rejected", requestedBy: run.startedBy, approverId: userId, decidedAt, note: run.name }`, notify run starter. Transition back out of terminal clears completedAt (corrections happen as new decisions — leave old approval rows, add new one on next terminal transition).

## drive.ts + lib/google.ts (REST via fetch, no googleapis dep)

lib/google.ts internals (not exported to clients): `getFreshToken(ctx, connectionId)` (refresh when expiresAt < now+60s via oauth2.googleapis.com/token, persist via internal mutation, `invalid_grant` → mark revoked + throw), `driveRequest(token, path, init?, query?)` always appending `supportsAllDrives=true` (+`includeItemsFromAllDrives=true` on list), helpers: createFolder, list, copy, multipartUpload, permissionCreate, getFileBytes, aboutUser.

drive.ts exports:
- `connectionStatus` (query): `{ productionId? }` → `{ myConnection: { email: string, revoked: boolean } | null, hub: { connected: boolean, rootFolderId?: string, ownerEmail?: string, revoked?: boolean } }`. NO tokens.
- `beginConnect` (mutation): `{ returnTo: string }` → `{ url: string }` — builds consent URL (client GOOGLE_DRIVE_CLIENT_ID, redirect `{CONVEX_SITE_URL}/google/drive/callback`, scope `https://www.googleapis.com/auth/drive.file`, access_type=offline, prompt=consent, state=random UUID stored in driveConnectStates). Errors clearly when env vars missing ("Google Drive is not configured yet — see README").
- `completeConnection` (**internalAction**): `{ code, state }` → `{ returnTo }` (called by drive_http.ts — keep its existing signature).
- `scaffoldHub` (action): `{ productionId, parentFolderId?: string, sharedDriveId?: string }` — perm `production.manage` (via internal query). Uses MY connection as hub connection. Creates root `{CODE} — {Name}` + HUB_FOLDERS tree, patches production.hub, shares root with each member email (writer; viewer role → commenter, sendNotificationEmail=false, best-effort per member). Activity `drive.hub_created`.
- `getPickerConfig` (action): `{}` → `{ accessToken, apiKey, appId }` for MY connection (the sanctioned short-lived token pass for the Picker).
- `uploadToShot` (action): `{ shotId, bytes: ArrayBuffer, name, mimeType, promptMeta?, note? }` → uploads into `Shots/{code}/Options/` with the HUB token (lazily creating `Shots/{code}/`, `Options/`, `Approved/`, patching shot.driveFolderId), thumbnail = original bytes when image/* (stored to Convex storage), then `internal.versions.createWithAsset`.
- `attachFromPicker` (action): `{ shotId, files: { id, name, mimeType? }[], asVersions: boolean }` — read bytes with MY token, copy into hub with HUB token, register via createWithAsset (or plain asset when !asVersions).
- `mirrorUploadToHub` (**internalAction**): `{ versionId }` — storage-provider asset + connected hub → upload bytes to Options/, flip asset to gdrive (keep storageId as thumb source).
- `copyPickToApproved` (**internalAction**): `{ versionId }` — canonicalApprovedName via production code + episode + shot code + index; gdrive asset → files.copy into Approved/; storage asset + hub → multipart upload. New asset row for the approved file (kind "file", shotId, no versionId… set versionId to the picked version — two assets per version is fine). Activity "filed into Approved/".
- `syncNow` (action): `{ productionId }` — member perm; lists all hub folders (folderIds + shot folders), upserts assets by driveFileId (name/md5/size/trashed→missing), fetches Drive thumbnails (thumbnailLink bytes with hub token) into Convex storage when md5 changed or thumb missing; NEW unknown files → asset rows (unassigned, uploadedBy = hub connection's user). NOTE: under `drive.file` "new unknown files" in practice means files the app itself created on another device/session — `files.list` does NOT return files a user dropped into the folder through Drive's UI, because the scope covers only app-created and Picker-granted files. Sync is therefore a freshness pass (renames, revisions, trashes), not a discovery pass. Patches syncedAt. Activity `drive.synced` once per manual sync ("Synced hub — 3 new files").
- `cronSync` (**internalAction**): `{}` — for each active production with hub: same as syncNow minus the activity row (only log when changes found).

## crons.ts (owned by the integrator, not agents)

hourly `reports.cronTick`; every 5 min `drive.cronSync`.

## seed.ts (owned by the integrator)

`seed:run` — idempotent §12 dataset. **`internalAction`**, not public: as a public action it was callable anonymously against the deployment URL and planted claimable owner/producer invites. Run it with `npx convex run seed:run` (which reaches internal functions), and only on a demo backend.
