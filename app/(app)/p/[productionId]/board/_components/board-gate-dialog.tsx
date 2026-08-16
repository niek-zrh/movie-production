"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
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
import { showMutationError, type StageRow } from "./board-helpers";

/**
 * Approve/Reject a stage gate. Rendered only while a decision is pending, so
 * the note resets naturally between openings. Note is REQUIRED for a reject.
 */
export function BoardGateDialog({
  stage,
  decision,
  onClose,
}: {
  stage: StageRow;
  decision: "approved" | "rejected" | null;
  onClose: () => void;
}) {
  const decideGate = useMutation(api.approvals.decideGate);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (decision === null) return null;
  const rejecting = decision === "rejected";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {rejecting ? "Reject gate" : "Approve gate"} — {stage.label}
          </DialogTitle>
          <DialogDescription>
            {rejecting
              ? "Sends the stage back with a note — the note is required so the team knows what to fix."
              : "Signs off this gate and marks the stage done."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSubmitting(true);
            try {
              await decideGate({
                stageInstanceId: stage._id,
                decision,
                note: note.trim() === "" ? undefined : note.trim(),
              });
              toast.success(
                rejecting
                  ? `${stage.label} gate rejected`
                  : `${stage.label} gate approved`,
              );
              onClose();
            } catch (err) {
              showMutationError(err);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="gate-note">
              Note{rejecting ? "" : " (optional)"}
            </Label>
            <Textarea
              id="gate-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
              placeholder={
                rejecting
                  ? "What needs to change before this gate can pass?"
                  : "Anything worth putting on the record"
              }
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              variant={rejecting ? "destructive" : "default"}
              disabled={submitting || (rejecting && note.trim() === "")}
            >
              {rejecting ? "Reject gate" : "Approve gate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
