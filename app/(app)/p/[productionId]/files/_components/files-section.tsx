"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  Link2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { copy } from "@/lib/copy";
import { formatAgo, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AssetRow = (typeof api.assets.listForProduction._returnType)[number];

/** Short, human line from a (possibly multiline) Convex error message. */
export function firstErrorLine(message: string): string {
  const uncaught = /Uncaught (?:[A-Za-z]*Error|ConvexError): ([^\n]+)/.exec(
    message,
  );
  const line = (uncaught?.[1] ?? message.split("\n")[0] ?? "").trim();
  return line.length > 0 ? line : "Something didn't work — try again";
}

function FileTypeIcon({ asset }: { asset: AssetRow }) {
  const mime = asset.mimeType ?? "";
  const Icon =
    asset.kind === "link"
      ? Link2
      : asset.kind === "folder"
        ? Folder
        : mime.startsWith("image/")
          ? FileImage
          : mime.startsWith("video/")
            ? FileVideo
            : mime.startsWith("audio/")
              ? FileAudio
              : mime.includes("pdf") ||
                  mime.startsWith("text/") ||
                  mime.includes("document")
                ? FileText
                : mime.includes("zip") || mime.includes("compressed")
                  ? FileArchive
                  : File;
  return <Icon className="size-4 text-muted-foreground" />;
}

/** One folder group: header with pretty label + count, then file rows. */
export function FilesSection({
  label,
  icon,
  assets,
  productionId,
  shotCodeById,
  canAttach,
  onAttach,
}: {
  label: string;
  icon?: ReactNode;
  assets: AssetRow[];
  productionId: Id<"productions">;
  shotCodeById: Map<string, string>;
  canAttach: boolean;
  onAttach: (asset: AssetRow) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted-foreground [&_svg]:size-3.5">
          {icon ?? <Folder />}
        </span>
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {assets.length}
        </span>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {assets.map((asset) => (
          <FileRow
            key={asset._id}
            asset={asset}
            productionId={productionId}
            shotCode={
              asset.shotId !== undefined
                ? shotCodeById.get(asset.shotId)
                : undefined
            }
            canAttach={canAttach}
            onAttach={onAttach}
          />
        ))}
      </div>
    </section>
  );
}

function FileRow({
  asset,
  productionId,
  shotCode,
  canAttach,
  onAttach,
}: {
  asset: AssetRow;
  productionId: Id<"productions">;
  shotCode: string | undefined;
  canAttach: boolean;
  onAttach: (asset: AssetRow) => void;
}) {
  const unassigned =
    asset.shotId === undefined &&
    asset.versionId === undefined &&
    asset.kind === "file";
  const when = formatAgo(asset.syncedAt ?? asset._creationTime);
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {asset.thumbUrl !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbUrl}
          alt=""
          className="size-9 shrink-0 rounded-md border object-cover"
        />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileTypeIcon asset={asset} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate font-mono text-[13px]",
              asset.missing === true && "text-muted-foreground",
            )}
          >
            {asset.name}
          </span>
          {asset.missing === true && (
            <Badge
              variant="outline"
              className="shrink-0 border-status-rework/30 bg-status-rework/10 text-[10px] text-status-rework"
            >
              {copy.errors.fileMissing}
            </Badge>
          )}
        </div>
        {/* Size + recency collapse under the name on narrow screens. */}
        <div className="mt-0.5 text-xs text-muted-foreground sm:hidden">
          {formatBytes(asset.sizeBytes)} · {when}
        </div>
      </div>

      {asset.shotId !== undefined && shotCode !== undefined && (
        <Badge
          variant="secondary"
          className="shrink-0 font-mono text-[10px]"
          render={<Link href={`/p/${productionId}/shots/${asset.shotId}`} />}
        >
          {shotCode}
        </Badge>
      )}

      {canAttach && unassigned && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => onAttach(asset)}
        >
          {copy.actions.attachToShot}
        </Button>
      )}

      <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
        {formatBytes(asset.sizeBytes)}
      </span>
      <span
        className="hidden w-24 shrink-0 truncate text-right text-xs text-muted-foreground sm:block"
        title={new Date(asset.syncedAt ?? asset._creationTime).toLocaleString()}
      >
        {when}
      </span>

      {asset.fileUrl !== null ? (
        <a
          href={asset.fileUrl}
          target="_blank"
          rel="noreferrer"
          title={
            asset.provider === "gdrive" ? copy.actions.openInDrive : "Open file"
          }
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-xs" }),
            "shrink-0 text-muted-foreground",
          )}
        >
          <ExternalLink />
          <span className="sr-only">
            {asset.provider === "gdrive"
              ? copy.actions.openInDrive
              : "Open file"}
          </span>
        </a>
      ) : (
        <span aria-hidden className="size-6 shrink-0" />
      )}
    </div>
  );
}
