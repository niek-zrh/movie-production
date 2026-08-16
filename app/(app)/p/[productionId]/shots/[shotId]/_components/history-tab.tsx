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
 * Shot history (spec F6): the production activity feed filtered client-side
 * to rows targeting this shot or mentioning its code in the summary.
 */
export function HistoryTab({
  productionId,
  shotId,
  shotCode,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  shotCode: string;
}) {
  const feed = useQuery(api.activity.feed, { productionId, limit: 100 });

  if (feed === undefined) {
    return (
      <div className="max-w-2xl space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  const rows = feed.filter(
    (row) => row.targetId === shotId || row.summary.includes(shotCode),
  );

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
