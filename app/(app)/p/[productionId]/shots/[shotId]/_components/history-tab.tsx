"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/format";

/**
 * Shot history (spec F6): the activity rows of this shot and its options,
 * queried by target. It used to filter the last 100 production-wide rows
 * client-side, which meant an empty tab on any production busy enough for the
 * shot's own rows to fall outside that window.
 */
export function HistoryTab({
  productionId,
  shotId,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  /** Still accepted from the shot page; the rows are matched by target now. */
  shotCode?: string;
}) {
  const rows = useQuery(api.activity.forTarget, {
    productionId,
    targetType: "shot",
    targetId: shotId,
    limit: 100,
  });

  if (rows === undefined) {
    return (
      <div className="max-w-2xl space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState icon={<History />} title={copy.empty.activity} />;
  }

  return (
    <ol className="max-w-2xl space-y-3">
      {rows.map((row) => (
        <li key={row._id} className="flex items-start gap-2.5">
          <UserAvatar
            name={row.actor.name}
            image={row.actor.image}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm">{row.summary}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatWhen(row._creationTime)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
