import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { claimInvitesForUser } from "./studios";

/**
 * Sign-in identity only (openid email profile). The Drive connection is a
 * separate OAuth flow (convex/drive.ts + convex/http.ts) per spec §7.2.
 *
 * The Password provider is the dev/pilot fallback so the app is usable before
 * the studio's GCP OAuth client exists. Google activates automatically once
 * AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are set on the deployment.
 */
const password = Password({
  profile(params) {
    const email = (params.email as string).toLowerCase().trim();
    return {
      email,
      name: (params.name as string | undefined) || email.split("@")[0],
    };
  },
});

/**
 * Invite-only sign-up (enforced when INVITE_ONLY_SIGNUPS=1 on the
 * deployment — set on the pilot, unset for local dev/tests). New accounts
 * are allowed only when:
 *  - the email has a pending studio invite (the normal onboarding path), or
 *  - the email is on ADMIN_SIGNUP_ALLOWLIST (comma-separated, for
 *    bootstrapping owners), or
 *  - no users exist yet (first boot of a fresh backend).
 * Existing users always sign in normally.
 */
async function signupAllowed(
  ctx: MutationCtx,
  email: string | undefined,
): Promise<boolean> {
  if (process.env.INVITE_ONLY_SIGNUPS !== "1") return true;
  if (!email) return false;
  const allowlist = (process.env.ADMIN_SIGNUP_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.includes(email)) return true;
  const invite = await ctx.db
    .query("memberships")
    .withIndex("by_invited_email", (q) => q.eq("invitedEmail", email))
    .first();
  if (invite !== null) return true;
  const anyUser = await ctx.db.query("users").first();
  return anyUser === null;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: process.env.AUTH_GOOGLE_ID ? [password, Google] : [password],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.existingUserId !== null) return args.existingUserId;
      const profile = args.profile as {
        email?: string;
        name?: string;
        image?: string;
      };
      const email = profile.email?.toLowerCase().trim();
      if (!(await signupAllowed(ctx, email))) {
        throw new ConvexError(
          "Sign-ups are invite-only — ask your producer to invite this email.",
        );
      }
      return await ctx.db.insert("users", {
        ...(email !== undefined ? { email } : {}),
        ...(profile.name !== undefined ? { name: profile.name } : {}),
        ...(profile.image !== undefined ? { image: profile.image } : {}),
      });
    },
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      // Invites are membership rows carrying invitedEmail; claim them on
      // every sign-in so joining a studio is automatic (spec F1).
      await claimInvitesForUser(ctx, userId);
    },
  },
});
