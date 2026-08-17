import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Approval scopes as stored in Convex (`approvals.scope`). */
export type ApprovalScope = "stage_gate" | "version" | "shot" | "delivery";
export type ApprovalStatus = "pending" | "approved" | "rejected";

/** Human labels for scope badges + filter chips. */
export const SCOPE_LABELS: Record<ApprovalScope, string> = {
  stage_gate: "Gate",
  version: "Pick",
  shot: "Shot",
  delivery: "Delivery",
};

/** Scopes whose targetLabel is a shot code → render font-mono. */
export const SCOPE_IS_CODE: Record<ApprovalScope, boolean> = {
  stage_gate: false,
  version: true,
  shot: true,
  delivery: false,
};

/* Reuses the status hues already compiled via status-pill.tsx:
   pending = amber (generating), approved = green, rejected = red (killed). */
const DECISION_CLASSES: Record<ApprovalStatus, string> = {
  pending:
    "bg-status-generating/10 text-status-generating border-status-generating/25",
  approved:
    "bg-status-approved/10 text-status-approved border-status-approved/25",
  rejected: "bg-status-killed/10 text-status-killed border-status-killed/25",
};

const DECISION_DOTS: Record<ApprovalStatus, string> = {
  pending: "bg-status-generating",
  approved: "bg-status-approved",
  rejected: "bg-status-killed",
};

const DECISION_LABELS: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

export function DecisionBadge({
  status,
  className,
}: {
  status: ApprovalStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-medium",
        DECISION_CLASSES[status],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DECISION_DOTS[status])} />
      {DECISION_LABELS[status]}
    </span>
  );
}

export function ScopeBadge({ scope }: { scope: ApprovalScope }) {
  return (
    <Badge variant="outline" className="shrink-0 text-[10px]">
      {SCOPE_LABELS[scope]}
    </Badge>
  );
}

/**
 * Convex error messages can be multiline ("[CONVEX M(...)] ... Uncaught
 * Error: the useful part\n at handler…") — surface something short in toasts.
 */
export function firstErrorLine(message: string): string {
  const lines = message.split("\n").map((l) => l.trim());
  // Matches "Uncaught Error:", "Uncaught ConvexError:", etc.
  const uncaught = lines.find((l) => /^Uncaught [A-Za-z]*Error:/.test(l));
  if (uncaught) return uncaught.replace(/^Uncaught [A-Za-z]*Error:\s*/, "");
  return lines.find((l) => l.length > 0) ?? "Something didn't work — try again";
}
