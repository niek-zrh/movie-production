"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Lock, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import { copy } from "@/lib/copy";
import { formatDay, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { showMutationError } from "./mutation-error";

const STAT_TILES: {
  key: keyof Doc<"dailyReports">["stats"];
  label: string;
}[] = [
  { key: "versionsAdded", label: "Versions added" },
  { key: "picks", label: "Picks" },
  { key: "rejections", label: "Rejections" },
  { key: "shotsMoved", label: "Shots moved" },
  { key: "commentsAdded", label: "Comments" },
  { key: "gatesDecided", label: "Gates decided" },
];

export function ReportDetail({
  reportId,
  canPublish,
}: {
  reportId: Id<"dailyReports">;
  canPublish: boolean;
}) {
  const report = useQuery(api.reports.get, { reportId });
  const publish = useMutation(api.reports.publish);
  const { studioId } = useStudio();
  const team = useQuery(
    api.studios.team,
    report?.publishedBy !== undefined && studioId ? { studioId } : "skip",
  );
  const [publishing, setPublishing] = useState(false);

  if (report === undefined) return <DetailSkeleton />;

  const published = report.publishedBy !== undefined;
  const publisherName =
    team?.find((m) => m.userId === report.publishedBy)?.name ??
    report.dayActivity.find((a) => a.actor._id === report.publishedBy)?.actor
      .name;

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await publish({ reportId });
      toast.success("Report published — the team has been notified");
    } catch (e) {
      showMutationError(e);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            {formatDay(report.date)}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Generated {formatWhen(report.generatedAt)}</span>
            <span aria-hidden>·</span>
            {published ? (
              <Badge variant="secondary">
                Published{publisherName ? ` by ${publisherName}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline">Draft</Badge>
            )}
          </div>
        </div>
        {published ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" /> Published reports are frozen
          </p>
        ) : canPublish ? (
          <Button size="sm" onClick={handlePublish} disabled={publishing}>
            <Send className="size-4" /> {copy.actions.publishReport}
          </Button>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STAT_TILES.map(({ key, label }) => (
          <div key={key} className="rounded-lg border bg-card px-3 py-2.5">
            <div
              className={cn(
                "font-display text-2xl font-semibold tabular-nums",
                key === "picks" && report.stats.picks > 0 && "text-tape",
              )}
            >
              {report.stats[key]}
            </div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <section className="mt-7">
        <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Highlights
        </h3>
        {report.highlights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            A quiet day — nothing to highlight.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {report.highlights.map((highlight, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-sm leading-snug"
              >
                <span
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-foreground/40"
                  aria-hidden
                />
                {highlight}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Full day
        </h3>
        {report.dayActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.empty.activity}</p>
        ) : (
          <ol className="space-y-2.5">
            {report.dayActivity.map((row) => (
              <li key={row._id} className="flex items-start gap-2.5">
                <UserAvatar
                  name={row.actor.name}
                  image={row.actor.image}
                  className="mt-px"
                />
                <p className="min-w-0 flex-1 text-sm leading-snug">
                  {row.summary}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatWhen(row._creationTime)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="h-7 w-72 max-w-full" />
      <Skeleton className="mt-2.5 h-4 w-44" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[62px]" />
        ))}
      </div>
      <div className="mt-7 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}
