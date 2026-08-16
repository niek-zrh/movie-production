"use client";

import { useMutation } from "convex/react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Check, MoreHorizontal, Send, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { StageKey } from "@/convex/lib/domain";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { BoardGateDialog } from "./board-gate-dialog";
import { BoardShotCard } from "./board-shot-card";
import {
  GateChip,
  SHOT_DRAG_TYPE,
  showMutationError,
  STAGE_STATUS_BY_KEY,
  STAGE_STATUS_OPTIONS,
  type BoardShot,
  type StageInstanceStatus,
  type StageRow,
} from "./board-helpers";

const MAX_APPROVER_AVATARS = 4;

export function BoardColumn({
  stage,
  shots,
  canDrag,
  onMoveShot,
}: {
  stage: StageRow;
  shots: BoardShot[];
  canDrag: boolean;
  onMoveShot: (shotId: Id<"shots">, stage: StageKey) => void;
}) {
  const { role, viewer } = useStudio();
  const setStageStatus = useMutation(api.productions.setStageStatus);
  const requestSignoff = useMutation(api.approvals.requestGateSignoff);

  const [gateDecision, setGateDecision] = useState<
    "approved" | "rejected" | null
  >(null);
  const [isOver, setIsOver] = useState(false);
  const dragDepth = useRef(0);

  // Server enforces all of this; we only decide what to show (spec: role-aware UI).
  const canSetStatus =
    role === "owner" || role === "producer" || role === "creative_director";
  const canRequest = canSetStatus || role === "supervisor";
  const viewerId = viewer?._id;
  const canDecide =
    canSetStatus ||
    (viewerId !== undefined && stage.gateApproverIds.includes(viewerId));
  const showDecideItems = stage.gateStatus === "requested" && canDecide;
  const showMenu = canRequest || showDecideItems;

  const hasShotDrag = (e: DragEvent) =>
    e.dataTransfer.types.includes(SHOT_DRAG_TYPE);

  return (
    <section
      aria-label={stage.label}
      onDragEnter={(e) => {
        if (!hasShotDrag(e)) return;
        dragDepth.current += 1;
        setIsOver(true);
      }}
      onDragOver={(e) => {
        if (!hasShotDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(e) => {
        if (!hasShotDrag(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setIsOver(false);
        }
      }}
      onDrop={(e) => {
        if (!hasShotDrag(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setIsOver(false);
        const shotId = e.dataTransfer.getData(SHOT_DRAG_TYPE);
        if (shotId) onMoveShot(shotId as Id<"shots">, stage.stage);
      }}
      className={cn(
        "flex min-w-[260px] max-w-[360px] flex-1 flex-col rounded-xl border bg-muted/30 transition-colors",
        isOver && "border-foreground/30 bg-accent",
      )}
    >
      <header className="space-y-2 border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <h2
              title={stage.label}
              className="truncate font-display text-sm font-semibold tracking-tight"
            >
              {stage.short}
            </h2>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {shots.length}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {stage.approvers.length > 0 && (
              <div className="flex items-center -space-x-1.5">
                {stage.approvers.slice(0, MAX_APPROVER_AVATARS).map((a) => (
                  <span key={a._id} title={`${a.name} — gate approver`}>
                    <UserAvatar
                      name={a.name}
                      image={a.image}
                      className="size-5 text-[9px] ring-2 ring-background"
                    />
                  </span>
                ))}
                {stage.approvers.length > MAX_APPROVER_AVATARS && (
                  <span className="pl-2.5 text-[10px] text-muted-foreground">
                    +{stage.approvers.length - MAX_APPROVER_AVATARS}
                  </span>
                )}
              </div>
            )}
            {showMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label={`${stage.label} menu`}
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-44">
                  {canRequest && (
                    <DropdownMenuItem
                      disabled={stage.gateStatus === "requested"}
                      onClick={() => {
                        void requestSignoff({ stageInstanceId: stage._id })
                          .then(() =>
                            toast.success(
                              `Sign-off requested for ${stage.label}`,
                            ),
                          )
                          .catch(showMutationError);
                      }}
                    >
                      <Send /> {copy.actions.requestSignOff}
                    </DropdownMenuItem>
                  )}
                  {showDecideItems && (
                    <>
                      {canRequest && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onClick={() => setGateDecision("approved")}
                      >
                        <Check /> Approve gate…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setGateDecision("rejected")}
                      >
                        <X /> Reject gate…
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          {canSetStatus ? (
            <Select
              value={stage.status}
              onValueChange={(value) => {
                void setStageStatus({
                  stageInstanceId: stage._id,
                  status: value as StageInstanceStatus,
                }).catch(showMutationError);
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-6 w-auto gap-1 px-1.5 text-xs"
                aria-label={`${stage.label} status`}
              >
                <SelectValue>
                  {STAGE_STATUS_BY_KEY[stage.status].label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STAGE_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    <span className={cn("size-1.5 rounded-full", o.dot)} />
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  STAGE_STATUS_BY_KEY[stage.status].dot,
                )}
              />
              {STAGE_STATUS_BY_KEY[stage.status].label}
            </span>
          )}
          <GateChip status={stage.gateStatus} note={stage.gateNote} />
        </div>
      </header>

      <div className="flex min-h-40 flex-1 flex-col gap-2 p-2">
        {shots.map((shot) => (
          <BoardShotCard key={shot._id} shot={shot} canDrag={canDrag} />
        ))}
        {shots.length === 0 && (
          <p className="rounded-md border border-dashed px-2 py-6 text-center text-[11px] text-muted-foreground">
            No shots in this stage
          </p>
        )}
      </div>

      <BoardGateDialog
        stage={stage}
        decision={gateDecision}
        onClose={() => setGateDecision(null)}
      />
    </section>
  );
}
