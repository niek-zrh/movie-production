"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ExternalLink, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { copy } from "@/lib/copy";
import { formatBytes, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";

type AssetRow = (typeof api.assets.listForShot._returnType)[number];

const PROVIDER_LABEL: Record<AssetRow["provider"], string> = {
  gdrive: "Drive",
  storage: "App",
  url: "Link",
};

export function FilesTab({ shotId }: { shotId: Id<"shots"> }) {
  const assets = useQuery(api.assets.listForShot, { shotId });

  if (assets === undefined) return <Skeleton className="h-48 w-full" />;

  if (assets.length === 0) {
    return <EmptyState icon={<FolderOpen />} title={copy.empty.files} />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Size</TableHead>
            <TableHead className="w-20">Source</TableHead>
            <TableHead className="w-40">State</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((asset) => (
            <TableRow key={asset._id}>
              <TableCell>
                <span
                  className={cn(
                    "block max-w-72 truncate font-mono text-xs",
                    asset.missing === true && "text-muted-foreground",
                  )}
                  title={asset.name}
                >
                  {asset.name}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatBytes(asset.sizeBytes)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={asset.provider === "gdrive" ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  {PROVIDER_LABEL[asset.provider]}
                </Badge>
              </TableCell>
              <TableCell>
                {asset.missing === true ? (
                  <Badge variant="destructive" className="text-[10px]">
                    {copy.errors.fileMissing}
                  </Badge>
                ) : asset.syncedAt !== undefined ? (
                  <span className="text-xs text-muted-foreground">
                    Synced {formatWhen(asset.syncedAt)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {asset.fileUrl && (
                  <a
                    href={asset.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${asset.name}`}
                    className={buttonVariants({
                      variant: "ghost",
                      size: "icon-xs",
                    })}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
