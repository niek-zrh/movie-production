"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { Film } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { StatusPill, STATUS_DOT_CLASSES } from "@/components/app/status-pill";
import { SHOT_STATUSES } from "@/convex/lib/domain";
import { copy } from "@/lib/copy";

/**
 * Shot status summary: one segmented bar over all shots plus a count chip
 * per status, each deep-linking to the filtered shots list.
 */
export function OverviewShotSummary({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const shots = useQuery(api.shots.list, { productionId });

  const byStatus: Record<string, number> = {};
  for (const shot of shots ?? []) {
    byStatus[shot.status] = (byStatus[shot.status] ?? 0) + 1;
  }
  const total = shots?.length ?? 0;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Shots</h2>
        {shots !== undefined && total > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            {total} total
          </span>
        )}
      </div>

      {shots === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-2 rounded-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<Film />}
          title={copy.empty.shots}
          className="px-4 py-8"
        >
          <Link
            href={`/p/${productionId}/shots`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open shots
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {SHOT_STATUSES.map(({ key }) => {
              const count = byStatus[key] ?? 0;
              if (count === 0) return null;
              return (
                <div
                  key={key}
                  className={STATUS_DOT_CLASSES[key]}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${SHOT_STATUSES.find((s) => s.key === key)?.label}: ${count}`}
                />
              );
            })}
          </div>
          <div className="-mx-1 flex flex-wrap gap-x-1 gap-y-1.5">
            {SHOT_STATUSES.map(({ key }) => {
              const count = byStatus[key] ?? 0;
              if (count === 0) return null;
              return (
                <Link
                  key={key}
                  href={`/p/${productionId}/shots?status=${key}`}
                  className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-120 hover:bg-muted"
                >
                  <StatusPill status={key} size="xs" />
                  <span className="text-xs tabular-nums text-muted-foreground group-hover:text-foreground">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
