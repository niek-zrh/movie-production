"use client";

import { useParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { OverviewStageStrip } from "./_components/overview-stage-strip";
import { OverviewShotSummary } from "./_components/overview-shot-summary";
import { OverviewActivity } from "./_components/overview-activity";
import { OverviewDecisions } from "./_components/overview-decisions";
import { OverviewQuickLinks } from "./_components/overview-quick-links";
import { OverviewReportTeaser } from "./_components/overview-report-teaser";

/**
 * Production Overview (spec F3) — the producer's one screen. At 1440px
 * everything fits with at most one scroll: stage strip + shot summary +
 * activity on the left, decisions/links/report on the right.
 */
export default function ProductionOverviewPage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="mb-4 font-display text-xl font-semibold tracking-tight">
          Overview
        </h1>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
            <OverviewStageStrip productionId={productionId} />
            <OverviewShotSummary productionId={productionId} />
            <OverviewActivity productionId={productionId} />
          </div>
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
            <OverviewDecisions productionId={productionId} />
            <OverviewQuickLinks productionId={productionId} />
            <OverviewReportTeaser productionId={productionId} />
          </div>
        </div>
      </div>
    </main>
  );
}
