"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { canonicalApprovedName } from "@/convex/lib/domain";
import { copy } from "@/lib/copy";
import {
  extensionOf,
  firstErrorLine,
  isImageVersion,
  type ShotDetail,
  type VersionCard,
} from "./review-utils";

/**
 * The one orchestrated moment (spec §9.2): picking a version. Shows the
 * canonical approved filename the pick will create in Drive.
 */
export function PickDialog({
  open,
  onOpenChange,
  version,
  shot,
  onPicked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: VersionCard;
  shot: ShotDetail;
  onPicked: (version: VersionCard) => void;
}) {
  const pick = useMutation(api.versions.pick);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Autofocus the confirm button so Enter picks without touching the mouse.
  useEffect(() => {
    if (!open) return;
    setNote("");
    const id = window.setTimeout(() => confirmRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  const approvedName = canonicalApprovedName({
    productionCode: shot.production.code,
    episodeNumber: shot.episode?.number,
    shotCode: shot.code,
    versionIndex: version.index,
    extension: extensionOf(version.asset),
  });

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await pick({
        versionId: version._id,
        note: note.trim() === "" ? undefined : note.trim(),
      });
      onOpenChange(false);
      onPicked(version);
    } catch (e) {
      toast.error(firstErrorLine(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark bg-popover text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="font-display">
            Pick <span className="font-mono">v{version.index}</span> for{" "}
            <span className="font-mono">{shot.code}</span>
          </DialogTitle>
        </DialogHeader>

        {isImageVersion(version) && version.asset?.thumbUrl && (
          <div className="overflow-hidden rounded-lg bg-[#0E0F12]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={version.asset.thumbUrl}
              alt={`v${version.index}`}
              className="mx-auto max-h-44 object-contain"
            />
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground">
            Files into Approved/ as
          </p>
          <p className="mt-1 break-all font-mono text-xs">{approvedName}</p>
        </div>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void confirm();
            }
          }}
          placeholder="Why this one? (optional)"
          className="text-sm"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            disabled={busy}
            className="bg-tape text-tape-foreground hover:bg-tape/85"
            onClick={() => void confirm()}
          >
            {copy.actions.pick}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small reject dialog: optional note, Enter confirms. */
export function RejectDialog({
  open,
  onOpenChange,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: VersionCard;
}) {
  const reject = useMutation(api.versions.reject);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    const id = window.setTimeout(() => noteRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await reject({
        versionId: version._id,
        note: note.trim() === "" ? undefined : note.trim(),
      });
      toast.success(`v${version.index} rejected`);
      onOpenChange(false);
    } catch (e) {
      toast.error(firstErrorLine(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark bg-popover text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="font-display">
            Reject <span className="font-mono">v{version.index}</span>
          </DialogTitle>
        </DialogHeader>
        <Textarea
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void confirm();
            }
          }}
          placeholder="Why not? (optional — Enter confirms)"
          className="text-sm"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {copy.actions.reject}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
