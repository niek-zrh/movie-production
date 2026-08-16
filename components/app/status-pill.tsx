import { cn } from "@/lib/utils";
import {
  SHOT_STATUS_BY_KEY,
  type ShotStatusKey,
} from "@/convex/lib/domain";

/** Fixed status hues (spec §9.2) — literal class strings so Tailwind compiles them. */
const STATUS_CLASSES: Record<ShotStatusKey, string> = {
  planned: "bg-status-planned/10 text-status-planned border-status-planned/25",
  generating:
    "bg-status-generating/10 text-status-generating border-status-generating/25",
  options_ready:
    "bg-status-options_ready/10 text-status-options_ready border-status-options_ready/25",
  in_review:
    "bg-status-in_review/10 text-status-in_review border-status-in_review/25",
  picked: "bg-status-picked/10 text-status-picked border-status-picked/25",
  approved:
    "bg-status-approved/10 text-status-approved border-status-approved/25",
  rework: "bg-status-rework/10 text-status-rework border-status-rework/25",
  final: "bg-status-final/10 text-status-final border-status-final/25",
  delivered:
    "bg-status-delivered/10 text-status-delivered border-status-delivered/25",
  killed: "bg-status-killed/10 text-status-killed border-status-killed/25",
};

export const STATUS_DOT_CLASSES: Record<ShotStatusKey, string> = {
  planned: "bg-status-planned",
  generating: "bg-status-generating",
  options_ready: "bg-status-options_ready",
  in_review: "bg-status-in_review",
  picked: "bg-status-picked",
  approved: "bg-status-approved",
  rework: "bg-status-rework",
  final: "bg-status-final",
  delivered: "bg-status-delivered",
  killed: "bg-status-killed",
};

export const STATUS_VAR: Record<ShotStatusKey, string> = {
  planned: "var(--color-status-planned)",
  generating: "var(--color-status-generating)",
  options_ready: "var(--color-status-options_ready)",
  in_review: "var(--color-status-in_review)",
  picked: "var(--color-status-picked)",
  approved: "var(--color-status-approved)",
  rework: "var(--color-status-rework)",
  final: "var(--color-status-final)",
  delivered: "var(--color-status-delivered)",
  killed: "var(--color-status-killed)",
};

export function StatusPill({
  status,
  className,
  size = "sm",
}: {
  status: ShotStatusKey;
  className?: string;
  size?: "sm" | "xs";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-1.5 py-px text-[10px]",
        STATUS_CLASSES[status],
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          STATUS_DOT_CLASSES[status],
        )}
      />
      {SHOT_STATUS_BY_KEY[status].label}
    </span>
  );
}
