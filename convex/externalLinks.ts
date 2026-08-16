import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  assertCanForProduction,
  assertMemberForProduction,
} from "./lib/permissions";

const linkKind = v.union(
  v.literal("figma"),
  v.literal("sheet"),
  v.literal("miro"),
  v.literal("telegram"),
  v.literal("other"),
);

/** Validate an http(s) URL; returns the trimmed string. */
function validHttpUrl(raw: string): string {
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Only http(s) links are allowed");
  return url;
}

// Note: no activity rows in this module — links are production config, not
// state (documented exception in CONTRACTS.md).

export const list = query({
  args: { productionId: v.id("productions") },
  handler: async (ctx, args) => {
    await assertMemberForProduction(ctx, args.productionId);
    return await ctx.db
      .query("externalLinks")
      .withIndex("by_production", (q) =>
        q.eq("productionId", args.productionId),
      )
      .collect();
  },
});

export const add = mutation({
  args: {
    productionId: v.id("productions"),
    kind: linkKind,
    title: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await assertCanForProduction(ctx, args.productionId, "production.manage");
    const title = args.title.trim();
    if (title.length === 0) throw new Error("Give the link a title");
    const url = validHttpUrl(args.url);
    return await ctx.db.insert("externalLinks", {
      productionId: args.productionId,
      kind: args.kind,
      title,
      url,
    });
  },
});

export const update = mutation({
  args: {
    linkId: v.id("externalLinks"),
    title: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) throw new Error("Link not found");
    await assertCanForProduction(ctx, link.productionId, "production.manage");

    let title: string | undefined;
    if (args.title !== undefined) {
      title = args.title.trim();
      if (title.length === 0) throw new Error("Give the link a title");
    }
    const url = args.url !== undefined ? validHttpUrl(args.url) : undefined;

    await ctx.db.patch(args.linkId, {
      ...(title !== undefined ? { title } : {}),
      ...(url !== undefined ? { url } : {}),
    });
  },
});

export const remove = mutation({
  args: { linkId: v.id("externalLinks") },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.linkId);
    if (!link) return; // already gone
    await assertCanForProduction(ctx, link.productionId, "production.manage");
    await ctx.db.delete(args.linkId);
  },
});
