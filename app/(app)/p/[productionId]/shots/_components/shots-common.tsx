"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ShotRow = (typeof api.shots.list._returnType)[number];
export type TeamMember = (typeof api.studios.team._returnType)[number];
export type SceneRow = (typeof api.scenes.list._returnType)[number];
export type EpisodeRow = Doc<"episodes">;

/**
 * Convex error messages are multiline
 * ("[CONVEX M(...)] Server Error\nUncaught Error: msg\n  at handler…") —
 * surface just the human sentence.
 */
export function firstErrorLine(message: string): string {
  const uncaught = message.match(/Uncaught [A-Za-z]*(?:Error)?:\s*([^\n]+)/);
  const line =
    uncaught?.[1] ??
    message.split("\n").find((l) => l.trim().length > 0) ??
    message;
  return (
    line.replace(/\s+at handler.*$/, "").trim() ||
    "Something didn't work — try again"
  );
}

/** Standard mutation error handler: server refusals become short toasts. */
export function onMutationError(e: unknown) {
  toast.error(
    e instanceof Error
      ? firstErrorLine(e.message)
      : "Something didn't work — try again",
  );
}

/** Roles with the content.edit capability (create/edit any shot). */
export function isContentEditor(role: string | null): boolean {
  return (
    role === "owner" ||
    role === "producer" ||
    role === "creative_director" ||
    role === "supervisor"
  );
}

/** Split pasted text into unique uppercase shot codes. */
export function parseCodes(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,;]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length > 0),
    ),
  );
}

const CREATE_SENTINEL = "__create-scene__";
const NONE_SENTINEL = "__none__";

/**
 * Scene picker with an inline "Create scene…" escape hatch (spec F5):
 * choosing it swaps the select for a code input → api.scenes.create.
 */
export function SceneSelect({
  productionId,
  scenes,
  value,
  onChange,
  triggerClassName,
}: {
  productionId: Id<"productions">;
  scenes: SceneRow[] | undefined;
  value: Id<"scenes"> | undefined;
  onChange: (sceneId: Id<"scenes"> | undefined) => void;
  triggerClassName?: string;
}) {
  const createScene = useMutation(api.scenes.create);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = scenes?.find((s) => s._id === value);

  const submit = async () => {
    const normalized = code.trim().toUpperCase();
    if (!normalized || busy) return;
    setBusy(true);
    try {
      const sceneId = await createScene({ productionId, code: normalized });
      toast.success(`Created scene ${normalized}`);
      onChange(sceneId);
      setCreating(false);
      setCode("");
    } catch (e) {
      onMutationError(e);
    } finally {
      setBusy(false);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="SC010"
          className="h-8 font-mono text-xs uppercase"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") setCreating(false);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={code.trim().length === 0 || busy}
          onClick={() => void submit()}
        >
          Add
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel"
          onClick={() => setCreating(false)}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={(value ?? NONE_SENTINEL) as string}
      onValueChange={(v) => {
        if (v === CREATE_SENTINEL) {
          setCreating(true);
          return;
        }
        onChange(v === NONE_SENTINEL ? undefined : (v as Id<"scenes">));
      }}
    >
      <SelectTrigger className={cn("w-full", triggerClassName)}>
        {selected ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="font-mono text-xs">{selected.code}</span>
            {selected.title && (
              <span className="truncate text-muted-foreground">
                {selected.title}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">No scene</span>
        )}
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectItem value={NONE_SENTINEL}>No scene</SelectItem>
        {(scenes ?? []).map((s) => (
          <SelectItem key={s._id} value={s._id}>
            <span className="font-mono text-xs">{s.code}</span>
            {s.title && (
              <span className="truncate text-muted-foreground">{s.title}</span>
            )}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={CREATE_SENTINEL}>
          <Plus className="size-3.5" /> Create scene…
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Episode picker (episodic productions only). */
export function EpisodeSelect({
  episodes,
  value,
  onChange,
  triggerClassName,
}: {
  episodes: EpisodeRow[] | undefined;
  value: Id<"episodes"> | undefined;
  onChange: (episodeId: Id<"episodes"> | undefined) => void;
  triggerClassName?: string;
}) {
  const selected = episodes?.find((e) => e._id === value);
  return (
    <Select
      value={(value ?? NONE_SENTINEL) as string}
      onValueChange={(v) =>
        onChange(v === NONE_SENTINEL ? undefined : (v as Id<"episodes">))
      }
    >
      <SelectTrigger className={cn("w-full", triggerClassName)}>
        {selected ? (
          <span className="font-mono text-xs">{episodeLabel(selected)}</span>
        ) : (
          <span className="text-muted-foreground">No episode</span>
        )}
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectItem value={NONE_SENTINEL}>No episode</SelectItem>
        {(episodes ?? []).map((e) => (
          <SelectItem key={e._id} value={e._id}>
            <span className="font-mono text-xs">{episodeLabel(e)}</span>
            {e.title && (
              <span className="truncate text-muted-foreground">{e.title}</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function episodeLabel(episode: { number: number }): string {
  return `EP${String(episode.number).padStart(2, "0")}`;
}
