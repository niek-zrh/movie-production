"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NeedsDecision } from "./_components/needs-decision";
import { LedgerSection } from "./_components/ledger-table";

/**
 * Decisions (spec F9) — the audit trail as a feature. Pending approvals up
 * top (gates decide inline), the full ledger below with scope filters and
 * CSV export.
 */
export default function DecisionsPage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const production = useQuery(api.productions.get, { productionId });

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Decisions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who decided what, when — gates, picks, shots and delivery
            sign-offs.
          </p>
        </div>

        <NeedsDecision productionId={productionId} />
        <LedgerSection
          productionId={productionId}
          productionCode={production?.code}
        />
      </div>
    </main>
  );
}
