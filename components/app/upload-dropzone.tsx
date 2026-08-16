"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MAX_BYTES = 20 * 1024 * 1024; // 20MB — bigger files go via Drive
const TOO_BIG = "Add big files in Drive — they'll appear here on next sync";

/** Convex errors can be multiline — surface only the human line. */
function firstErrorLine(message: string): string {
  const match = message.match(/Uncaught (?:[A-Za-z]*Error): ([^\n]+)/);
  const line = (match?.[1] ?? message.split("\n")[0]).trim();
  return line.length > 0 ? line : "Something didn't work — try again";
}

type UploadState = "uploading" | "done" | "error";
type UploadItem = { key: string; name: string; state: UploadState };

type PromptMetaDraft = {
  tool: string;
  model: string;
  prompt: string;
  seed: string;
};

const EMPTY_META: PromptMetaDraft = { tool: "", model: "", prompt: "", seed: "" };

/**
 * Card-sized uploader for shot options (spec F6). Accepts drag-drop, paste
 * (while mounted) and click-to-browse. Each file: generateUploadUrl → POST
 * bytes → addFromUpload. Optional prompt metadata applies to the next
 * upload(s) until cleared.
 */
export function UploadDropzone({
  productionId,
  shotId,
  className,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  className?: string;
}) {
  const generateUploadUrl = useMutation(api.versions.generateUploadUrl);
  const addFromUpload = useMutation(api.versions.addFromUpload);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [meta, setMeta] = useState<PromptMetaDraft>(EMPTY_META);
  const [metaOpen, setMetaOpen] = useState(false);

  const metaSet = Object.values(meta).some((v) => v.trim().length > 0);

  const setItemState = (key: string, state: UploadState) =>
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, state } : item)),
    );

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    for (const file of files) {
      const isMedia =
        file.type.startsWith("image/") || file.type.startsWith("video/");
      if (!isMedia) {
        toast.error(`${file.name}: only images and video become options`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(TOO_BIG);
        continue;
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setItems((prev) => [...prev, { key, name: file.name, state: "uploading" }]);
      try {
        const url = await generateUploadUrl({ productionId });
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = (await res.json()) as {
          storageId: Id<"_storage">;
        };
        const promptMeta = metaSet
          ? {
              tool: meta.tool.trim() || undefined,
              model: meta.model.trim() || undefined,
              prompt: meta.prompt.trim() || undefined,
              seed: meta.seed.trim() || undefined,
            }
          : undefined;
        await addFromUpload({
          shotId,
          storageId,
          name: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
          promptMeta,
        });
        setItemState(key, "done");
        setTimeout(
          () => setItems((prev) => prev.filter((item) => item.key !== key)),
          2500,
        );
      } catch (e) {
        setItemState(key, "error");
        toast.error(
          e instanceof Error
            ? firstErrorLine(e.message)
            : "Something didn't work — try again",
        );
      }
    }
  }

  // Paste-to-add while this dropzone is mounted.
  const uploadRef = useRef(uploadFiles);
  uploadRef.current = uploadFiles;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        void uploadRef.current(files);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className={cn("flex h-full flex-col gap-1.5", className)}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Add options — drop, paste or browse"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-44 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          dragActive
            ? "border-foreground/60 bg-muted"
            : "border-border hover:bg-muted/50",
        )}
      >
        <UploadCloud className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">Drop files, paste, or browse</p>
        <p className="text-xs text-muted-foreground">
          Images and video up to 20MB — bigger files via Drive
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0)
            void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1"
            >
              {item.state === "uploading" && (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              )}
              {item.state === "done" && (
                <Check className="size-3.5 shrink-0 text-status-approved" />
              )}
              {item.state === "error" && (
                <X className="size-3.5 shrink-0 text-destructive" />
              )}
              <span className="truncate font-mono text-xs">{item.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {item.state === "uploading"
                  ? "Uploading…"
                  : item.state === "done"
                    ? "Added"
                    : "Failed"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Popover open={metaOpen} onOpenChange={setMetaOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className="self-start text-muted-foreground"
            />
          }
        >
          <Wand2 className="size-3" /> Prompt details
          {metaSet && (
            <span
              className="size-1.5 rounded-full bg-foreground"
              aria-label="Prompt details set"
            />
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <p className="text-xs text-muted-foreground">
            Applied to the next upload(s) — how these options were generated.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pm-tool" className="text-xs">
                Tool
              </Label>
              <Input
                id="pm-tool"
                value={meta.tool}
                placeholder="Midjourney"
                className="h-7 text-sm"
                onChange={(e) => setMeta({ ...meta, tool: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-model" className="text-xs">
                Model
              </Label>
              <Input
                id="pm-model"
                value={meta.model}
                placeholder="v6.1"
                className="h-7 text-sm"
                onChange={(e) => setMeta({ ...meta, model: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pm-prompt" className="text-xs">
              Prompt
            </Label>
            <Textarea
              id="pm-prompt"
              value={meta.prompt}
              placeholder="wide shot, dusk, rain-soaked street…"
              className="min-h-16 text-sm"
              onChange={(e) => setMeta({ ...meta, prompt: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="pm-seed" className="text-xs">
                Seed
              </Label>
              <Input
                id="pm-seed"
                value={meta.seed}
                placeholder="82931"
                className="h-7 font-mono text-sm"
                onChange={(e) => setMeta({ ...meta, seed: e.target.value })}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!metaSet}
              onClick={() => setMeta(EMPTY_META)}
            >
              Clear
            </Button>
            <Button size="sm" onClick={() => setMetaOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
