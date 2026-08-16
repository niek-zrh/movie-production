"use client";

import { useEffect, useRef } from "react";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isImageVersion,
  VERSION_DOT,
  VERSION_STATUS_LABEL,
  type VersionCard,
} from "./review-utils";

/**
 * Bottom filmstrip: every version as a thumb tile. Shortlisted = ring,
 * rejected = desaturated, picked = tape ring, focused = tape border.
 */
export function Filmstrip({
  versions,
  focusIndex,
  clappedId,
  onFocus,
}: {
  versions: VersionCard[];
  focusIndex: number;
  clappedId: string | null;
  onFocus: (index: number) => void;
}) {
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    tileRefs.current[focusIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [focusIndex]);

  return (
    <div className="h-24 shrink-0 border-t border-border bg-background">
      <div className="flex h-full items-stretch gap-2 overflow-x-auto px-3 py-2">
        {versions.map((version, i) => {
          const focused = i === focusIndex;
          return (
            <button
              key={version._id}
              ref={(el) => {
                tileRefs.current[i] = el;
              }}
              type="button"
              onClick={() => onFocus(i)}
              title={`v${version.index} — ${VERSION_STATUS_LABEL[version.status]}`}
              className={cn(
                "relative aspect-video h-full shrink-0 overflow-hidden rounded-md border bg-[#0E0F12] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                focused ? "border-tape" : "border-border",
                version.status === "shortlisted" &&
                  "ring-1 ring-foreground/60",
                version.status === "picked" && "ring-2 ring-tape",
                version.status === "rejected" && "opacity-40 saturate-0",
                version._id === clappedId && "slate-clap",
              )}
            >
              {version.asset?.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={version.asset.thumbUrl}
                  alt={`v${version.index}`}
                  draggable={false}
                  className={cn(
                    "size-full object-cover",
                    !isImageVersion(version) && "opacity-60",
                  )}
                />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <Film className="size-4" />
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
                v{version.index}
              </span>
              <span
                className={cn(
                  "absolute right-1 top-1 size-1.5 rounded-full ring-1 ring-black/40",
                  VERSION_DOT[version.status],
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
