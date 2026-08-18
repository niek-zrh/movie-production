"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";
import { KinolabMark, KinolabWordmark } from "@/components/app/kinolab-mark";

/**
 * Convex Auth stores the access token in localStorage under a key namespaced
 * by the deployment URL (hence the prefix match) — and it stores it BEFORE the
 * router-cache invalidation and the redirect run. A token that appeared during
 * a submit therefore means the credentials were accepted.
 */
function storedAuthToken(): string | null {
  try {
    const key = Object.keys(window.localStorage).find((k) =>
      k.startsWith("__convexAuthJWT"),
    );
    return key === undefined ? null : window.localStorage.getItem(key);
  } catch {
    // Storage can be blocked outright (private mode, third-party cookie rules).
    return null;
  }
}

/**
 * Only the Convex action rejects credentials: /api/auth answers 4xx and the
 * client rethrows the action's message. A broken transport looks completely
 * different — fetch() rejects with a TypeError ("Failed to fetch",
 * "NetworkError…", Safari's "Load failed"), or a proxy answers with an HTML
 * error page that can't be parsed as JSON (SyntaxError).
 */
function isTransportError(err: unknown): boolean {
  if (err instanceof TypeError || err instanceof SyntaxError) return true;
  const message = err instanceof Error ? err.message : "";
  return /Failed to fetch|NetworkError|Load failed|Network request failed|ERR_[A-Z_]+/i.test(
    message,
  );
}

/**
 * Sign-in can fail in three places and each one needs its own answer. Telling
 * everyone "wrong email or password" sent the studio hunting for password
 * problems that did not exist — the whole proxy/redirect chain (Cloudflare →
 * Traefik → Next) can fail long after the password was accepted.
 */
function failureMessage(
  err: unknown,
  flow: "signIn" | "signUp",
  hadAuthToken: boolean,
): string {
  const message = err instanceof Error ? err.message : "";
  // App-authored ConvexError messages (e.g. invite-only sign-ups) beat the
  // generic copy.
  const server = /ConvexError:\s*([^\n]+?)(?:\s+at\s.*)?$/m
    .exec(message)?.[1]
    ?.trim();
  if (server && server.length <= 200) return server;
  // The token landed during this submit: the account is fine and the auth
  // cookies are set — only the post-auth hop failed. Never call this a
  // password problem.
  if (!hadAuthToken && storedAuthToken() !== null) {
    return "Signed in — but the app didn't open. Reload this page to continue.";
  }
  // Never reached the backend: the fetch rejected, a proxy answered with
  // Never reached the backend: the fetch rejected, or a proxy answered with
  // something that isn't JSON.
  if (isTransportError(err)) {
    return "Could not reach the server. Check your connection and try again — your password is fine.";
  }
  if (message.includes("TooManyFailedAttempts")) {
    return "Too many failed sign-in attempts. Wait a minute, then try again.";
  }
  return flow === "signIn"
    ? "Wrong email or password. New here? Switch to create account."
    : "Could not create the account. An account with this email may already exist — try signing in. Passwords need at least 8 characters.";
}

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const providers = useQuery(api.users.authProviders);
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const formData = new FormData(e.currentTarget);
    formData.set("flow", flow);
    // The credentials account is keyed by the email exactly as submitted —
    // normalize so "Niek@…" at sign-up and "niek@…" at sign-in can't diverge.
    const email = formData.get("email");
    if (typeof email === "string") {
      formData.set("email", email.trim().toLowerCase());
    }
    // Read before the attempt so a token appearing during it is proof that
    // authentication succeeded (see failureMessage).
    const hadAuthToken = storedAuthToken() !== null;
    try {
      // No client-side timeout here on purpose: a slow-but-successful sign-in
      // (cold server, bad hotel wifi) would abort into an error while the
      // account was in fact created — the exact confusion this screen is
      // being fixed for. The button's busy state carries the wait instead.
      await signIn("password", formData);
      // Full navigation (not router.push): the fresh auth cookie must be
      // visible to the middleware, which an immediate RSC navigation can race.
      window.location.assign("/");
    } catch (err) {
      setError(failureMessage(err, flow, hadAuthToken));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <KinolabMark className="size-10 shrink-0" />
          <div>
            <h1 className="text-xl">
              <KinolabWordmark />
            </h1>
            <p className="text-xs text-muted-foreground">{copy.tagline}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {flow === "signUp" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Ada Lovelace" required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@studio.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                flow === "signIn" ? "current-password" : "new-password"
              }
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {flow === "signIn" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {providers?.google && (
          <Button
            variant="outline"
            className="mt-3 w-full"
            onClick={() => void signIn("google", { redirectTo: "/" })}
          >
            Continue with Google
          </Button>
        )}

        <button
          type="button"
          className="mt-6 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setFlow(flow === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
        >
          {flow === "signIn"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
