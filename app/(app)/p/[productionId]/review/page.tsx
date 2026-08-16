"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Clapperboard, ImageIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { SlateStrip } from "@/components/app/slate-strip";
import { UserAvatar } from "@/components/app/user-avatar";
import { copy } from "@/lib/copy";
import { todayInTz } from "@/lib/format";
import { cn } from "@/lib/utils";

type ShotCard = (typeof api.shots.list._returnType)[number];

export default function ReviewQueuePage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;

  const shots = useQuery(api.shots.list, { productionId });
  const production = useQuery(api.productions.get, { productionId });
  const pickActivity = useQuery(api.activity.feed, {
    productionId,
    types: ["version.picked"],
    limit: 100,
  });

  const queue = useMemo(() => {
    if (!shots) return undefined;
    return shots
      .filter((s) => s.status === "options_ready" || s.status === "in_review")
      .sort(
        (a, b) =>
          (a.scene?.code ?? "").localeCompare(b.scene?.code ?? "") ||
          a.order - b.order,
      );
  }, [shots]);

  const decidedToday = useMemo(() => {
    if (!shots || !pickActivity || !production) return [];
    const tz = production.timezone;
    const today = todayInTz(tz);
    const pickedTodayVersionIds = new Set(
      pickActivity
        .filter(
          (row) =>
            formatInTimeZone(new Date(row._creationTime), tz, "yyyy-MM-dd") ===
            today,
        )
        .map((row) => row.targetId),
    );
    return shots
      .filter(
        (s) =>
          s.pickedVersionId !== undefined &&
          pickedTodayVersionIds.has(s.pickedVersionId),
      )
      .sort(
        (a, b) =>
          (a.scene?.code ?? "").localeCompare(b.scene?.code ?? "") ||
          a.order - b.order,
      );
  }, [shots, pickActivity, production]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Review
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Options waiting for a decision. Open a shot to compare and pick.
        </p>
      </div>

      {queue === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      ) : queue.length === 0 ? (
        <EmptyState icon={<Clapperboard />} title={copy.empty.review} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {queue.map((shot) => (
            <QueueCard
              key={shot._id}
              shot={shot}
              href={`/p/${productionId}/review/${shot._id}`}
            />
          ))}
        </div>
      )}

      {decidedToday.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Decided today
          </h2>
          <div className="grid gap-4 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
            {decidedToday.map((shot) => (
              <QueueCard
                key={shot._id}
                shot={shot}
                href={`/p/${productionId}/review/${shot._id}`}
                muted
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function QueueCard({
  shot,
  href,
  muted = false,
}: {
  shot: ShotCard;
  href: string;
  muted?: boolean;
}) {
  return (
    <Link href={href} className="group">
      <Card
        className={cn(
          "h-full gap-0 p-0 transition-shadow duration-150 group-hover:shadow-md",
          muted && "saturate-50",
        )}
      >
        <SlateStrip code={shot.code} status={shot.status} />
        <div className="relative aspect-video overflow-hidden bg-muted">
          {shot.coverThumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot.coverThumbUrl}
              alt={shot.code}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-6" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {shot.title ?? shot.code}
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{shot.versionsCount}</span>{" "}
              {shot.versionsCount === 1 ? "option" : "options"}
              {shot.scene ? (
                <>
                  {" "}
                  · <span className="font-mono">{shot.scene.code}</span>
                </>
              ) : null}
            </p>
          </div>
          {shot.assignee && (
            <UserAvatar
              name={shot.assignee.name}
              image={shot.assignee.image}
              className="shrink-0"
            />
          )}
        </div>
      </Card>
    </Link>
  );
}
