"use client";

import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";

type ReportStats = Doc<"dailyReports">["stats"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Compressed stats line for the list: the three most telling numbers. */
function microLine(stats: ReportStats): string {
  const total =
    stats.versionsAdded +
    stats.picks +
    stats.rejections +
    stats.shotsMoved +
    stats.commentsAdded +
    stats.gatesDecided;
  if (total === 0) return "Quiet day";
  return `${plural(stats.versionsAdded, "version")} · ${plural(stats.picks, "pick")} · ${stats.shotsMoved} moved`;
}

export function ReportList({
  reports,
  activeId,
  onSelect,
}: {
  reports: Doc<"dailyReports">[];
  activeId: Id<"dailyReports"> | null;
  onSelect: (id: Id<"dailyReports">) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {reports.map((report) => {
        const active = report._id === activeId;
        return (
          <li key={report._id}>
            <button
              type="button"
              onClick={() => onSelect(report._id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-foreground/20 bg-card shadow-sm"
                  : "border-transparent hover:bg-muted",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {formatDay(report.date)}
                </span>
                {report.publishedBy !== undefined && (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    Published
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {microLine(report.stats)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
