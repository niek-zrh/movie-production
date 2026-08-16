"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showMutationError } from "./qc-shared";

/**
 * Start a QC run: name it after the master ("EP01 — TV Master v3") and
 * optionally link the master file so the run page points at the right bytes.
 */
export function NewRunDialog({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const router = useRouter();
  const createRun = useMutation(api.qc.createRun);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [masterId, setMasterId] = useState<Id<"assets"> | null>(null);
  const [creating, setCreating] = useState(false);

  // Only fetch the asset list while the dialog is open.
  const assets = useQuery(
    api.assets.listForProduction,
    open ? { productionId } : "skip",
  );
  const files = useMemo(() => {
    if (assets === undefined) return undefined;
    const isMaster = (n: string) => n.toLowerCase().includes("master");
    return assets
      .filter((a) => a.kind === "file")
      .sort((a, b) => Number(isMaster(b.name)) - Number(isMaster(a.name)))
      .slice(0, 50);
  }, [assets]);

  const handleSubmit = async () => {
    setCreating(true);
    try {
      const qcRunId = await createRun({
        productionId,
        name: name.trim(),
        masterAssetId: masterId ?? undefined,
      });
      setOpen(false);
      setName("");
      setMasterId(null);
      router.push(`/p/${productionId}/qc/${qcRunId}`);
    } catch (e) {
      showMutationError(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setName("");
          setMasterId(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> New QC run
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New QC run</DialogTitle>
          <DialogDescription>
            A fresh checklist from the studio QC template.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="qc-run-name">Name</Label>
            <Input
              id="qc-run-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="EP01 — TV Master v3"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Master file (optional)</Label>
            <Select
              value={masterId}
              onValueChange={(v) => setMasterId(v as Id<"assets"> | null)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No master linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>
                  <span className="text-muted-foreground">
                    No master linked
                  </span>
                </SelectItem>
                {files === undefined ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Loading files…
                  </div>
                ) : files.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No files in this production yet
                  </div>
                ) : (
                  files.map((file) => (
                    <SelectItem key={file._id} value={file._id}>
                      <span className="truncate font-mono text-xs">
                        {file.name}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || creating}>
              Start QC run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
