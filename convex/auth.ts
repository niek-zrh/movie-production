import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: process.env.AUTH_GOOGLE_ID ? [password, Google] : [password],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      // Invites are membership rows carrying invitedEmail; claim them on
      // every sign-in so joining a studio is automatic (spec F1).
      await claimInvitesForUser(ctx, userId);
    },
  },
});
