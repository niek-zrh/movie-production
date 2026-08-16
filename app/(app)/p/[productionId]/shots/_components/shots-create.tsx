"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EpisodeSelect,
  SceneSelect,
  onMutationError,
  parseCodes,
  type EpisodeRow,
  type SceneRow,
} from "./shots-common";

/** Single-shot dialog: code, title, scene (+ episode when episodic). Hotkey N opens it. */
export function NewShotDialog({
  productionId,
  scenes,
  episodes,
  episodic,
  open,
  onOpenChange,
}: {
  productionId: Id<"productions">;
  scenes: SceneRow[] | undefined;
  episodes: EpisodeRow[] | undefined;
  episodic: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createShot = useMutation(api.shots.create);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [sceneId, setSceneId] = useState<Id<"scenes"> | undefined>();
  const [episodeId, setEpisodeId] = useState<Id<"episodes"> | undefined>();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New shot</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const normalized = code.trim().toUpperCase();
            if (!normalized || busy) return;
            setBusy(true);
            try {
              await createShot({
                productionId,
                code: normalized,
                title: title.trim() || undefined,
                sceneId,
                episodeId,
              });
              toast.success(`Created ${normalized}`);
              onOpenChange(false);
              setCode("");
              setTitle("");
            } catch (err) {
              onMutationError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-shot-code">Code</Label>
            <Input
              id="new-shot-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SC010_SH020"
              className="font-mono uppercase"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-shot-title">Title (optional)</Label>
            <Input
              id="new-shot-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Hero close-up"
            />
          </div>
          <div className={cn("grid gap-3", episodic && "sm:grid-cols-2")}>
            <div className="space-y-1.5">
              <Label>Scene</Label>
              <SceneSelect
                productionId={productionId}
                scenes={scenes}
                value={sceneId}
                onChange={setSceneId}
              />
            </div>
            {episodic && (
              <div className="space-y-1.5">
                <Label>Episode</Label>
                <EpisodeSelect
                  episodes={episodes}
                  value={episodeId}
                  onChange={setEpisodeId}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={code.trim().length === 0 || busy}>
              Create shot
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Paste codes" bulk-create dialog wrapping the shared form. */
export function BulkCreateDialog({
  productionId,
  scenes,
  episodes,
  episodic,
  open,
  onOpenChange,
}: {
  productionId: Id<"productions">;
  scenes: SceneRow[] | undefined;
  episodes: EpisodeRow[] | undefined;
  episodic: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ClipboardList /> Paste codes
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Paste shot codes</DialogTitle>
          <DialogDescription>
            Separate codes with newlines, commas or spaces. Existing codes are
            skipped.
          </DialogDescription>
        </DialogHeader>
        <BulkCreateForm
          productionId={productionId}
          scenes={scenes}
          episodes={episodes}
          episodic={episodic}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The bulk-create form itself — also rendered inline in the empty state
 * (spec F5: THE empty-state invitation).
 */
export function BulkCreateForm({
  productionId,
  scenes,
  episodes,
  episodic,
  onDone,
}: {
  productionId: Id<"productions">;
  scenes: SceneRow[] | undefined;
  episodes: EpisodeRow[] | undefined;
  episodic: boolean;
  onDone?: () => void;
}) {
  const bulkCreate = useMutation(api.shots.bulkCreate);
  const [text, setText] = useState("");
  const [sceneId, setSceneId] = useState<Id<"scenes"> | undefined>();
  const [episodeId, setEpisodeId] = useState<Id<"episodes"> | undefined>();
  const [busy, setBusy] = useState(false);
  const codes = parseCodes(text);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (codes.length === 0 || busy) return;
        setBusy(true);
        try {
          const result = await bulkCreate({
            productionId,
            codes,
            sceneId,
            episodeId,
          });
          const noun = result.created === 1 ? "shot" : "shots";
          toast.success(
            result.skipped.length > 0
              ? `Created ${result.created} ${noun} · skipped ${result.skipped.length} existing`
              : `Created ${result.created} ${noun}`,
          );
          setText("");
          onDone?.();
        } catch (err) {
          onMutationError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"SC010_SH010\nSC010_SH020, SC010_SH030 …"}
        className="min-h-28 font-mono text-xs"
        aria-label="Shot codes"
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <SceneSelect
            productionId={productionId}
            scenes={scenes}
            value={sceneId}
            onChange={setSceneId}
            triggerClassName="h-7 text-xs"
          />
        </div>
        {episodic && (
          <div className="w-32">
            <EpisodeSelect
              episodes={episodes}
              value={episodeId}
              onChange={setEpisodeId}
              triggerClassName="h-7 text-xs"
            />
          </div>
        )}
        <Button
          type="submit"
          size="sm"
          className="ml-auto"
          disabled={codes.length === 0 || busy}
        >
          {codes.length > 0
            ? `Create ${codes.length} ${codes.length === 1 ? "shot" : "shots"}`
            : "Create shots"}
        </Button>
      </div>
    </form>
  );
}
