"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatWhen } from "@/lib/format";

/**
 * "Needs your decision" — my pending approvals in this production, with the
 * tape-orange left edge (this is a primary decision moment). Renders nothing
 * while loading and nothing when the list is empty.
 */
export function OverviewDecisions({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const pending = useQuery(api.approvals.myPending, {});
  const mine = (pending ?? []).filter((a) => a.productionId === productionId);

  if (pending === undefined || mine.length === 0) return null;

  return (
    <Card className="gap-3 border-l-2 border-l-tape p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Needs your decision</h2>
        <Badge variant="secondary">{mine.length}</Badge>
      </div>
      <ul className="-mx-2 divide-y divide-border/60">
        {mine.map((approval) => (
          <li key={approval._id}>
            <Link
              href={approval.href}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors duration-120 hover:bg-muted/60"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {approval.targetLabel}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatWhen(approval._creationTime)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
