import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { role } from "./schema";
import {
  assertCan,
  assertMember,
  canAssignRole,
  PermissionError,
  requireUserId,
} from "./lib/permissions";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Claim pending invites for a user (membership rows carrying invitedEmail).
 * Called from the auth afterUserCreatedOrUpdated callback, so joining is
 * automatic on first sign-in with a matching email (spec F1).
 */
export async function claimInvitesForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  const email = user?.email?.toLowerCase();
  if (!email) return;
  const invites = await ctx.db
    .query("memberships")
    .withIndex("by_invited_email", (q) => q.eq("invitedEmail", email))
    .collect();
  for (const invite of invites) {
    if (invite.userId !== undefined) continue; // already claimed
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_studio_user", (q) =>
        q.eq("studioId", invite.studioId).eq("userId", userId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(invite._id);
    } else {
      await ctx.db.patch(invite._id, { userId });
    }
  }
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Studio name is too short");
    let slug = slugify(name);
    const clash = await ctx.db
      .query("studios")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (clash) slug = `${slug}-${Math.floor(Date.now() % 10000)}`;
    const studioId = await ctx.db.insert("studios", {
      name,
      slug,
      createdBy: userId,
    });
    await ctx.db.insert("memberships", {
      studioId,
      userId,
      role: "owner",
    });
    return studioId;
  },
});

export const get = query({
  args: { studioId: v.id("studios") },
  handler: async (ctx, args) => {
    await assertMember(ctx, args.studioId);
    return await ctx.db.get(args.studioId);
  },
});

export const team = query({
  args: { studioId: v.id("studios") },
  handler: async (ctx, args) => {
    await assertMember(ctx, args.studioId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_studio", (q) => q.eq("studioId", args.studioId))
      .collect();
    return await Promise.all(
      memberships.map(async (m) => {
        const user = m.userId ? await ctx.db.get(m.userId) : null;
        return {
          _id: m._id,
          userId: m.userId,
          role: m.role,
          craftTitle: m.craftTitle,
          invitedEmail: m.invitedEmail,
          pending: m.userId === undefined,
          name: user?.name ?? m.invitedEmail ?? "Invited",
          email: user?.email ?? m.invitedEmail,
          image: user?.image,
        };
      }),
    );
  },
});

export const invite = mutation({
  args: {
    studioId: v.id("studios"),
    email: v.string(),
    role,
    craftTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { member } = await assertCan(ctx, args.studioId, "studio.manage");
    // Same rank rule as updateMember: the Team UI hides "Owner" for non-owners,
    // but the mutation is the real boundary — otherwise a producer invites a
    // second owner (or claims the invite themselves) and takes the studio over.
    if (!canAssignRole(member.role, args.role))
      throw new PermissionError(
        "You can't invite someone at a role higher than your own",
      );
    const email = args.email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw new ConvexError("That doesn't look like an email address");
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_invited_email", (q) => q.eq("invitedEmail", email))
      .collect();
    if (existing.some((m) => m.studioId === args.studioId))
      throw new ConvexError("Already invited");
    await ctx.db.insert("memberships", {
      studioId: args.studioId,
      role: args.role,
      craftTitle: args.craftTitle,
      invitedEmail: email,
    });
  },
});

export const updateMember = mutation({
  args: {
    membershipId: v.id("memberships"),
    role: v.optional(role),
    craftTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) throw new ConvexError("Member not found");
    const { userId, member } = await assertCan(
      ctx,
      membership.studioId,
      "studio.manage",
    );
    if (args.role !== undefined) {
      // Self-promotion is never legitimate, and it was the takeover path:
      // a producer holds studio.manage, so nothing else stopped them setting
      // their own row to owner and then demoting the founder.
      if (membership.userId === userId)
        throw new PermissionError("You can't change your own role");
      // Nobody hands out a role above their own rank (spec §3 ladder).
      if (!canAssignRole(member.role, args.role))
        throw new PermissionError(
          "You can't give someone a role higher than your own",
        );
      // Only owners can change an owner's role, and the last owner is immovable.
      if (membership.role === "owner") {
        if (member.role !== "owner")
          throw new PermissionError("Only an owner can change an owner's role");
        if (args.role !== "owner") {
          const owners = (
            await ctx.db
              .query("memberships")
              .withIndex("by_studio", (q) =>
                q.eq("studioId", membership.studioId),
              )
              .collect()
          ).filter((m) => m.role === "owner" && m.userId !== undefined);
          if (owners.length <= 1)
            throw new ConvexError("A studio needs at least one owner");
        }
      }
    }
    await ctx.db.patch(args.membershipId, {
      ...(args.role !== undefined ? { role: args.role } : {}),
      ...(args.craftTitle !== undefined
        ? { craftTitle: args.craftTitle }
        : {}),
    });
  },
});

export const removeMember = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) return;
    const { userId, member } = await assertCan(
      ctx,
      membership.studioId,
      "studio.manage",
    );
    if (membership.userId === userId)
      throw new ConvexError("You can't remove yourself");
    // Same rank rule as updateMember — a producer must not be able to delete
    // the owner's membership (pending owner invites included).
    if (!canAssignRole(member.role, membership.role))
      throw new PermissionError(
        "You can't remove someone with a role higher than your own",
      );
    if (membership.role === "owner" && membership.userId !== undefined)
      throw new ConvexError("Transfer ownership before removing an owner");
    await ctx.db.delete(args.membershipId);
    if (membership.userId !== undefined)
      await releaseAssignments(ctx, membership.studioId, membership.userId);
  },
});

/**
 * Offboarding cleanup. A removed member keeps blocking work if we leave them
 * behind: they stay in stageInstances.gateApproverIds (the gate then waits on
 * someone who can no longer open the studio) and stay on shots as assignee
 * (the board shows a person who is gone). Attribution — versions, comments,
 * approvals, activity — is deliberately left untouched; history is immutable.
 * Bounded to one studio: its productions, their stages, and the user's shots
 * via by_assignee.
 */
async function releaseAssignments(
  ctx: MutationCtx,
  studioId: Id<"studios">,
  userId: Id<"users">,
): Promise<void> {
  const productions = await ctx.db
    .query("productions")
    .withIndex("by_studio", (q) => q.eq("studioId", studioId))
    .collect();
  for (const production of productions) {
    const stageInstances = await ctx.db
      .query("stageInstances")
      .withIndex("by_production", (q) => q.eq("productionId", production._id))
      .collect();
    for (const stageInstance of stageInstances) {
      if (!stageInstance.gateApproverIds.includes(userId)) continue;
      await ctx.db.patch(stageInstance._id, {
        gateApproverIds: stageInstance.gateApproverIds.filter(
          (id) => id !== userId,
        ),
      });
    }
  }
  // by_assignee spans every studio, so keep only this studio's productions.
  const productionIds = new Set(productions.map((p) => p._id));
  const assigned = await ctx.db
    .query("shots")
    .withIndex("by_assignee", (q) => q.eq("assigneeId", userId))
    .collect();
  for (const shot of assigned) {
    if (!productionIds.has(shot.productionId)) continue;
    await ctx.db.patch(shot._id, { assigneeId: undefined });
  }
}
