"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ClipboardCheck, Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { formatWhen } from "@/lib/format";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  DecisionBadge,
  SCOPE_IS_CODE,
  SCOPE_LABELS,
  ScopeBadge,
  type ApprovalScope,
} from "./approval-ui";

type LedgerRow = (typeof api.approvals.ledger._returnType)[number];

const SCOPE_FILTERS: { value: "all" | ApprovalScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "stage_gate", label: "Gates" },
  { value: "version", label: "Picks" },
  { value: "shot", label: "Shots" },
  { value: "delivery", label: "Delivery" },
];

const FILTERED_EMPTY: Record<ApprovalScope, string> = {
  stage_gate: "No gate decisions yet. Request sign-off from the board.",
  version: "No picks yet. Pick winning versions in the review room.",
  shot: "No shot sign-offs recorded yet.",
  delivery: "No delivery sign-offs yet. QC runs land here when they finish.",
};

/**
 * The decision ledger — every gate, pick and QC sign-off, newest first.
 * One filter click ("Gates") answers "who signed off stage 3 and when".
 */
export function LedgerSection({
  productionId,
  productionCode,
}: {
  productionId: Id<"productions">;
  productionCode: string | undefined;
}) {
  const [scope, setScope] = useState<"all" | ApprovalScope>("all");
  const ledger = useQuery(
    api.approvals.ledger,
    scope === "all" ? { productionId } : { productionId, scope },
  );

  const exportCsv = () => {
    if (!ledger || ledger.length === 0 || !productionCode) return;
    const blob = new Blob([toCsv(ledger)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${productionCode}-decisions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SCOPE_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={scope === f.value ? "default" : "outline"}
            onClick={() => setScope(f.value)}
          >
            {f.value === "stage_gate" && <ShieldCheck className="size-3.5" />}
            {f.label}
          </Button>
        ))}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!ledger || ledger.length === 0 || !productionCode}
          >
            <Download className="size-3.5" /> {copy.actions.exportCsv}
          </Button>
        </div>
      </div>

      {ledger === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : ledger.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={scope === "all" ? copy.empty.decisions : FILTERED_EMPTY[scope]}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">When</TableHead>
                <TableHead className="w-20">Scope</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="w-28">Decision</TableHead>
                <TableHead className="w-44">By</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.map((row) => (
                <LedgerTableRow key={row._id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function LedgerTableRow({ row }: { row: LedgerRow }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">
        {formatWhen(row.decidedAt ?? row._creationTime)}
      </TableCell>
      <TableCell>
        <ScopeBadge scope={row.scope} />
      </TableCell>
      <TableCell>
        <Link
          href={row.href}
          className={cn(
            "underline-offset-2 hover:underline",
            SCOPE_IS_CODE[row.scope] ? "font-mono text-xs" : "text-sm",
          )}
        >
          {row.targetLabel}
        </Link>
      </TableCell>
      <TableCell>
        <DecisionBadge status={row.status} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <UserAvatar
            name={row.approverUser.name}
            image={row.approverUser.image}
            className="size-5 text-[9px]"
          />
          <span className="max-w-32 truncate text-sm">
            {row.approverUser.name}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {row.note ? (
          <span
            className="block max-w-56 truncate text-xs text-muted-foreground"
            title={row.note}
          >
            {row.note}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/50">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------- CSV export ------------------------------- */

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function toCsv(rows: LedgerRow[]): string {
  const header = [
    "decidedAt",
    "scope",
    "target",
    "status",
    "requestedBy",
    "approver",
    "note",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.decidedAt !== undefined ? new Date(r.decidedAt).toISOString() : "",
        SCOPE_LABELS[r.scope],
        r.targetLabel,
        r.status,
        r.requestedByUser.name,
        r.approverUser.name,
        r.note ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
