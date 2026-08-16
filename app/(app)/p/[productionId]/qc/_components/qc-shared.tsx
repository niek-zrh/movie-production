import { toast } from "sonner";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

export type QcCategory = Doc<"qcParameters">["category"];
export type QcRunStatus = Doc<"qcRuns">["status"];

/** Display order for check categories (spec F11). */
export const QC_CATEGORIES: { key: QcCategory; label: string }[] = [
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "container", label: "Container" },
  { key: "content", label: "Content" },
  { key: "metadata", label: "Metadata" },
];

export const RUN_STATUS_META: Record<
  QcRunStatus,
  { label: string; badgeClasses: string; dotClasses: string }
> = {
  in_progress: {
    label: "In progress",
    badgeClasses:
      "bg-status-options_ready/10 text-status-options_ready border-status-options_ready/25",
    dotClasses: "bg-status-options_ready",
  },
  passed: {
    label: "Passed",
    badgeClasses:
      "bg-status-approved/10 text-status-approved border-status-approved/25",
    dotClasses: "bg-status-approved",
  },
  failed: {
    label: "Failed",
    badgeClasses: "bg-destructive/10 text-destructive border-destructive/25",
    dotClasses: "bg-destructive",
  },
};

export function RunStatusBadge({
  status,
  className,
}: {
  status: QcRunStatus;
  className?: string;
}) {
  const meta = RUN_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-medium",
        meta.badgeClasses,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dotClasses)} />
      {meta.label}
    </span>
  );
}

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
