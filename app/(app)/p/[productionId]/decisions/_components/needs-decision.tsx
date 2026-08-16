"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { firstErrorLine, SCOPE_IS_CODE, ScopeBadge } from "./approval-ui";

type PendingRow = (typeof api.approvals.myPending._returnType)[number];

/**
 * "Needs your decision" — my pending approvals for this production.
 * Gate rows decide inline (same note dialog pattern as the board);
 * other scopes deep-link to where the decision lives.
 */
export function NeedsDecision({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const pending = useQuery(api.approvals.myPending);
  const rows = useMemo(
    () => (pending ?? []).filter((p) => p.productionId === productionId),
    [pending, productionId],
  );
  // While loading (or when nothing is pending) the section stays out of the
  // way — the ledger below carries the page's skeleton state.
  if (rows.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          Needs your decision
        </h2>
        <Badge className="h-4 min-w-4 border-transparent bg-tape px-1 text-[10px] text-tape-foreground">
          {rows.length}
        </Badge>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {rows.map((row) => (
          <PendingApprovalRow key={row._id} row={row} />
        ))}
      </div>
    </section>
  );
}

function PendingApprovalRow({ row }: { row: PendingRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 last:border-b-0">
      <ScopeBadge scope={row.scope} />
      <Link
        href={row.href}
        className={cn(
          "min-w-0 truncate font-medium underline-offset-2 hover:underline",
          SCOPE_IS_CODE[row.scope] ? "font-mono text-xs" : "text-sm",
        )}
      >
        {row.targetLabel}
      </Link>
      <span className="text-xs text-muted-foreground">
        requested {formatAgo(row._creationTime)}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {row.scope === "stage_gate" ? (
          <GateDecisionButtons row={row} />
        ) : (
          <Link
            href={row.href}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Review <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Approve/Reject with the note dialog — a note is required when rejecting
 * (the server refuses without one; the button stays disabled until typed).
 */
function GateDecisionButtons({ row }: { row: PendingRow }) {
  const decideGate = useMutation(api.approvals.decideGate);
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const rejecting = decision === "rejected";

  const close = () => {
    setDecision(null);
    setNote("");
  };

  const submit = async () => {
    if (decision === null) return;
    setBusy(true);
    try {
      await decideGate({
        stageInstanceId: row.targetId as Id<"stageInstances">,
        decision,
        note: note.trim() === "" ? undefined : note.trim(),
      });
      toast.success(
        decision === "approved" ? "Gate approved" : "Gate rejected",
      );
      close();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? firstErrorLine(e.message)
          : "Something didn't work — try again",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        className="bg-tape text-tape-foreground hover:bg-tape/90"
        onClick={() => setDecision("approved")}
      >
        {copy.actions.approve}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setDecision("rejected")}>
        {copy.actions.reject}
      </Button>

      <Dialog
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              {rejecting ? "Reject gate" : "Approve gate"}
            </DialogTitle>
            <DialogDescription>{row.targetLabel}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`gate-note-${row._id}`}>
              {rejecting ? "What needs to change?" : "Note (optional)"}
            </Label>
            <Textarea
              id={`gate-note-${row._id}`}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                rejecting
                  ? "Required — this lands in the ledger."
                  : "e.g. Looks great — ship it."
              }
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={submit}
              disabled={busy || (rejecting && note.trim() === "")}
              variant={rejecting ? "destructive" : "default"}
              className={
                rejecting
                  ? undefined
                  : "bg-tape text-tape-foreground hover:bg-tape/90"
              }
            >
              {rejecting ? "Reject gate" : "Approve gate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
