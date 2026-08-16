"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  FileVideo,
  XCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStudio } from "@/components/app/studio-context";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckRow } from "../_components/check-row";
import { RunComments } from "../_components/run-comments";
import { QC_CATEGORIES, RunStatusBadge } from "../_components/qc-shared";

/** One QC run (spec F11): the checklist that decides whether a master ships. */
export default function QcRunPage() {
  const params = useParams<{ productionId: string; qcRunId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const qcRunId = params.qcRunId as Id<"qcRuns">;
  const { role } = useStudio();
  // qc.run capability: owner / producer / creative_director / supervisor.
  const canRun =
    role === "owner" ||
    role === "producer" ||
    role === "creative_director" ||
    role === "supervisor";

  const run = useQuery(api.qc.getRun, { qcRunId });

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href={`/p/${productionId}/qc`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> All QC runs
        </Link>

        {run === undefined ? (
          <RunSkeleton />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-xl font-semibold tracking-tight">
                {run.name}
              </h1>
              <RunStatusBadge status={run.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>Started {formatWhen(run._creationTime)}</span>
              {run.master && (
                <>
                  <span aria-hidden>·</span>
                  <MasterLink
                    name={run.master.name}
                    href={run.master.webViewLink ?? run.master.url}
                  />
                </>
              )}
            </div>

            <StatusBanner run={run} />

            <TooltipProvider>
              <div className="mt-6 space-y-6">
                {QC_CATEGORIES.map(({ key, label }) => {
                  const group = run.checks.filter(
                    (c) => c.parameter.category === key,
                  );
                  if (group.length === 0) return null;
                  const done = group.filter(
                    (c) => c.result !== "pending",
                  ).length;
                  return (
                    <section key={key}>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {label}
                        </h2>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {done}/{group.length}
                        </span>
                      </div>
                      <ul className="divide-y rounded-lg border bg-card">
                        {group.map((check) => (
                          <CheckRow
                            key={check._id}
                            check={check}
                            canRun={canRun}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </TooltipProvider>

            <RunComments productionId={productionId} qcRunId={qcRunId} />
          </>
        )}
      </div>
    </main>
  );
}

type RunDetail = NonNullable<(typeof api.qc.getRun)["_returnType"]>;

function StatusBanner({ run }: { run: RunDetail }) {
  const done = run.checks.filter((c) => c.result !== "pending").length;
  const total = run.checks.length;
  const failingRequired = run.checks.filter(
    (c) => c.parameter.required && c.result === "fail",
  ).length;

  const banner =
    run.status === "failed"
      ? {
          classes: "border-destructive/25 bg-destructive/10 text-destructive",
          icon: <XCircle className="size-5" />,
          title: "Master failed QC — fix and re-check",
          sub: `${failingRequired} required check${failingRequired === 1 ? "" : "s"} failing${
            run.completedAt !== undefined
              ? ` · ${formatWhen(run.completedAt)}`
              : ""
          }`,
        }
      : run.status === "passed"
        ? {
            classes:
              "border-status-approved/25 bg-status-approved/10 text-status-approved",
            icon: <CheckCircle2 className="size-5" />,
            title: "Passed — ready for delivery",
            sub:
              run.completedAt !== undefined
                ? `Completed ${formatWhen(run.completedAt)}`
                : undefined,
          }
        : {
            classes:
              "border-status-options_ready/25 bg-status-options_ready/10 text-status-options_ready",
            icon: <CircleDashed className="size-5" />,
            title: "QC in progress",
            sub: "All required checks must pass before this master can ship.",
          };

  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div
      className={cn(
        "mt-4 flex items-center gap-3 rounded-lg border px-4 py-3",
        banner.classes,
      )}
    >
      <span className="shrink-0">{banner.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{banner.title}</p>
        {banner.sub && (
          <p className="mt-0.5 text-xs opacity-80">{banner.sub}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-xs font-medium tabular-nums">
          {done}/{total} checked
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-current/15">
          <div
            className="h-full rounded-full bg-current transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MasterLink({ name, href }: { name: string; href?: string }) {
  const label = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <FileVideo className="size-3.5 shrink-0" />
      <span className="truncate font-mono">{name}</span>
    </span>
  );
  if (!href) return label;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground"
    >
      {label}
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

function RunSkeleton() {
  return (
    <div>
      <Skeleton className="h-7 w-64 max-w-full" />
      <Skeleton className="mt-2 h-4 w-44" />
      <Skeleton className="mt-4 h-16" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
