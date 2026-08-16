"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { firstErrorLine, type AssetRow } from "./files-section";

/**
 * "Attach to shot…" for an unassigned library file. Controlled from the page:
 * open while `asset` is set. Attaching as a version routes through the same
 * server path as uploads, so the shot auto-moves to options_ready.
 */
export function FilesAttachDialog({
  asset,
  productionId,
  onClose,
}: {
  asset: AssetRow | null;
  productionId: Id<"productions">;
  onClose: () => void;
}) {
  const shots = useQuery(
    api.shots.list,
    asset !== null ? { productionId } : "skip",
  );
  const attach = useMutation(api.assets.attachToShot);
  const [shotId, setShotId] = useState<Id<"shots"> | null>(null);
  const [asVersion, setAsVersion] = useState(true);
  const [busy, setBusy] = useState(false);

  const assetId = asset?._id;
  useEffect(() => {
    // Fresh form each time a different file is being attached.
    setShotId(null);
    setAsVersion(true);
    setBusy(false);
  }, [assetId]);

  const submit = async () => {
    if (asset === null || shotId === null) return;
    setBusy(true);
    try {
      const result = await attach({ assetId: asset._id, shotId, asVersion });
      const code = shots?.find((s) => s._id === shotId)?.code ?? "shot";
      toast.success(
        result !== null
          ? `Attached as v${result.index} of ${code}`
          : `Attached to ${code}`,
      );
      onClose();
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
    <Dialog
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Attach to shot</DialogTitle>
          <DialogDescription className="truncate font-mono text-xs">
            {asset?.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Shot</Label>
            <Select
              value={shotId}
              onValueChange={(value) => setShotId(value as Id<"shots"> | null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a shot" />
              </SelectTrigger>
              <SelectContent>
                {shots === undefined ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Loading shots…
                  </div>
                ) : shots.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No shots yet
                  </div>
                ) : (
                  shots.map((shot) => (
                    <SelectItem key={shot._id} value={shot._id}>
                      <span className="font-mono text-xs">{shot.code}</span>
                      {shot.title !== undefined && (
                        <span className="truncate text-muted-foreground">
                          {shot.title}
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={asVersion}
                onCheckedChange={(checked) => setAsVersion(checked === true)}
              />
              Add as a new version
            </Label>
            <p className="pl-6 text-xs text-muted-foreground">
              {asVersion
                ? "The file joins the shot's options as the next version."
                : "The file is linked to the shot without entering the options lineup."}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={shotId === null || busy}>
            {busy && <Loader2 className="animate-spin" />}
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
