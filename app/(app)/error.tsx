"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Layers, Link2Off, Lock, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

/**
 * Error boundary for the app shell (spec §9.3: a failure is still a screen you
 * can act on). Convex's useQuery re-throws server errors during render, so any
 * permission / validator / read-limit failure would otherwise unmount the whole
 * tree ("Application error: a client-side exception has occurred").
 *
 * It renders INSIDE app/(app)/layout.tsx, so the topbar, studio switcher and
 * search survive and the user can navigate out. Failures in the layout itself
 * (the AppShell viewer query) sit above this boundary and fall through to
 * app/global-error.tsx.
 */

type Reason = "permission" | "missing" | "tooLarge" | "unknown";

/**
 * The thrown value is all we have, so classify by message text — the same way
 * the rest of the app reads Convex errors (reports/_components/mutation-error).
 * Order matters: "Production not found" is a PermissionError but reads as a
 * dead link to the user, so the missing-link test runs on its own wording.
 */
function classify(message: string): Reason {
  if (/Too many (?:reads|bytes|documents)/i.test(message)) return "tooLarge";
  if (/ArgumentValidationError|does not match validator|not found/i.test(message))
    return "missing";
  if (/Not a member|Not signed in|cannot do this|PermissionError/i.test(message))
    return "permission";
  return "unknown";
}

const REASONS: Record<
  Reason,
  { icon: ReactNode; title: string; hint: string }
> = {
  permission: {
    icon: <Lock />,
    title: "You don't have access to this production.",
    hint: "Ask a producer in the studio to invite you, then open it again.",
  },
  missing: {
    icon: <Link2Off />,
    title: "This link points at something that no longer exists.",
    hint: "It was deleted, or the address is mistyped. Pick it up again from your productions.",
  },
  tooLarge: {
    icon: <Layers />,
    title: "This production has grown too large to list in one go.",
    hint: "The server hit its read limit building this view. Open a smaller view (a single stage or episode), or contact support to have this production split.",
  },
  unknown: {
    icon: <TriangleAlert />,
    title: "Something went wrong loading this view.",
    hint: "The page stopped before it finished. Try again — if it keeps happening, tell support what you were opening.",
  },
};

/** The human line inside a Convex message, shown only as small print. */
function detailLine(message: string): string {
  const uncaught = /Uncaught (?:[A-Za-z]*Error|ConvexError): ([^\n]+)/.exec(
    message,
  );
  if (uncaught && uncaught[1].trim()) return uncaught[1].trim();
  const first = message.split("\n")[0] ?? "";
  return first.replace(/^(\[[^\]]*\]\s*)+/, "").trim();
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { icon, title, hint } = REASONS[classify(error.message)];
  const detail = detailLine(error.message);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <EmptyState icon={icon} title={title}>
        <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to productions
          </Link>
        </div>
        {detail && (
          <p className="max-w-md font-mono text-[11px] leading-tight text-muted-foreground">
            {detail}
          </p>
        )}
      </EmptyState>
    </main>
  );
}
