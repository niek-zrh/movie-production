/**
 * Domain vocabulary (spec §2). Values only — imported by both Convex
 * functions and client components, so keep this file free of server imports.
 */

export type StageKey =
  | "development"
  | "preproduction"
  | "previews"
  | "production"
  | "post"
  | "delivery";

export type ShotStatusKey =
  | "planned"
  | "generating"
  | "options_ready"
  | "in_review"
  | "picked"
  | "approved"
  | "rework"
  | "final"
  | "delivered"
  | "killed";

export type RoleKey =
  | "owner"
  | "producer"
  | "creative_director"
  | "supervisor"
  | "artist"
  | "viewer";

export const STAGES: {
  key: StageKey;
  label: string;
  short: string;
  order: number;
  typicalGateOwner: string;
}[] = [
  {
    key: "development",
    label: "Development",
    short: "Dev",
    order: 1,
    typicalGateOwner: "Creative Director / Story Lead",
  },
  {
    key: "preproduction",
    label: "Pre-Production",
    short: "Pre-Pro",
    order: 2,
    typicalGateOwner: "Production Designer / Creative Director",
  },
  {
    key: "previews",
    label: "Previews & Review",
    short: "Previews",
    order: 3,
    typicalGateOwner: "Showrunner / Creative Director",
  },
  {
    key: "production",
    label: "Production",
    short: "Production",
    order: 4,
    typicalGateOwner: "Director",
  },
  {
    key: "post",
    label: "Post-Production",
    short: "Post",
    order: 5,
    typicalGateOwner: "Post-Production Supervisor",
  },
  {
    key: "delivery",
    label: "Final Edit & Delivery",
    short: "Delivery",
    order: 6,
    typicalGateOwner: "Lead Editor / Delivery Engineer",
  },
];

export const STAGE_BY_KEY = Object.fromEntries(
  STAGES.map((s) => [s.key, s]),
) as Record<StageKey, (typeof STAGES)[number]>;

export const SHOT_STATUSES: { key: ShotStatusKey; label: string }[] = [
  { key: "planned", label: "Planned" },
  { key: "generating", label: "Generating" },
  { key: "options_ready", label: "Options ready" },
  { key: "in_review", label: "In review" },
  { key: "picked", label: "Picked" },
  { key: "approved", label: "Approved" },
  { key: "rework", label: "Rework" },
  { key: "final", label: "Final" },
  { key: "delivered", label: "Delivered" },
  { key: "killed", label: "Killed" },
];

export const SHOT_STATUS_BY_KEY = Object.fromEntries(
  SHOT_STATUSES.map((s) => [s.key, s]),
) as Record<ShotStatusKey, (typeof SHOT_STATUSES)[number]>;

export const ROLES: { key: RoleKey; label: string; blurb: string }[] = [
  { key: "owner", label: "Owner", blurb: "Everything, incl. studio settings" },
  {
    key: "producer",
    label: "Producer",
    blurb: "Configure productions, manage members, approve anything",
  },
  {
    key: "creative_director",
    label: "Creative Director",
    blurb: "Approve gates and picks anywhere",
  },
  {
    key: "supervisor",
    label: "Supervisor",
    blurb: "Approve within assigned stages, run QC",
  },
  {
    key: "artist",
    label: "Artist",
    blurb: "Create versions, comment, move own shots",
  },
  { key: "viewer", label: "Viewer", blurb: "Read-only + comment" },
];

/** Statuses an artist may move their own shots between. */
export const WORKING_STATUSES: ShotStatusKey[] = [
  "planned",
  "generating",
  "options_ready",
  "in_review",
  "rework",
];

/** Canonical approved filename (spec §7.4): SGL_EP01_SC010_SH020_v3.png */
export function canonicalApprovedName(args: {
  productionCode: string;
  episodeNumber?: number;
  shotCode: string;
  versionIndex: number;
  extension: string;
}): string {
  const ep =
    args.episodeNumber !== undefined
      ? `EP${String(args.episodeNumber).padStart(2, "0")}_`
      : "";
  const ext = args.extension.replace(/^\./, "");
  return `${args.productionCode}_${ep}${args.shotCode}_v${args.versionIndex}.${ext}`;
}

export const HUB_FOLDERS: { key: string; path: string[] }[] = [
  { key: "admin", path: ["00 Admin"] },
  { key: "development", path: ["01 Development"] },
  { key: "development.coreScript", path: ["01 Development", "Core Script"] },
  {
    key: "development.scriptOptions",
    path: ["01 Development", "Script Options"],
  },
  { key: "preproduction", path: ["02 Pre-Production"] },
  { key: "preproduction.concepts", path: ["02 Pre-Production", "Concepts"] },
  { key: "preproduction.locations", path: ["02 Pre-Production", "Locations"] },
  { key: "previews", path: ["03 Previews"] },
  { key: "previews.options", path: ["03 Previews", "Preview Options"] },
  { key: "production", path: ["04 Production"] },
  { key: "production.shots", path: ["04 Production", "Shots"] },
  { key: "post", path: ["05 Post"] },
  { key: "post.sound", path: ["05 Post", "Sound"] },
  { key: "post.vfx", path: ["05 Post", "VFX"] },
  { key: "delivery", path: ["06 Delivery"] },
  { key: "delivery.masters", path: ["06 Delivery", "Masters"] },
  { key: "delivery.qc", path: ["06 Delivery", "QC"] },
];
