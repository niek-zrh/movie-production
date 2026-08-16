"use client";

import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SlateStrip } from "@/components/app/slate-strip";
import { UserAvatar } from "@/components/app/user-avatar";
import type { ShotRow } from "./shots-common";

/** Grid view: cover thumb (or mono-code placeholder), slate strip, title, assignee. */
export function ShotsGrid({
  shots,
  productionId,
}: {
  shots: ShotRow[];
  productionId: Id<"productions">;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {shots.map((shot) => (
        <Link key={shot._id} href={`/p/${productionId}/shots/${shot._id}`}>
          <Card
            size="sm"
            className="h-full gap-0 p-0 transition-shadow duration-150 hover:shadow-md"
          >
            <SlateStrip code={shot.code} status={shot.status} />
            {shot.coverThumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shot.coverThumbUrl}
                alt={shot.code}
                className="aspect-video w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center bg-muted/50 font-mono text-xs text-muted-foreground">
                {shot.code}
              </div>
            )}
            <div className="flex flex-1 items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {shot.title ?? (
                    <span className="text-muted-foreground">Untitled</span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {shot.scene?.code ?? "No scene"} · {shot.versionsCount}{" "}
                  {shot.versionsCount === 1 ? "option" : "options"}
                </p>
              </div>
              {shot.assignee && (
                <UserAvatar
                  name={shot.assignee.name}
                  image={shot.assignee.image}
                  className="size-5 shrink-0"
                />
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
