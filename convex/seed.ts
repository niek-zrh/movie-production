import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TEMPLATE } from "./qc";
import { role as roleValidator } from "./schema";

/**
 * Idempotent demo seed (spec §12): studio Aurora North, production SIGNAL
 * LOST, 14 shots, placeholder options, activity, a report, QC template.
 * Run: npx convex run seed:run
 *
 * `run` is an internalAction, never a public one: a public seed is callable
 * anonymously over HTTP, and this seed writes a studio, ~50 stored blobs and
 * claimable pending invites (including an OWNER invite), which would hand a
 * stranger an account and defeat the invite-only sign-up gate. `npx convex
 * run` reaches internal functions, so the documented workflow is unchanged.
 *
 * Placeholder art is generated as SVG (gradient + burned-in shot code) with
 * zero dependencies and no network (DECISIONS.md). Activity rows carry
 * today's _creationTime (Convex sets it); yesterday's report is stored with
 * fabricated stats since _creationTime cannot be backdated.
 */

// --- deterministic pseudo-random -------------------------------------------
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const GRADIENTS: [string, string][] = [
  ["#1e293b", "#7048e8"],
  ["#0f766e", "#2e7de1"],
  ["#7c2d12", "#ff4d00"],
  ["#312e81", "#0ea5e9"],
  ["#3f3f46", "#b58900"],
  ["#134e4a", "#84cc16"],
  ["#4a044e", "#ec4899"],
  ["#1e3a5f", "#e8e8e4"],
];

function placeholderSvg(shotCode: string, version: number): string {
  const [c1, c2] = GRADIENTS[hash(`${shotCode}v${version}`) % GRADIENTS.length];
  const angle = (hash(shotCode) % 4) * 45;
  const cx = 80 + (hash(`${shotCode}${version}x`) % 480);
  const cy = 60 + (hash(`${shotCode}${version}y`) % 240);
  const r = 40 + (hash(`${shotCode}${version}r`) % 120);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="0.09"/>
  <circle cx="${640 - cx}" cy="${360 - cy}" r="${r / 2}" fill="#000000" opacity="0.12"/>
  <text x="24" y="330" font-family="ui-monospace,Menlo,monospace" font-size="20" fill="#ffffff" opacity="0.85">${shotCode} · v${version}</text>
  <text x="320" y="190" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="42" fill="#ffffff" opacity="0.5">SGL</text>
</svg>`;
}

// --- who ---------------------------------------------------------------------
const PEOPLE = [
  { key: "vera", name: "Vera Lindqvist", email: "vera@auroranorth.demo", role: "owner", craft: "Studio Director" },
  { key: "jonas", name: "Jonas Keller", email: "jonas@auroranorth.demo", role: "producer", craft: "Producer" },
  { key: "mara", name: "Mara Voss", email: "mara@auroranorth.demo", role: "creative_director", craft: "Creative Director" },
  { key: "ilya", name: "Ilya Petrov", email: "ilya@auroranorth.demo", role: "supervisor", craft: "Animation Supervisor" },
  { key: "sofia", name: "Sofia Marques", email: "sofia@auroranorth.demo", role: "supervisor", craft: "Post-Production Supervisor" },
  { key: "dara", name: "Dara Chen", email: "dara@auroranorth.demo", role: "artist", craft: "AI Concept Specialist" },
  { key: "nina", name: "Nina Rossi", email: "nina@auroranorth.demo", role: "artist", craft: "Colorist" },
  { key: "tom", name: "Tom Weiss", email: "tom@auroranorth.demo", role: "viewer", craft: "Broadcast Consultant" },
] as const;

/** Sign up with one of these emails (any password) to embody the persona. */
const INVITES = [
  { email: "niek.tenhove@gmail.com", role: "owner", craft: "Founder" },
  { email: "producer@demo.slate", role: "producer", craft: "Producer (demo)" },
  { email: "director@demo.slate", role: "creative_director", craft: "Creative Director (demo)" },
  { email: "artist@demo.slate", role: "artist", craft: "AI Artist (demo)" },
] as const;

const PROMPTS = [
  "wide shot, abandoned radio telescope array at dusk, volumetric fog, anamorphic, muted teal palette --ar 16:9",
  "close-up, engineer's hands on a flickering CRT console, practical lighting, film grain --ar 16:9",
  "rooftop chase at night, rain, sodium vapor lights, long lens compression, motion blur --ar 16:9",
  "signal room interior, wall of analog meters, single overhead lamp, cigarette smoke, 1970s thriller look --ar 16:9",
];

type ShotSpec = {
  code: string;
  scene: string;
  ep: number;
  title: string;
  status:
    | "planned" | "generating" | "options_ready" | "in_review"
    | "picked" | "approved" | "rework";
  stage: "previews" | "production" | "post";
  versions: number;
  picked?: number; // 1-based index of the picked version
  assignee?: string; // PEOPLE key
  due?: number; // days from now
};

const SHOTS: ShotSpec[] = [
  { code: "SC010_SH010", scene: "SC010", ep: 1, title: "The array, first light", status: "approved", stage: "production", versions: 3, picked: 2, assignee: "dara" },
  { code: "SC010_SH020", scene: "SC010", ep: 1, title: "Dish rotates toward signal", status: "options_ready", stage: "production", versions: 4, assignee: "dara", due: 2 },
  { code: "SC010_SH030", scene: "SC010", ep: 1, title: "Control room reaction", status: "generating", stage: "production", versions: 0, assignee: "dara", due: 3 },
  { code: "SC010_SH040", scene: "SC010", ep: 1, title: "Printout close-up", status: "in_review", stage: "production", versions: 2, assignee: "nina" },
  { code: "SC020_SH010", scene: "SC020", ep: 1, title: "Signal room wide", status: "options_ready", stage: "production", versions: 4, assignee: "nina", due: 2 },
  { code: "SC020_SH020", scene: "SC020", ep: 1, title: "Meters spike", status: "in_review", stage: "production", versions: 2, assignee: "dara" },
  { code: "SC020_SH030", scene: "SC020", ep: 1, title: "Tape reel insert", status: "rework", stage: "production", versions: 2, assignee: "nina", due: 1 },
  { code: "SC030_SH010", scene: "SC030", ep: 1, title: "Rooftop establishing", status: "planned", stage: "previews", versions: 0 },
  { code: "SC030_SH020", scene: "SC030", ep: 1, title: "The jump", status: "planned", stage: "previews", versions: 0 },
  { code: "SC110_SH010", scene: "SC110", ep: 2, title: "Morning after, static on TV", status: "planned", stage: "previews", versions: 0 },
  { code: "SC110_SH020", scene: "SC110", ep: 2, title: "Kitchen conversation", status: "planned", stage: "previews", versions: 0 },
  { code: "SC120_SH010", scene: "SC120", ep: 2, title: "Server basement descent", status: "picked", stage: "production", versions: 2, picked: 1, assignee: "dara" },
  { code: "SC120_SH020", scene: "SC120", ep: 2, title: "Cable pull reveal", status: "planned", stage: "production", versions: 0 },
  { code: "SC130_SH010", scene: "SC130", ep: 2, title: "Broadcast tower finale", status: "planned", stage: "previews", versions: 0 },
];

const SCENES = [
  { code: "SC010", ep: 1, title: "Cold open — the array", figma: true },
  { code: "SC020", ep: 1, title: "Signal room", figma: true },
  { code: "SC030", ep: 1, title: "Rooftop chase", figma: false },
  { code: "SC110", ep: 2, title: "Morning after", figma: false },
  { code: "SC120", ep: 2, title: "Server basement", figma: true },
  { code: "SC130", ep: 2, title: "Broadcast tower", figma: false },
];

/** Dev/QA helper: add an extra pending invite to Aurora North. */
export const addQaInvite = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, args) => {
    const studio = await ctx.db
      .query("studios")
      .withIndex("by_slug", (q) => q.eq("slug", "aurora-north"))
      .unique();
    if (!studio) throw new Error("Seed first");
    const email = args.email.toLowerCase();
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_invited_email", (q) => q.eq("invitedEmail", email))
      .collect();
    if (existing.some((m) => m.studioId === studio._id)) return;
    await ctx.db.insert("memberships", {
      studioId: studio._id,
      role: args.role,
      craftTitle: "QA",
      invitedEmail: email,
    });
  },
});

export const alreadySeeded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const studio = await ctx.db
      .query("studios")
      .withIndex("by_slug", (q) => q.eq("slug", "aurora-north"))
      .unique();
    return studio !== null;
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (await ctx.runQuery(internal.seed.alreadySeeded, {})) {
      return "Already seeded — studio 'Aurora North' exists. Delete it (or reset the local deployment) to reseed.";
    }
    // Generate + store placeholder art for every seeded version, plus shot
    // covers, before the single insert mutation.
    const thumbs: { key: string; storageId: Id<"_storage">; bytes: number }[] = [];
    for (const shot of SHOTS) {
      for (let i = 1; i <= shot.versions; i++) {
        const svg = placeholderSvg(shot.code, i);
        const storageId = await ctx.storage.store(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        thumbs.push({ key: `${shot.code}_v${i}`, storageId, bytes: svg.length });
      }
    }
    await ctx.runMutation(internal.seed.insertAll, { thumbs });
    return "Seeded studio 'Aurora North' with production 'SIGNAL LOST' (SGL). Sign up with niek.tenhove@gmail.com (owner), director@demo.slate (creative director), producer@demo.slate or artist@demo.slate — any password — to claim a role.";
  },
});

export const insertAll = internalMutation({
  args: {
    thumbs: v.array(
      v.object({
        key: v.string(),
        storageId: v.id("_storage"),
        bytes: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const thumb = new Map(args.thumbs.map((t) => [t.key, t]));
    const now = Date.now();

    // People ---------------------------------------------------------------
    const users = new Map<string, Id<"users">>();
    for (const p of PEOPLE) {
      users.set(p.key, await ctx.db.insert("users", { name: p.name, email: p.email }));
    }
    const u = (key: string): Id<"users"> => users.get(key)!;

    const studioId = await ctx.db.insert("studios", {
      name: "Aurora North",
      slug: "aurora-north",
      createdBy: u("vera"),
    });
    for (const p of PEOPLE) {
      await ctx.db.insert("memberships", {
        studioId,
        userId: u(p.key),
        role: p.role,
        craftTitle: p.craft,
      });
    }
    for (const inv of INVITES) {
      await ctx.db.insert("memberships", {
        studioId,
        role: inv.role,
        craftTitle: inv.craft,
        invitedEmail: inv.email,
      });
    }

    // Production ------------------------------------------------------------
    const productionId = await ctx.db.insert("productions", {
      studioId,
      name: "SIGNAL LOST",
      code: "SGL",
      kind: "episodic",
      status: "active",
      timezone: "Europe/Zurich",
    });
    const episodeIds = new Map<number, Id<"episodes">>();
    for (const n of [1, 2]) {
      episodeIds.set(
        n,
        await ctx.db.insert("episodes", {
          productionId,
          number: n,
          title: n === 1 ? "The Array" : "Playback",
        }),
      );
    }

    // Stages: 1–2 done+approved, 3 active (gate requested), 4 active, 5–6 not started
    const stageIds = new Map<string, Id<"stageInstances">>();
    const stageRows = [
      { stage: "development", status: "done", gateStatus: "approved", by: "mara", note: "Locked script v3 — the parallel-timelines draft. This is the one.", approvers: ["mara"] },
      { stage: "preproduction", status: "done", gateStatus: "approved", by: "vera", note: "Storyboards and location kit approved; motion blueprints in Figma.", approvers: ["vera", "mara"] },
      { stage: "previews", status: "active", gateStatus: "requested", approvers: ["mara"] },
      { stage: "production", status: "active", gateStatus: "open", approvers: ["ilya"] },
      { stage: "post", status: "not_started", gateStatus: "open", approvers: ["sofia"] },
      { stage: "delivery", status: "not_started", gateStatus: "open", approvers: ["sofia", "vera"] },
    ] as const;
    for (const row of stageRows) {
      stageIds.set(
        row.stage,
        await ctx.db.insert("stageInstances", {
          productionId,
          stage: row.stage,
          status: row.status,
          gateApproverIds: row.approvers.map((a) => u(a)),
          gateStatus: row.gateStatus,
          ...("by" in row
            ? {
                gateDecidedBy: u(row.by),
                gateDecidedAt: now - 3 * 3600_000,
                gateNote: row.note,
              }
            : {}),
        }),
      );
    }

    // Scenes & shots ---------------------------------------------------------
    const sceneIds = new Map<string, Id<"scenes">>();
    for (let i = 0; i < SCENES.length; i++) {
      const s = SCENES[i];
      sceneIds.set(
        s.code,
        await ctx.db.insert("scenes", {
          productionId,
          episodeId: episodeIds.get(s.ep),
          code: s.code,
          title: s.title,
          order: i + 1,
          ...(s.figma
            ? { figmaUrl: `https://www.figma.com/file/demo-${s.code.toLowerCase()}/SGL-storyboards` }
            : {}),
        }),
      );
    }

    const activity: { actor: string; type: string; targetType: string; targetId: string; summary: string }[] = [];
    const name = (key: string) => PEOPLE.find((p) => p.key === key)!.name.split(" ")[0];

    activity.push({
      actor: "jonas", type: "production.created", targetType: "production", targetId: productionId,
      summary: "Jonas created production SIGNAL LOST (SGL)",
    });
    activity.push({
      actor: "mara", type: "gate.approved", targetType: "stage", targetId: stageIds.get("development")!,
      summary: "Mara approved the Development gate — “Locked script v3 — the parallel-timelines draft”",
    });
    activity.push({
      actor: "vera", type: "gate.approved", targetType: "stage", targetId: stageIds.get("preproduction")!,
      summary: "Vera approved the Pre-Production gate — “Storyboards and location kit approved”",
    });
    activity.push({
      actor: "jonas", type: "gate.requested", targetType: "stage", targetId: stageIds.get("previews")!,
      summary: "Jonas requested sign-off on Previews & Review from Mara",
    });
    activity.push({
      actor: "jonas", type: "stage.status_changed", targetType: "stage", targetId: stageIds.get("previews")!,
      summary: "Jonas set Previews & Review to active",
    });
    activity.push({
      actor: "jonas", type: "stage.status_changed", targetType: "stage", targetId: stageIds.get("production")!,
      summary: "Jonas set Production to active",
    });

    let shotOrder = 0;
    const shotIds = new Map<string, Id<"shots">>();
    for (const spec of SHOTS) {
      shotOrder += 1;
      const shotId = await ctx.db.insert("shots", {
        productionId,
        episodeId: episodeIds.get(spec.ep),
        sceneId: sceneIds.get(spec.scene),
        code: spec.code,
        title: spec.title,
        status: spec.status,
        stage: spec.stage,
        order: shotOrder,
        // Denormalised (schema.shots.versionsCount) — shots.list reads it
        // instead of counting versions, so the seeded demo would otherwise
        // show "0 options" on every card. The loop below inserts exactly
        // spec.versions of them.
        versionsCount: spec.versions,
        ...(spec.assignee ? { assigneeId: u(spec.assignee) } : {}),
        ...(spec.due !== undefined
          ? {
              dueDate: formatInTimeZone(
                new Date(now + spec.due * 86400_000),
                "Europe/Zurich",
                "yyyy-MM-dd",
              ),
            }
          : {}),
      });
      shotIds.set(spec.code, shotId);
      activity.push({
        actor: "jonas", type: "shot.created", targetType: "shot", targetId: shotId,
        summary: `Jonas created shot ${spec.code} — ${spec.title}`,
      });

      // Versions + assets
      let coverAssetId: Id<"assets"> | undefined;
      let pickedVersionId: Id<"versions"> | undefined;
      for (let i = 1; i <= spec.versions; i++) {
        const t = thumb.get(`${spec.code}_v${i}`)!;
        const creator = spec.assignee ?? "dara";
        const isPicked = spec.picked === i;
        const isRejected =
          spec.picked !== undefined && !isPicked
            ? true
            : spec.status === "rework" && i === 1;
        const assetId = await ctx.db.insert("assets", {
          productionId,
          shotId,
          provider: "storage",
          kind: "file",
          name: `SGL_EP0${spec.ep}_${spec.code}_v${i}.svg`,
          mimeType: "image/svg+xml",
          sizeBytes: t.bytes,
          storageId: t.storageId,
          thumbStorageId: t.storageId,
          uploadedBy: u(creator),
        });
        const versionId = await ctx.db.insert("versions", {
          shotId,
          productionId,
          index: i,
          status: isPicked ? "picked" : isRejected ? "rejected" : "candidate",
          primaryAssetId: assetId,
          createdBy: u(creator),
          promptMeta: {
            tool: "Midjourney",
            model: "v6.1",
            prompt: PROMPTS[(hash(spec.code) + i) % PROMPTS.length],
            seed: String(100000000 + (hash(`${spec.code}${i}`) % 899999999)),
          },
          ...(isPicked
            ? {
                decidedBy: u("mara"),
                decidedAt: now - 2 * 3600_000,
                decisionNote: "Best silhouette read; hands are correct here.",
              }
            : {}),
          ...(isRejected && spec.picked !== undefined
            ? {
                decidedBy: u("mara"),
                decidedAt: now - 2 * 3600_000,
                decisionNote: `superseded by v${spec.picked}`,
              }
            : {}),
          ...(isRejected && spec.picked === undefined
            ? {
                decidedBy: u("ilya"),
                decidedAt: now - 4 * 3600_000,
                decisionNote: "Perspective on the reel is off — redo the vanishing point.",
              }
            : {}),
        });
        await ctx.db.patch(assetId, { versionId });
        if (i === 1 || isPicked) coverAssetId = assetId;
        if (isPicked) pickedVersionId = versionId;
        activity.push({
          actor: creator, type: "version.added", targetType: "version", targetId: versionId,
          summary: `${name(creator)} added v${i} to ${spec.code}`,
        });
        if (isRejected)
          activity.push({
            actor: spec.picked !== undefined ? "mara" : "ilya",
            type: "version.rejected", targetType: "version", targetId: versionId,
            summary:
              spec.picked !== undefined
                ? `Mara rejected ${spec.code} v${i} — superseded by v${spec.picked}`
                : `Ilya rejected ${spec.code} v${i} — “redo the vanishing point”`,
          });
        if (isPicked) {
          activity.push({
            actor: "mara", type: "version.picked", targetType: "version", targetId: versionId,
            summary: `Mara picked v${i} for ${spec.code} — “Best silhouette read; hands are correct here.”`,
          });
          await ctx.db.insert("approvals", {
            productionId,
            scope: "version",
            targetId: versionId,
            requestedBy: u("mara"),
            approverId: u("mara"),
            status: "approved",
            decidedAt: now - 2 * 3600_000,
            note: "Best silhouette read; hands are correct here.",
          });
        }
      }
      if (coverAssetId || pickedVersionId) {
        await ctx.db.patch(shotId, {
          ...(coverAssetId ? { coverAssetId } : {}),
          ...(pickedVersionId ? { pickedVersionId } : {}),
        });
      }
      if (spec.status !== "planned")
        activity.push({
          actor: spec.assignee ?? "jonas",
          type: "shot.status_changed", targetType: "shot", targetId: shotId,
          summary: `${name(spec.assignee ?? "jonas")} moved ${spec.code} to ${spec.status.replace("_", " ")}`,
        });
    }

    // Gate approvals for decided gates + pending for Mara --------------------
    for (const key of ["development", "preproduction"] as const) {
      const row = stageRows.find((r) => r.stage === key)!;
      await ctx.db.insert("approvals", {
        productionId,
        scope: "stage_gate",
        targetId: stageIds.get(key)!,
        requestedBy: u("jonas"),
        approverId: u("by" in row ? row.by : "mara"),
        status: "approved",
        decidedAt: now - 3 * 3600_000,
        note: "note" in row ? row.note : undefined,
      });
    }
    // 2 pending approvals for the creative director (spec §12)
    await ctx.db.insert("approvals", {
      productionId,
      scope: "stage_gate",
      targetId: stageIds.get("previews")!,
      requestedBy: u("jonas"),
      approverId: u("mara"),
      status: "pending",
    });
    await ctx.db.insert("approvals", {
      productionId,
      scope: "shot",
      targetId: shotIds.get("SC010_SH010")!,
      requestedBy: u("ilya"),
      approverId: u("mara"),
      status: "pending",
      note: "Ready for final shot approval after color pass",
    });
    await ctx.db.insert("notifications", {
      userId: u("mara"),
      productionId,
      type: "approval_requested",
      title: "Jonas requested your sign-off on Previews & Review",
      href: `/p/${productionId}/board`,
    });
    await ctx.db.insert("notifications", {
      userId: u("mara"),
      productionId,
      type: "approval_requested",
      title: "Ilya requested shot approval for SC010_SH010",
      href: `/p/${productionId}/shots/${shotIds.get("SC010_SH010")}`,
    });

    // External links ---------------------------------------------------------
    const links = [
      { kind: "sheet", title: "Budget — SIGNAL LOST", url: "https://docs.google.com/spreadsheets/d/demo-sgl-budget" },
      { kind: "figma", title: "Storyboards (Figma)", url: "https://www.figma.com/file/demo-sgl/SGL-storyboards" },
      { kind: "miro", title: "Producer board (Miro)", url: "https://miro.com/app/board/demo-sgl" },
      { kind: "telegram", title: "Crew chat", url: "https://t.me/+signal-lost-crew" },
    ] as const;
    for (const l of links) {
      await ctx.db.insert("externalLinks", { productionId, ...l });
    }

    // Comments ---------------------------------------------------------------
    const sh020 = shotIds.get("SC010_SH020")!;
    const commentRows = [
      { actor: "mara", targetType: "shot", targetId: sh020, body: "Options 2 and 4 have the best dish silhouette. @Dara can you push one more with heavier fog?", mentions: ["dara"] },
      { actor: "dara", targetType: "shot", targetId: sh020, body: "On it — rerunning with the same seed and fog bumped.", mentions: [] },
      { actor: "ilya", targetType: "shot", targetId: sh020, body: "Watch the horizon tilt on v3 before anything gets picked.", mentions: [] },
      { actor: "nina", targetType: "shot", targetId: shotIds.get("SC020_SH030")!, body: "Reel label typography reads wrong for 1974 — swapping reference.", mentions: [] },
    ] as const;
    for (const c of commentRows) {
      await ctx.db.insert("comments", {
        productionId,
        targetType: c.targetType,
        targetId: c.targetId,
        authorId: u(c.actor),
        body: c.body,
        mentions: c.mentions.map((m) => u(m)),
      });
      activity.push({
        actor: c.actor, type: "comment.added", targetType: c.targetType, targetId: c.targetId,
        summary: `${name(c.actor)} commented: “${c.body.slice(0, 60)}${c.body.length > 60 ? "…" : ""}”`,
      });
    }
    await ctx.db.insert("notifications", {
      userId: u("dara"),
      productionId,
      type: "mention",
      title: "Mara mentioned you",
      body: "Options 2 and 4 have the best dish silhouette…",
      href: `/p/${productionId}/shots/${sh020}`,
    });

    // Activity (all "today") -------------------------------------------------
    for (const a of activity) {
      await ctx.db.insert("activity", {
        productionId,
        actorId: u(a.actor),
        type: a.type,
        targetType: a.targetType,
        targetId: a.targetId,
        summary: a.summary,
      });
    }

    // Yesterday's report (stats fabricated; _creationTime can't be backdated)
    const yesterday = formatInTimeZone(
      new Date(now - 86400_000),
      "Europe/Zurich",
      "yyyy-MM-dd",
    );
    await ctx.db.insert("dailyReports", {
      productionId,
      date: yesterday,
      stats: { versionsAdded: 9, picks: 1, rejections: 3, shotsMoved: 6, commentsAdded: 5, gatesDecided: 1 },
      highlights: [
        "Mara picked v2 for SC010_SH010 — “cleanest first-light framing”",
        "Vera approved the Pre-Production gate",
        "Dara added 4 options to SC020_SH010",
        "Ilya rejected SC020_SH030 v1 — perspective redo",
        "Jonas created 6 shots for EP02",
      ],
      generatedAt: now - 20 * 3600_000,
    });

    // QC template (studio-level, spec §12) -----------------------------------
    let order = 0;
    for (const p of DEFAULT_TEMPLATE) {
      order += 1;
      await ctx.db.insert("qcParameters", {
        studioId,
        category: p.category,
        name: p.name,
        spec: p.spec,
        ...(p.tolerance !== undefined ? { tolerance: p.tolerance } : {}),
        required: p.required !== false,
        order,
      });
    }
  },
});
