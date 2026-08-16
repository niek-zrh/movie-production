"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/lib/copy";
import { formatDay } from "@/lib/format";

function n(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Latest daily report teaser: date + stats one-liner, linking to Reports. */
export function OverviewReportTeaser({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const reports = useQuery(api.reports.list, { productionId });
  const latest = reports?.[0];

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Daily report</h2>
        {latest?.publishedBy && <Badge variant="outline">Published</Badge>}
      </div>

      {reports === undefined ? (
        <Skeleton className="h-10" />
      ) : latest === undefined ? (
        <p className="text-sm text-muted-foreground">{copy.empty.reports}</p>
      ) : (
        <Link
          href={`/p/${productionId}/reports`}
          className="group -mx-2 -my-1 rounded-md px-2 py-1.5 transition-colors duration-120 hover:bg-muted/60"
        >
          <p className="text-sm font-medium group-hover:underline group-hover:underline-offset-2">
            {formatDay(latest.date)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {n(latest.stats.picks, "pick")} ·{" "}
            {n(latest.stats.versionsAdded, "version")} ·{" "}
            {n(latest.stats.gatesDecided, "gate")}
          </p>
        </Link>
      )}
    </Card>
  );
}
