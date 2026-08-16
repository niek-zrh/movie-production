import { toast } from "sonner";

/**
 * Convex error messages can be multiline
 * ("[CONVEX M(...)] [Request ID: …] Server Error\nUncaught Error: …") —
 * surface only the human-readable line in toasts.
 */
export function firstErrorLine(message: string): string {
  const uncaught = message.match(/Uncaught (?:[A-Za-z]*Error): ?([^\n]*)/);
  if (uncaught && uncaught[1].trim()) return uncaught[1].trim();
  const first =
    message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0] ?? "";
  const stripped = first.replace(/^(\[[^\]]*\]\s*)+/, "").trim();
  return stripped || "Something didn't work — try again";
}

/** Server permission/invariant errors must surface as toasts (conventions). */
export function showMutationError(e: unknown): void {
  toast.error(
    e instanceof Error
      ? firstErrorLine(e.message)
      : "Something didn't work — try again",
  );
}
