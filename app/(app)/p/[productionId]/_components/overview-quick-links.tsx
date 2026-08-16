"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import {
  ArrowUpRight,
  FileSpreadsheet,
  Link2,
  PenTool,
  Presentation,
  Send,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudio } from "@/components/app/studio-context";

type ExternalLink = (typeof api.externalLinks.list._returnType)[number];

const KIND_ICONS: Record<ExternalLink["kind"], LucideIcon> = {
  sheet: FileSpreadsheet,
  figma: PenTool,
  miro: Presentation,
  telegram: Send,
  other: Link2,
};

/** Quick links: the production's sheet/Figma/Miro/chat, opened in a new tab. */
export function OverviewQuickLinks({
  productionId,
}: {
  productionId: Id<"productions">;
}) {
  const links = useQuery(api.externalLinks.list, { productionId });
  const { role } = useStudio();
  const canManage = role === "owner" || role === "producer";

  return (
    <Card className="gap-3 p-4">
      <h2 className="text-sm font-semibold">Quick links</h2>

      {links === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No links yet.{" "}
          {canManage ? (
            <>
              Add the sheet, Figma board or chat in{" "}
              <Link
                href={`/p/${productionId}/settings`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Settings
              </Link>
              .
            </>
          ) : (
            "A producer can add the sheet, Figma board or chat in Settings."
          )}
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {links.map((link) => {
            const Icon = KIND_ICONS[link.kind];
            return (
              <li key={link._id}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-120 hover:bg-muted/60"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{link.title}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-120 group-hover:opacity-100" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
