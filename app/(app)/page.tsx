"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import Link from "next/link";
import { Plus, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { useStudio } from "@/components/app/studio-context";
import { STATUS_DOT_CLASSES } from "@/components/app/status-pill";
import { SHOT_STATUSES, type ShotStatusKey } from "@/convex/lib/domain";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export default function StudioHomePage() {
  const { studioId, role } = useStudio();
  const productions = useQuery(
    api.productions.listForStudio,
    studioId ? { studioId } : "skip",
  );
  const canManage = role === "owner" || role === "producer";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Productions
        </h1>
        {canManage && (
          <Link href="/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="size-4" /> {copy.actions.newProduction}
          </Link>
        )}
      </div>

      {productions === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : productions.length === 0 ? (
        <EmptyState title={copy.empty.productions}>
          {canManage && (
            <Link href="/new" className={buttonVariants({ size: "sm" })}>
              <Plus className="size-4" /> {copy.actions.newProduction}
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {productions.map((p) => (
            <Link key={p._id} href={`/p/${p._id}`}>
              <Card className="h-full gap-3 p-5 transition-shadow duration-150 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-semibold leading-tight">
                      {p.name}
                    </h2>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {p.code} · {p.kind === "episodic" ? "Series" : "Feature"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {p.hubConnected && (
                      <HardDrive className="size-3.5 text-muted-foreground" />
                    )}
                    <Badge
                      variant={p.status === "active" ? "secondary" : "outline"}
                      className="capitalize"
                    >
                      {p.status}
                    </Badge>
                  </div>
                </div>
                <ShotBar byStatus={p.shotCounts.byStatus} total={p.shotCounts.total} />
                <p className="text-xs text-muted-foreground">
                  {/* listForStudio bounds how many shots it counts per
                      production, so say "800+" rather than showing a
                      saturated count as if it were the real one. */}
                  {p.shotCounts.total}
                  {p.shotCountsCapped ? "+" : ""} shots
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

function ShotBar({
  byStatus,
  total,
}: {
  byStatus: Record<string, number>;
  total: number;
}) {
  if (total === 0)
    return <div className="h-1.5 rounded-full bg-muted" aria-hidden />;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
      {SHOT_STATUSES.map(({ key }) => {
        const count = byStatus[key] ?? 0;
        if (count === 0) return null;
        return (
          <div
            key={key}
            className={cn(STATUS_DOT_CLASSES[key as ShotStatusKey])}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${key}: ${count}`}
          />
        );
      })}
    </div>
  );
}
