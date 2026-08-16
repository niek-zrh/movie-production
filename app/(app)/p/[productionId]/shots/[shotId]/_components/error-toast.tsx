"use client";

import { toast } from "sonner";

/**
 * Convex error messages can be multiline ("Uncaught Error: … at handler …").
 * Extract the human line so toasts stay short.
 */
export function firstErrorLine(message: string): string {
  const match = message.match(/Uncaught (?:[A-Za-z]*Error): ([^\n]+)/);
  const line = (match?.[1] ?? message.split("\n")[0]).trim();
  return line.length > 0 ? line : "Something didn't work — try again";
}

/** Standard catch handler for mutations/actions — server errors become toasts. */
export function showMutationError(e: unknown): void {
  toast.error(
    e instanceof Error
      ? firstErrorLine(e.message)
      : "Something didn't work — try again",
  );
}
