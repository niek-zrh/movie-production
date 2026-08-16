import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Which sign-in methods are configured on this deployment. */
export const authProviders = query({
  args: {},
  handler: async () => ({
    google: Boolean(process.env.AUTH_GOOGLE_ID),
    password: true,
  }),
});

/** Current user + their memberships (drives the studio switcher and shell). */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const studios = (
      await Promise.all(memberships.map((m) => ctx.db.get(m.studioId)))
    ).flatMap((s) => (s ? [s] : []));
    return {
      _id: user._id,
      name: user.name ?? user.email ?? "Unknown",
      email: user.email,
      image: user.image,
      memberships: memberships.map((m) => ({
        _id: m._id,
        studioId: m.studioId,
        role: m.role,
        craftTitle: m.craftTitle,
      })),
      studios: studios.map((s) => ({ _id: s._id, name: s.name, slug: s.slug })),
    };
  },
});
