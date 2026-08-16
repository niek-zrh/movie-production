"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Columns3,
  FileText,
  Film,
  FolderOpen,
  LayoutDashboard,
  MonitorPlay,
  Settings,
  ShieldCheck,
  Stamp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

const TABS = [
  { href: "", label: copy.nav.overview, icon: LayoutDashboard, exact: true },
  { href: "/board", label: copy.nav.board, icon: Columns3 },
  { href: "/shots", label: copy.nav.shots, icon: Film },
  { href: "/review", label: copy.nav.review, icon: MonitorPlay },
  { href: "/files", label: copy.nav.files, icon: FolderOpen },
  { href: "/decisions", label: copy.nav.decisions, icon: Stamp },
  { href: "/reports", label: copy.nav.reports, icon: FileText },
  { href: "/qc", label: copy.nav.qc, icon: ShieldCheck },
  { href: "/settings", label: copy.nav.settings, icon: Settings },
];

export function ProductionRail({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const pathname = usePathname();
  const production = useQuery(api.productions.get, { productionId });
  const base = `/p/${productionId}`;

  return (
    <aside className="sticky top-12 flex h-[calc(100vh-3rem)] w-44 shrink-0 flex-col border-r bg-sidebar">
      <div className="border-b px-3 py-3">
        <p className="truncate text-sm font-medium leading-tight">
          {production?.name ?? "…"}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {production?.code ?? ""}
          {production?.kind === "episodic" ? " · Series" : ""}
        </p>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const active = tab.exact
            ? pathname === href
            : pathname.startsWith(href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-120",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
