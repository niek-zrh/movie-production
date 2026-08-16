"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { Check, Circle, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/app/user-avatar";
import { cn } from "@/lib/utils";

type StageRow = (typeof api.productions.listStages._returnType)[number];

/** Literal class strings so Tailwind compiles them (same trick as status-pill). */
const SEGMENT_CLASSES: Record<StageRow["status"], string> = {
  not_started: "border-t-transparent bg-muted/40",
  active: "border-t-foreground bg-card",
  blocked: "border-t-status-rework bg-status-rework/10",
  done: "border-t-status-approved bg-status-approved/10",
};

const STATUS_LABELS: Record<StageRow["status"], string> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

const STATUS_LABEL_CLASSES: Record<StageRow["status"], string> = {
  not_started: "text-muted-foreground/80",
  active: "text-foreground",
  blocked: "text-status-rework",
  done: "text-status-approved",
};

const GATE_TITLES: Record<StageRow["gateStatus"], string> = {
  open: "Gate open",
  requested: "Sign-off requested",
  approved: "Gate approved",
  rejected: "Gate rejected",
};

function GateChip({ status }: { status: StageRow["gateStatus"] }) {
  const title = GATE_TITLES[status];
  switch (status) {
    case "open":
      return (
        <Circle
          className="size-3 shrink-0 text-muted-foreground/60"
          aria-label={title}
        >
          <title>{title}</title>
        </Circle>
      );
    case "requested":
      return (
        <span
          className="relative flex size-2.5 shrink-0"
          aria-label={title}
          title={title}
        >
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-generating opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-status-generating" />
        </span>
      );
    case "approved":
      return (
        <Check
          className="size-3.5 shrink-0 text-status-approved"
          aria-label={title}
        >
          <title>{title}</title>
        </Check>
      );
    case "rejected":
      return (
        <X className="size-3.5 shrink-0 text-destructive" aria-label={title}>
          <title>{title}</title>
        </X>
      );
  }
}

/**
 * Six stage segments in one horizontal band (STAGES order) — each with a
 * 2px status-colored top edge (the slate-strip signature), a gate chip and
 * the gate approvers. The whole band deep-links to the board.
 */
export function OverviewStageStrip({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const stages = useQuery(api.productions.listStages, { productionId });

  if (stages === undefined) return <Skeleton className="h-[72px] rounded-xl" />;

  return (
    <Link
      href={`/p/${productionId}/board`}
      aria-label="Open the stage board"
      className="block"
    >
      <div className="grid grid-cols-3 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-shadow duration-150 hover:shadow-md sm:grid-cols-6">
        {stages.map((stage, i) => (
          <div
            key={stage._id}
            className={cn(
              "flex min-w-0 flex-col gap-2 border-t-2 px-3 py-2.5",
              i > 0 && "border-l border-l-border",
              SEGMENT_CLASSES[stage.status],
            )}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span
                className={cn(
                  "truncate text-xs font-medium",
                  stage.status === "not_started"
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {stage.short}
              </span>
              <GateChip status={stage.gateStatus} />
            </div>
            <div className="flex h-4 items-center justify-between gap-1">
              <span
                className={cn(
                  "truncate text-[10px] uppercase tracking-wide",
                  STATUS_LABEL_CLASSES[stage.status],
                )}
              >
                {STATUS_LABELS[stage.status]}
              </span>
              {stage.approvers.length > 0 && (
                <div className="flex shrink-0 items-center -space-x-1.5">
                  {stage.approvers.slice(0, 3).map((approver) => (
                    <UserAvatar
                      key={approver._id}
                      name={approver.name}
                      image={approver.image}
                      className="size-4 text-[8px] ring-1 ring-card"
                    />
                  ))}
                  {stage.approvers.length > 3 && (
                    <span className="pl-2 text-[9px] text-muted-foreground">
                      +{stage.approvers.length - 3}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Link>
  );
}
