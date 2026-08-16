"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Keyboard,
  Maximize,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/app/status-pill";
import { useStudio } from "@/components/app/studio-context";
import { useHotkeys } from "@/lib/hooks/use-hotkeys";
import { cn } from "@/lib/utils";
import {
  CompareCanvas,
  IDENTITY_TRANSFORM,
  type CanvasTransform,
} from "./compare-canvas";
import { PickDialog, RejectDialog } from "./decision-dialogs";
import { Filmstrip } from "./filmstrip";
import { RightRail } from "./right-rail";
import {
  firstErrorLine,
  roleCanDecide,
  type VersionCard,
} from "./review-utils";

/**
 * The Review Room (spec F7) — immersive dark, escapes the app shell entirely.
 * Compare 1–4 options with synced zoom/pan, shortlist/reject/pick from the
 * keyboard. This replaces screenshots-pasted-into-Miro.
 */
export function ReviewRoom({
  productionId,
  shotId,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
}) {
  const router = useRouter();
  const { role } = useStudio();
  const shot = useQuery(api.shots.get, { shotId });
  const versions = useQuery(api.versions.listForShot, { shotId });
  const shortlistVersion = useMutation(api.versions.shortlist);

  const [focusIndex, setFocusIndex] = useState(0);
  const [compareCount, setCompareCount] = useState<1 | 2 | 3 | 4>(1);
  const [transform, setTransform] =
    useState<CanvasTransform>(IDENTITY_TRANSFORM);
  const [railOpen, setRailOpen] = useState(true);
  const [pickOpen, setPickOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [clappedId, setClappedId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const count = versions?.length ?? 0;
  const focused: VersionCard | undefined =
    versions !== undefined && count > 0
      ? versions[Math.min(focusIndex, count - 1)]
      : undefined;

  useEffect(() => {
    if (count > 0 && focusIndex >= count) setFocusIndex(0);
  }, [count, focusIndex]);

  const shortlisted = useMemo(
    () => (versions ?? []).filter((v) => v.status === "shortlisted"),
    [versions],
  );
  const shortlistCompare =
    compareCount > 1 && shortlisted.length >= compareCount;

  // Panes: shortlist-first when enough are shortlisted ("shortlist 2, then
  // compare the 2"); otherwise a wrapping window starting at the focus.
  const panes = useMemo(() => {
    if (!versions || versions.length === 0) return [];
    if (shortlistCompare) return shortlisted.slice(0, compareCount);
    return Array.from(
      { length: Math.min(compareCount, versions.length) },
      (_, i) => versions[(focusIndex + i) % versions.length],
    );
  }, [versions, shortlisted, shortlistCompare, compareCount, focusIndex]);

  // Preload neighbors so arrowing through options feels instant.
  useEffect(() => {
    if (!versions || versions.length < 2) return;
    for (const offset of [-1, 1]) {
      const neighbor =
        versions[(focusIndex + offset + versions.length) % versions.length];
      const url = neighbor.asset?.thumbUrl;
      if (url !== null && url !== undefined) {
        const img = new window.Image();
        img.src = url;
      }
    }
  }, [focusIndex, versions]);

  const anyDialogOpen = pickOpen || rejectOpen || hintsOpen;
  const canDecide = roleCanDecide(role);

  const closeRoom = () => router.push(`/p/${productionId}/review`);

  const guardDecide = (): boolean => {
    if (!canDecide) {
      toast("Your role can't decide picks");
      return false;
    }
    return true;
  };

  const onShortlist = () => {
    if (anyDialogOpen || !focused || !guardDecide()) return;
    void shortlistVersion({ versionId: focused._id }).catch((e) =>
      toast.error(firstErrorLine(e)),
    );
  };

  const onReject = () => {
    if (anyDialogOpen || !focused || !guardDecide()) return;
    if (focused.status === "rejected") {
      toast(`v${focused.index} is already rejected`);
      return;
    }
    if (focused.status === "picked") {
      toast(`v${focused.index} is picked — pick another version to supersede it`);
      return;
    }
    setRejectOpen(true);
  };

  const onPick = () => {
    if (anyDialogOpen || !focused || !guardDecide()) return;
    if (focused.status === "picked") {
      toast(`v${focused.index} is already picked`);
      return;
    }
    setPickOpen(true);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement
        .requestFullscreen()
        .catch(() => undefined);
    }
  };

  const handlePicked = (version: VersionCard) => {
    toast.success(`v${version.index} picked`);
    setClappedId(version._id);
    setLeaving(true);
    window.setTimeout(() => setClappedId(null), 300);
    window.setTimeout(() => closeRoom(), 600);
  };

  const setCount = (n: 1 | 2 | 3 | 4) => {
    if (!anyDialogOpen) setCompareCount(n);
  };

  useHotkeys(
    {
      "1": () => setCount(1),
      "2": () => setCount(2),
      "3": () => setCount(3),
      "4": () => setCount(4),
      arrowleft: () => {
        if (anyDialogOpen || count === 0) return;
        setFocusIndex((i) => (i - 1 + count) % count);
      },
      arrowright: () => {
        if (anyDialogOpen || count === 0) return;
        setFocusIndex((i) => (i + 1) % count);
      },
      s: onShortlist,
      x: onReject,
      p: onPick,
      f: () => {
        if (!anyDialogOpen) toggleFullscreen();
      },
      "0": () => {
        if (!anyDialogOpen) setTransform(IDENTITY_TRANSFORM);
      },
      "?": () => setHintsOpen(true),
      escape: () => {
        // Esc first exits fullscreen (the browser does that), then closes.
        if (anyDialogOpen || leaving || document.fullscreenElement) return;
        closeRoom();
      },
    },
    !leaving,
  );

  const loading = shot === undefined || versions === undefined;

  return (
    <div className="dark">
      <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={closeRoom}
            title="Back to queue (Esc)"
          >
            <X />
            <span className="sr-only">Close</span>
          </Button>
          {shot === undefined ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <>
              <span className="font-mono text-sm font-semibold tracking-tight">
                {shot.code}
              </span>
              {shot.title !== undefined && shot.title !== "" && (
                <span className="hidden max-w-64 truncate text-sm text-muted-foreground sm:inline">
                  {shot.title}
                </span>
              )}
              <StatusPill status={shot.status} size="xs" />
            </>
          )}

          <div className="flex-1" />

          {/* Compare-count indicator */}
          <div className="flex items-center gap-1.5">
            {shortlistCompare && (
              <span className="hidden text-[10px] uppercase tracking-wide text-muted-foreground md:inline">
                Shortlist
              </span>
            )}
            <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={cn(
                    "size-6 rounded font-mono text-[11px] transition-colors",
                    compareCount === n
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title={`Compare ${n}-up`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
          >
            <Maximize />
            <span className="sr-only">Fullscreen</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setHintsOpen(true)}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard />
            <span className="sr-only">Keyboard shortcuts</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRailOpen((o) => !o)}
            title={railOpen ? "Hide details" : "Show details"}
          >
            {railOpen ? <PanelRightClose /> : <PanelRightOpen />}
            <span className="sr-only">Toggle details</span>
          </Button>
        </header>

        {/* Center: compare canvas + right rail */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0E0F12]">
            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <Skeleton className="h-64 w-96 max-w-[80%]" />
              </div>
            ) : count === 0 ? (
              <div className="flex flex-1 items-center justify-center px-8 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  No options on this shot yet. Add options from the shot page
                  and they land here for review.
                </p>
              </div>
            ) : (
              <CompareCanvas
                panes={panes}
                focusedId={focused?._id ?? null}
                clappedId={clappedId}
                transform={transform}
                setTransform={setTransform}
                onFocusVersion={(versionId) => {
                  const i = versions.findIndex((v) => v._id === versionId);
                  if (i >= 0) setFocusIndex(i);
                }}
              />
            )}
          </div>

          {railOpen && focused !== undefined && (
            <RightRail
              productionId={productionId}
              shotId={shotId}
              version={focused}
            />
          )}
        </div>

        {/* Filmstrip */}
        {loading ? (
          <div className="flex h-24 shrink-0 items-stretch gap-2 border-t border-border px-3 py-2">
            <Skeleton className="aspect-video h-full" />
            <Skeleton className="aspect-video h-full" />
            <Skeleton className="aspect-video h-full" />
          </div>
        ) : (
          count > 0 && (
            <Filmstrip
              versions={versions}
              focusIndex={Math.min(focusIndex, count - 1)}
              clappedId={clappedId}
              onFocus={setFocusIndex}
            />
          )
        )}

        {/* Decision dialogs */}
        {focused !== undefined && shot !== undefined && (
          <PickDialog
            open={pickOpen}
            onOpenChange={setPickOpen}
            version={focused}
            shot={shot}
            onPicked={handlePicked}
          />
        )}
        {focused !== undefined && (
          <RejectDialog
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            version={focused}
          />
        )}
        <RoomHints open={hintsOpen} onOpenChange={setHintsOpen} />
      </div>
    </div>
  );
}

const HINTS: [string, string][] = [
  ["1–4", "Compare 1–4 up"],
  ["← →", "Move focus"],
  ["S", "Shortlist / unshortlist"],
  ["X", "Reject…"],
  ["P", "Pick…"],
  ["0", "Reset zoom"],
  ["F", "Fullscreen"],
  ["Esc", "Back to queue"],
];

function RoomHints({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark bg-popover text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="font-display">Review Room keys</DialogTitle>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {HINTS.map(([key, label]) => (
            <li key={key} className="flex items-center gap-3 text-sm">
              <kbd className="min-w-9 rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[11px]">
                {key}
              </kbd>
              {label}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Scroll zooms toward the cursor · drag pans · double-click resets —
          synced across every pane.
        </p>
      </DialogContent>
    </Dialog>
  );
}
