import { cn } from "@/lib/utils";
import type { ShotStatusKey } from "@/convex/lib/domain";
import { STATUS_VAR, StatusPill } from "./status-pill";
import type { CSSProperties, ReactNode } from "react";

/**
 * The signature element (spec §9.2): a slim clapperboard band on every shot
 * and version card. Mono code left, status right, 2px status-colored top edge.
 */
export function SlateStrip({
  code,
  status,
  right,
  className,
  clap = false,
}: {
  code: string;
  status?: ShotStatusKey;
  right?: ReactNode;
  className?: string;
  clap?: boolean;
}) {
  const style = status
    ? ({ "--strip-color": STATUS_VAR[status] } as CSSProperties)
    : undefined;
  return (
    <div
      className={cn("slate-strip", clap && "slate-clap", className)}
      style={style}
    >
      <span className="truncate text-muted-foreground">{code}</span>
      {right ?? (status ? <StatusPill status={status} size="xs" /> : null)}
    </div>
  );
}
