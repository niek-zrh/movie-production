"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { ExternalLink, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  isImageVersion,
  VERSION_DOT,
  VERSION_STATUS_LABEL,
  type VersionCard,
} from "./review-utils";

export type CanvasTransform = { scale: number; tx: number; ty: number };

export const IDENTITY_TRANSFORM: CanvasTransform = { scale: 1, tx: 0, ty: 0 };

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The compare canvas: 1–4 panes, one shared {scale, tx, ty} applied to every
 * pane so hand anatomy lines up across Midjourney options. Wheel zooms toward
 * the cursor, drag pans, double-click resets. No transitions — it must feel
 * tight while dragging.
 */
export function CompareCanvas({
  panes,
  focusedId,
  clappedId,
  transform,
  setTransform,
  onFocusVersion,
}: {
  panes: VersionCard[];
  focusedId: string | null;
  clappedId: string | null;
  transform: CanvasTransform;
  setTransform: Dispatch<SetStateAction<CanvasTransform>>;
  onFocusVersion: (versionId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // React attaches wheel listeners passively — zoom needs preventDefault, so
  // bind a native non-passive listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const paneEl =
        (e.target as HTMLElement | null)?.closest("[data-pane-canvas]") ?? el;
      const rect = paneEl.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      setTransform((t) => {
        const scale = clampScale(t.scale * Math.exp(-e.deltaY * 0.002));
        if (scale === t.scale) return t;
        const k = scale / t.scale;
        return {
          scale,
          tx: cx - k * (cx - t.tx),
          ty: cy - k * (cy - t.ty),
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setTransform]);

  const gridClass =
    panes.length <= 1
      ? "grid-cols-1"
      : panes.length === 2
        ? "grid-cols-2"
        : panes.length === 3
          ? "grid-cols-3"
          : "grid-cols-2 grid-rows-2";

  return (
    <div
      ref={containerRef}
      className={cn("grid min-h-0 flex-1 gap-px bg-border/60", gridClass)}
    >
      {panes.map((version) => (
        <Pane
          key={version._id}
          version={version}
          focused={version._id === focusedId}
          clapped={version._id === clappedId}
          transform={transform}
          setTransform={setTransform}
          onFocus={() => onFocusVersion(version._id)}
        />
      ))}
    </div>
  );
}

function Pane({
  version,
  focused,
  clapped,
  transform,
  setTransform,
  onFocus,
}: {
  version: VersionCard;
  focused: boolean;
  clapped: boolean;
  transform: CanvasTransform;
  setTransform: Dispatch<SetStateAction<CanvasTransform>>;
  onFocus: () => void;
}) {
  const isImage = isImageVersion(version);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <div
        className={cn(
          "z-10 flex h-7 shrink-0 items-center gap-2 border-b border-white/5 bg-black/30 px-2.5",
          clapped && "slate-clap",
        )}
      >
        <span
          className={cn(
            "font-mono text-[11px] tracking-tight",
            focused ? "text-foreground" : "text-muted-foreground",
          )}
        >
          v{version.index}
        </span>
        <span
          className={cn("size-1.5 rounded-full", VERSION_DOT[version.status])}
          title={VERSION_STATUS_LABEL[version.status]}
        />
        {version.status !== "candidate" && (
          <span className="text-[10px] text-muted-foreground">
            {VERSION_STATUS_LABEL[version.status]}
          </span>
        )}
      </div>

      {isImage && version.asset?.thumbUrl ? (
        <ImageSurface
          src={version.asset.thumbUrl}
          alt={`v${version.index}`}
          rejected={version.status === "rejected"}
          transform={transform}
          setTransform={setTransform}
          onFocus={onFocus}
        />
      ) : (
        <MediaSurface version={version} onFocus={onFocus} />
      )}

      {focused && (
        <div
          className="pointer-events-none absolute inset-0 z-20 border border-tape"
          aria-hidden
        />
      )}
    </div>
  );
}

function ImageSurface({
  src,
  alt,
  rejected,
  transform,
  setTransform,
  onFocus,
}: {
  src: string;
  alt: string;
  rejected: boolean;
  transform: CanvasTransform;
  setTransform: Dispatch<SetStateAction<CanvasTransform>>;
  onFocus: () => void;
}) {
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  return (
    <div
      data-pane-canvas
      className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
        if (!d.moved) return;
        // Rebase the drag origin and pan relative to the CURRENT transform,
        // so a wheel-zoom mid-drag isn't clobbered by the next pointermove.
        d.startX = e.clientX;
        d.startY = e.clientY;
        setTransform((t) => ({ ...t, tx: t.tx + dx, ty: t.ty + dy }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (d && !d.moved) onFocus();
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => setTransform(IDENTITY_TRANSFORM)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn(
          "pointer-events-none absolute inset-0 m-auto max-h-full max-w-full object-contain",
          rejected && "opacity-50 saturate-0",
        )}
        style={{
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: "center",
        }}
      />
    </div>
  );
}

/** Video (or any non-image) version: poster + open, no in-app playback. */
function MediaSurface({
  version,
  onFocus,
}: {
  version: VersionCard;
  onFocus: () => void;
}) {
  const asset = version.asset;
  const poster = asset?.thumbUrl ?? null;
  const openUrl = asset?.fileUrl ?? null;
  return (
    <div
      data-pane-canvas
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden p-4"
      onClick={onFocus}
    >
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt={`v${version.index}`}
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-contain opacity-30"
        />
      )}
      <Film className="relative size-7 text-muted-foreground" />
      <p className="relative max-w-full truncate font-mono text-xs text-muted-foreground">
        {asset?.name ?? "No file"}
      </p>
      {openUrl && (
        <Button
          variant="secondary"
          size="lg"
          className="relative"
          onClick={(e) => e.stopPropagation()}
          render={
            <a href={openUrl} target="_blank" rel="noreferrer" />
          }
        >
          <ExternalLink className="size-4" />
          {asset?.provider === "gdrive" ? copy.actions.openInDrive : "Open file"}
        </Button>
      )}
    </div>
  );
}
