"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";
import { Clapperboard } from "lucide-react";

/** First user creates the studio; everyone else arrives via invite (F1). */
export function CreateStudio() {
  const create = useMutation(api.studios.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Clapperboard className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">
              Welcome to {copy.appName}
            </h1>
            <p className="text-xs text-muted-foreground">
              Name your studio to get started. Expecting an invite? Ask your
              producer to invite this email, then sign in again.
            </p>
          </div>
        </div>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await create({ name });
            } catch {
              setError("Could not create the studio — try a longer name.");
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="studio-name">Studio name</Label>
            <Input
              id="studio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Aurora North"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
            Create studio
          </Button>
        </form>
      </div>
    </main>
  );
}
