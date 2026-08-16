"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewRunDialog } from "./_components/new-run-dialog";
import { TemplateSection } from "./_components/template-section";
import { RUN_STATUS_META, RunStatusBadge } from "./_components/qc-shared";

/** Delivery QC (spec F11): masters checked against the studio template. */
export default function QcPage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const { role } = useStudio();
  // qc.run capability: owner / producer / creative_director / supervisor.
  const canRunQc =
    role === "owner" ||
    role === "producer" ||
    role === "creative_director" ||
    role === "supervisor";

  const runs = useQuery(api.qc.listRuns, { productionId });

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Delivery QC
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Check masters against the studio template before they ship.
            </p>
          </div>
          {canRunQc && <NewRunDialog productionId={productionId} />}
        </div>

        {runs === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-[72px]" />
            <Skeleton className="h-[72px]" />
            <Skeleton className="h-[72px]" />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />} title={copy.empty.qcRuns}>
            {canRunQc && <NewRunDialog productionId={productionId} />}
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {runs.map((run) => (
              <li key={run._id}>
                <Link href={`/p/${productionId}/qc/${run._id}`}>
                  <Card className="flex-row items-center gap-3 p-4 transition-shadow duration-150 hover:shadow-md">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {run.name}
                        </span>
                        <RunStatusBadge status={run.status} />
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <RunProgressBar
                          done={run.progress.done}
                          total={run.progress.total}
                          status={run.status}
                        />
                        <span className="tabular-nums">
                          {run.progress.done}/{run.progress.total} checked
                        </span>
                        <span aria-hidden>·</span>
                        <span>started {formatWhen(run._creationTime)}</span>
                      </div>
                    </div>
                    <UserAvatar
                      name={run.startedByUser.name}
                      image={run.startedByUser.image}
                      className="shrink-0"
                    />
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <TemplateSection />
      </div>
    </main>
  );
}

function RunProgressBar({
  done,
  total,
  status,
}: {
  done: number;
  total: number;
  status: keyof typeof RUN_STATUS_META;
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          RUN_STATUS_META[status].dotClasses,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
