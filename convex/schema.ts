import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const stageKey = v.union(
  v.literal("development"),
  v.literal("preproduction"),
  v.literal("previews"),
  v.literal("production"),
  v.literal("post"),
  v.literal("delivery"),
);

export const role = v.union(
  v.literal("owner"),
  v.literal("producer"),
  v.literal("creative_director"),
  v.literal("supervisor"),
  v.literal("artist"),
  v.literal("viewer"),
);

export const shotStatus = v.union(
  v.literal("planned"),
  v.literal("generating"),
  v.literal("options_ready"),
  v.literal("in_review"),
  v.literal("picked"),
  v.literal("approved"),
  v.literal("rework"),
  v.literal("final"),
  v.literal("delivered"),
  v.literal("killed"),
);

export default defineSchema({
  ...authTables, // users, sessions, accounts… managed by Convex Auth

  // Drive connections. NEVER expose tokens to any client-facing query.
  googleConnections: defineTable({
    userId: v.id("users"),
    googleUserId: v.string(),
    email: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
    revoked: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  studios: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.id("users"),
  }).index("by_slug", ["slug"]),

  memberships: defineTable({
    studioId: v.id("studios"),
    userId: v.optional(v.id("users")), // absent while invite is pending
    role,
    craftTitle: v.optional(v.string()), // "Animation Supervisor", "Colorist"…
    invitedEmail: v.optional(v.string()), // pending invites
  })
    .index("by_studio", ["studioId"])
    .index("by_user", ["userId"])
    .index("by_studio_user", ["studioId", "userId"])
    .index("by_invited_email", ["invitedEmail"]),

  productions: defineTable({
    studioId: v.id("studios"),
    name: v.string(),
    code: v.string(), // "SGL" — used in canonical filenames
    kind: v.union(v.literal("feature"), v.literal("episodic")),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("wrapped"),
    ),
    timezone: v.string(), // default "Europe/Zurich"
    // Drive hub. Null until a producer connects it.
    hub: v.optional(
      v.object({
        connectionId: v.id("googleConnections"), // token used for hub writes
        rootFolderId: v.string(),
        folderIds: v.record(v.string(), v.string()), // logical key -> Drive folderId
        driveKind: v.union(v.literal("myDrive"), v.literal("sharedDrive")),
        sharedDriveId: v.optional(v.string()),
      }),
    ),
  }).index("by_studio", ["studioId"]),

  episodes: defineTable({
    productionId: v.id("productions"),
    number: v.number(),
    title: v.optional(v.string()),
  }).index("by_production", ["productionId"]),

  stageInstances: defineTable({
    productionId: v.id("productions"),
    stage: stageKey,
    status: v.union(
      v.literal("not_started"),
      v.literal("active"),
      v.literal("blocked"),
      v.literal("done"),
    ),
    gateApproverIds: v.array(v.id("users")),
    gateStatus: v.union(
      v.literal("open"),
      v.literal("requested"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    gateDecidedBy: v.optional(v.id("users")),
    gateDecidedAt: v.optional(v.number()),
    gateNote: v.optional(v.string()),
  }).index("by_production", ["productionId"]),

  scenes: defineTable({
    productionId: v.id("productions"),
    episodeId: v.optional(v.id("episodes")),
    code: v.string(), // "SC010"
    title: v.optional(v.string()),
    order: v.number(),
    figmaUrl: v.optional(v.string()), // storyboard lives in Figma
    description: v.optional(v.string()),
  }).index("by_production", ["productionId"]),

  shots: defineTable({
    productionId: v.id("productions"),
    episodeId: v.optional(v.id("episodes")),
    sceneId: v.optional(v.id("scenes")),
    code: v.string(), // "SC010_SH020"
    title: v.optional(v.string()),
    status: shotStatus,
    stage: stageKey, // where this shot currently sits
    assigneeId: v.optional(v.id("users")),
    dueDate: v.optional(v.string()), // "YYYY-MM-DD"
    order: v.number(),
    pickedVersionId: v.optional(v.id("versions")),
    coverAssetId: v.optional(v.id("assets")), // thumbnail source for cards
    driveFolderId: v.optional(v.string()), // lazily created Shots/{code}/
  })
    .index("by_production", ["productionId"])
    .index("by_production_status", ["productionId", "status"])
    .index("by_scene", ["sceneId"])
    .index("by_assignee", ["assigneeId"]),

  versions: defineTable({
    shotId: v.id("shots"),
    productionId: v.id("productions"),
    index: v.number(), // v1, v2… unique per shot
    status: v.union(
      v.literal("candidate"),
      v.literal("shortlisted"),
      v.literal("picked"),
      v.literal("rejected"),
    ),
    primaryAssetId: v.optional(v.id("assets")),
    createdBy: v.id("users"),
    promptMeta: v.optional(
      v.object({
        tool: v.optional(v.string()), // "Midjourney", "Runway"…
        model: v.optional(v.string()),
        prompt: v.optional(v.string()),
        seed: v.optional(v.string()),
        params: v.optional(v.string()), // free-form JSON string
      }),
    ),
    note: v.optional(v.string()),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
  })
    .index("by_shot", ["shotId"])
    .index("by_production_status", ["productionId", "status"]),

  assets: defineTable({
    productionId: v.id("productions"),
    shotId: v.optional(v.id("shots")),
    versionId: v.optional(v.id("versions")),
    // "storage" = file bytes live in Convex storage (pilot fallback until a
    // Drive hub is connected). "gdrive" = file lives in Drive. "url" = link.
    provider: v.union(
      v.literal("gdrive"),
      v.literal("url"),
      v.literal("storage"),
    ),
    kind: v.union(v.literal("file"), v.literal("folder"), v.literal("link")),
    driveFileId: v.optional(v.string()),
    driveParentId: v.optional(v.string()),
    ownerConnectionId: v.optional(v.id("googleConnections")), // whose token can read it
    name: v.string(),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    md5: v.optional(v.string()),
    webViewLink: v.optional(v.string()),
    url: v.optional(v.string()), // for provider "url"
    storageId: v.optional(v.id("_storage")), // full file for provider "storage"
    thumbStorageId: v.optional(v.id("_storage")), // cached thumbnail
    thumbForMd5: v.optional(v.string()), // invalidate cache when md5 changes
    syncedAt: v.optional(v.number()),
    missing: v.optional(v.boolean()), // trashed/inaccessible in Drive
    uploadedBy: v.id("users"),
  })
    .index("by_production", ["productionId"])
    .index("by_shot", ["shotId"])
    .index("by_version", ["versionId"])
    .index("by_driveFileId", ["driveFileId"]),

  approvals: defineTable({
    productionId: v.id("productions"),
    scope: v.union(
      v.literal("stage_gate"),
      v.literal("shot"),
      v.literal("version"),
      v.literal("delivery"),
    ),
    targetId: v.string(), // id of stageInstance/shot/version/qcRun
    requestedBy: v.id("users"),
    approverId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    decidedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_production", ["productionId"])
    .index("by_approver_status", ["approverId", "status"])
    .index("by_target", ["scope", "targetId"]),

  comments: defineTable({
    productionId: v.id("productions"),
    targetType: v.union(
      v.literal("shot"),
      v.literal("version"),
      v.literal("stage"),
      v.literal("report"),
      v.literal("qcRun"),
    ),
    targetId: v.string(),
    authorId: v.id("users"),
    body: v.string(),
    mentions: v.array(v.id("users")),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_target", ["targetType", "targetId"])
    .index("by_production", ["productionId"]),

  activity: defineTable({
    productionId: v.id("productions"),
    actorId: v.id("users"),
    type: v.string(), // "shot.status_changed", "version.picked", "gate.approved"…
    targetType: v.string(),
    targetId: v.string(),
    summary: v.string(), // human-readable one-liner, rendered as-is in feeds
    data: v.optional(v.string()), // JSON string for details
  }).index("by_production", ["productionId"]),

  dailyReports: defineTable({
    productionId: v.id("productions"),
    date: v.string(), // "YYYY-MM-DD" in production tz
    stats: v.object({
      versionsAdded: v.number(),
      picks: v.number(),
      rejections: v.number(),
      shotsMoved: v.number(),
      commentsAdded: v.number(),
      gatesDecided: v.number(),
    }),
    highlights: v.array(v.string()), // top activity summaries
    generatedAt: v.number(),
    publishedBy: v.optional(v.id("users")),
  }).index("by_production_date", ["productionId", "date"]),

  qcParameters: defineTable({
    studioId: v.id("studios"),
    category: v.union(
      v.literal("video"),
      v.literal("audio"),
      v.literal("container"),
      v.literal("content"),
      v.literal("metadata"),
    ),
    name: v.string(), // "Loudness (EBU R128)"
    spec: v.string(), // "-23 LUFS"
    tolerance: v.optional(v.string()), // "±0.5 LU"
    required: v.boolean(),
    order: v.number(),
    archived: v.optional(v.boolean()),
  }).index("by_studio", ["studioId"]),

  qcRuns: defineTable({
    productionId: v.id("productions"),
    name: v.string(), // "EP01 — TV Master v3"
    masterAssetId: v.optional(v.id("assets")),
    status: v.union(
      v.literal("in_progress"),
      v.literal("passed"),
      v.literal("failed"),
    ),
    startedBy: v.id("users"),
    completedAt: v.optional(v.number()),
  }).index("by_production", ["productionId"]),

  qcChecks: defineTable({
    qcRunId: v.id("qcRuns"),
    parameterId: v.id("qcParameters"),
    result: v.union(
      v.literal("pending"),
      v.literal("pass"),
      v.literal("fail"),
      v.literal("na"),
    ),
    measured: v.optional(v.string()), // "-22.7 LUFS"
    note: v.optional(v.string()),
    checkedBy: v.optional(v.id("users")),
    checkedAt: v.optional(v.number()),
  }).index("by_run", ["qcRunId"]),

  externalLinks: defineTable({
    productionId: v.id("productions"),
    kind: v.union(
      v.literal("figma"),
      v.literal("sheet"),
      v.literal("miro"),
      v.literal("telegram"),
      v.literal("other"),
    ),
    title: v.string(),
    url: v.string(),
  }).index("by_production", ["productionId"]),

  notifications: defineTable({
    userId: v.id("users"),
    productionId: v.optional(v.id("productions")),
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
    readAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "readAt"]),
});
