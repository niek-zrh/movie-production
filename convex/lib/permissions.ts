import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Role =
  | "owner"
  | "producer"
  | "creative_director"
  | "supervisor"
  | "artist"
  | "viewer";

/**
 * Capability map per spec §3. Special cases (supervisor scoped to assigned
 * stages, artist scoped to own shots) are handled by the dedicated helpers
 * below — never by widening these lists.
 */
export type Capability =
  | "studio.manage" // members, invites, studio settings, QC template
  | "production.manage" // create/configure productions, hub connect, links
  | "content.edit" // shots/scenes/episodes edits, board moves
  | "version.create" // upload/add options
  | "version.decide" // shortlist/reject/pick (see canDecideForShot)
  | "gate.decide" // approve/reject stage gates (see canDecideGate)
  | "qc.run"
  | "report.publish"
  | "comment.create";

const ROLE_CAPS: Record<Role, Capability[]> = {
  owner: [
    "studio.manage",
    "production.manage",
    "content.edit",
    "version.create",
    "version.decide",
    "gate.decide",
    "qc.run",
    "report.publish",
    "comment.create",
  ],
  producer: [
    "studio.manage",
    "production.manage",
    "content.edit",
    "version.create",
    "version.decide",
    "gate.decide",
    "qc.run",
    "report.publish",
    "comment.create",
  ],
  creative_director: [
    "content.edit",
    "version.create",
    "version.decide",
    "gate.decide",
    "qc.run",
    "comment.create",
  ],
  supervisor: [
    "content.edit",
    "version.create",
    "qc.run",
    "comment.create",
    // version.decide / gate.decide only within assigned stages — see helpers
  ],
  artist: [
    "version.create",
    "comment.create",
    // content.edit only on own shots — see canEditShot
  ],
  viewer: ["comment.create"],
};

// Extends ConvexError so the message survives production redaction (plain
// Error messages become "Server Error"; ConvexError data reaches the client).
export class PermissionError extends ConvexError<string> {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new PermissionError("Not signed in");
  return userId;
}

export async function getMembership(
  ctx: QueryCtx | MutationCtx,
  studioId: Id<"studios">,
  userId: Id<"users">,
): Promise<Doc<"memberships"> | null> {
  return await ctx.db
    .query("memberships")
    .withIndex("by_studio_user", (q) =>
      q.eq("studioId", studioId).eq("userId", userId),
    )
    .unique();
}

export function roleHas(role: Role, capability: Capability): boolean {
  return ROLE_CAPS[role].includes(capability);
}

/**
 * The single permission gate. Every mutation calls this (or a scoped helper
 * that calls it) before touching the database. Returns the membership so
 * callers can apply scoped rules on top.
 */
export async function assertCan(
  ctx: QueryCtx | MutationCtx,
  studioId: Id<"studios">,
  capability: Capability,
): Promise<{ userId: Id<"users">; member: Doc<"memberships"> }> {
  const userId = await requireUserId(ctx);
  const member = await getMembership(ctx, studioId, userId);
  if (!member) throw new PermissionError("Not a member of this studio");
  if (!roleHas(member.role as Role, capability)) {
    throw new PermissionError(
      `Your role (${member.role}) cannot do this (${capability})`,
    );
  }
  return { userId, member };
}

/** Membership check only — for queries (viewer can read everything). */
export async function assertMember(
  ctx: QueryCtx | MutationCtx,
  studioId: Id<"studios">,
): Promise<{ userId: Id<"users">; member: Doc<"memberships"> }> {
  const userId = await requireUserId(ctx);
  const member = await getMembership(ctx, studioId, userId);
  if (!member) throw new PermissionError("Not a member of this studio");
  return { userId, member };
}

/** Resolve a production and assert studio membership in one step. */
export async function assertMemberForProduction(
  ctx: QueryCtx | MutationCtx,
  productionId: Id<"productions">,
) {
  const production = await ctx.db.get(productionId);
  if (!production) throw new PermissionError("Production not found");
  const { userId, member } = await assertMember(ctx, production.studioId);
  return { userId, member, production };
}

export async function assertCanForProduction(
  ctx: QueryCtx | MutationCtx,
  productionId: Id<"productions">,
  capability: Capability,
) {
  const production = await ctx.db.get(productionId);
  if (!production) throw new PermissionError("Production not found");
  const { userId, member } = await assertCan(
    ctx,
    production.studioId,
    capability,
  );
  return { userId, member, production };
}

/**
 * Spec §6 invariant: a gate decision requires the decider to be listed in
 * gateApproverIds, or to hold producer/owner/creative_director.
 */
export function canDecideGate(
  member: Doc<"memberships">,
  stageInstance: Doc<"stageInstances">,
  userId: Id<"users">,
): boolean {
  const role = member.role as Role;
  if (role === "owner" || role === "producer" || role === "creative_director")
    return true;
  return stageInstance.gateApproverIds.includes(userId);
}

/**
 * Version decisions (shortlist/reject/pick): owner/producer/creative_director
 * anywhere; supervisor within stages they are a gate approver of, or on shots
 * assigned to them (spec §3 "within assigned stages").
 */
export async function canDecideForShot(
  ctx: QueryCtx | MutationCtx,
  member: Doc<"memberships">,
  shot: Doc<"shots">,
  userId: Id<"users">,
): Promise<boolean> {
  const role = member.role as Role;
  if (roleHas(role, "version.decide")) return true;
  if (role !== "supervisor") return false;
  if (shot.assigneeId === userId) return true;
  const stageInstance = await ctx.db
    .query("stageInstances")
    .withIndex("by_production", (q) => q.eq("productionId", shot.productionId))
    .filter((q) => q.eq(q.field("stage"), shot.stage))
    .unique();
  return stageInstance
    ? stageInstance.gateApproverIds.includes(userId)
    : false;
}

/** Working statuses an artist may move their own shots between (spec §3). */
const ARTIST_STATUSES = [
  "planned",
  "generating",
  "options_ready",
  "in_review",
  "rework",
];

export function canEditShot(
  member: Doc<"memberships">,
  shot: Doc<"shots">,
  userId: Id<"users">,
  nextStatus?: string,
): boolean {
  const role = member.role as Role;
  if (roleHas(role, "content.edit")) return true;
  if (role !== "artist") return false;
  if (shot.assigneeId !== userId) return false;
  if (nextStatus === undefined) return true;
  return (
    ARTIST_STATUSES.includes(shot.status) &&
    ARTIST_STATUSES.includes(nextStatus)
  );
}
