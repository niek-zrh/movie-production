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
    try {
      // The auth action can hang instead of rejecting (e.g. signing up with
      // an email that already has an account) — don't leave the form stuck.
      await Promise.race([
        signIn("password", formData),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 15_000),
        ),
      ]);
      // Full navigation (not router.push): the fresh auth cookie must be
      // visible to the middleware, which an immediate RSC navigation can race.
      window.location.assign("/");
    } catch (err) {
      // App-authored ConvexError messages (e.g. invite-only sign-ups) beat
      // the generic copy.
      const message = err instanceof Error ? err.message : "";
      const server = /ConvexError:\s*([^\n]+?)(?:\s+at\s.*)?$/m
        .exec(message)?.[1]
        ?.trim();
      setError(
        server && server.length <= 200
          ? server
          : flow === "signIn"
            ? "Wrong email or password. New here? Switch to create account."
            : "Could not create the account. An account with this email may already exist — try signing in. Passwords need at least 8 characters.",
      );
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
