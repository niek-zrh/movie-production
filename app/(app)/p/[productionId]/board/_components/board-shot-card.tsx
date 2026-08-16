"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { SlateStrip } from "@/components/app/slate-strip";
import { UserAvatar } from "@/components/app/user-avatar";
import { cn } from "@/lib/utils";
import {
  formatDueDate,
  SHOT_DRAG_TYPE,
  type BoardShot,
} from "./board-helpers";

function optionsLabel(count: number): string {
  if (count === 0) return "No options";
  return count === 1 ? "1 option" : `${count} options`;
}

export function BoardShotCard({
  shot,
  canDrag,
}: {
  shot: BoardShot;
  canDrag: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <Link
      href={`/p/${shot.productionId}/shots/${shot._id}`}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        e.dataTransfer.setData(SHOT_DRAG_TYPE, shot._id);
        e.dataTransfer.setData("text/plain", shot.code);
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "block overflow-hidden rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-md",
        canDrag && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <SlateStrip code={shot.code} status={shot.status} />
      <div className="space-y-2 px-2.5 py-2">
        {shot.title ? (
          <p className="line-clamp-2 text-[13px] leading-snug">{shot.title}</p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span className="whitespace-nowrap">
              {optionsLabel(shot.versionsCount)}
            </span>
            {shot.dueDate ? (
              <span className="flex items-center gap-1 whitespace-nowrap">
                <CalendarDays className="size-3" />
                {formatDueDate(shot.dueDate)}
              </span>
            ) : null}
          </div>
          {shot.assignee ? (
            <span title={shot.assignee.name} className="shrink-0">
              <UserAvatar
                name={shot.assignee.name}
                image={shot.assignee.image}
                className="size-5 text-[9px]"
              />
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
