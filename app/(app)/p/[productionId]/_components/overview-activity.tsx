"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/format";

/**
 * Today's activity: the latest 15 rows of the production feed — actor,
 * server-written summary rendered as-is, and a compact timestamp.
 */
export function OverviewActivity({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const rows = useQuery(api.activity.feed, { productionId, limit: 15 });

  return (
    <Card className="gap-3 p-4">
      <h2 className="text-sm font-semibold">Today&apos;s activity</h2>

      {rows === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title={copy.empty.activity}
          className="px-4 py-8"
        />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {rows.map((row) => (
            <li
              key={row._id}
              className="flex items-start gap-2.5 rounded-md px-1 py-1"
            >
              <UserAvatar
                name={row.actor.name}
                image={row.actor.image}
                className="mt-px size-5 shrink-0 text-[9px]"
              />
              <p className="min-w-0 flex-1 text-sm leading-snug">
                {row.summary}
              </p>
              <span className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground">
                {formatWhen(row._creationTime)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
