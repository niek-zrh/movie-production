"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ExternalLink, Film, GitCompare, ImageIcon, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { SlateStrip } from "@/components/app/slate-strip";
import { STATUS_VAR } from "@/components/app/status-pill";
import { UploadDropzone } from "@/components/app/upload-dropzone";
import type { ShotStatusKey } from "@/convex/lib/domain";
import { formatWhen } from "@/lib/format";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { AttachFromDrive } from "./attach-from-drive";
import { showMutationError } from "./error-toast";

type VersionRow = (typeof api.versions.listForShot._returnType)[number];

/** Version statuses borrow shot-status hues for the slate strip edge. */
const STRIP_STATUS: Record<VersionRow["status"], ShotStatusKey> = {
  candidate: "planned",
  shortlisted: "in_review",
  picked: "picked",
  rejected: "killed",
};

const VERSION_LABEL: Record<VersionRow["status"], string> = {
  candidate: "Candidate",
  shortlisted: "Shortlisted",
  picked: "Picked",
  rejected: "Rejected",
};

export function OptionsTab({
  productionId,
  shotId,
  productionCode,
  shotCode,
  canDecide,
  canUpload,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  productionCode: string;
  shotCode: string;
  canDecide: boolean;
  canUpload: boolean;
}) {
  const versions = useQuery(api.versions.listForShot, { shotId });

  if (versions === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (versions.length === 0 && !canUpload) {
    return (
      <EmptyState
        icon={<ImageIcon />}
        title="No options yet. They appear here as soon as someone adds one."
      />
    );
  }

  return (
    <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {versions.map((version) => (
        <VersionCard
          key={version._id}
          version={version}
          productionId={productionId}
          shotId={shotId}
          productionCode={productionCode}
          shotCode={shotCode}
          canDecide={canDecide}
        />
      ))}
      {canUpload && (
        <div className="flex flex-col gap-2">
          <UploadDropzone productionId={productionId} shotId={shotId} />
          <AttachFromDrive productionId={productionId} shotId={shotId} />
        </div>
      )}
    </div>
  );
}

function VersionCard({
  version,
  productionId,
  shotId,
  productionCode,
  shotCode,
  canDecide,
}: {
  version: VersionRow;
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  productionCode: string;
  shotCode: string;
  canDecide: boolean;
}) {
  const shortlist = useMutation(api.versions.shortlist);
  const stripStatus = STRIP_STATUS[version.status];
  const openUrl = version.asset?.fileUrl ?? version.asset?.webViewLink ?? null;
  const decided = version.status === "picked" || version.status === "rejected";

  return (
    <Card
      size="sm"
      className={cn(
        "gap-0 py-0",
        version.status === "rejected" && "opacity-60 grayscale",
        version.status === "picked" && "ring-2 ring-tape/50",
      )}
    >
      <SlateStrip
        code={`v${version.index} · ${productionCode} ${shotCode}`}
        status={stripStatus}
        right={
          <span
            className="flex shrink-0 items-center gap-1 font-medium"
            style={{ color: STATUS_VAR[stripStatus] }}
          >
            {version.status === "shortlisted" && (
              <Star className="size-3 fill-current" />
            )}
            {VERSION_LABEL[version.status]}
          </span>
        }
      />
      <VersionThumb version={version} />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {version.promptMeta?.tool && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {version.promptMeta.tool}
            </Badge>
          )}
          <span className="truncate">
            {version.createdByUser.name} · {formatWhen(version._creationTime)}
          </span>
        </div>
        {version.note && (
          <p className="line-clamp-2 text-xs text-foreground/80">
            {version.note}
          </p>
        )}
        {decided && version.decidedByUser && (
          <p className="text-xs text-muted-foreground">
            {version.status === "picked" ? "Picked" : "Rejected"} by{" "}
            {version.decidedByUser.name}
            {version.decisionNote ? ` — "${version.decisionNote}"` : ""}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          {canDecide &&
            (version.status === "candidate" ||
              version.status === "shortlisted") && (
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  void shortlist({ versionId: version._id }).catch(
                    showMutationError,
                  )
                }
              >
                <Star
                  className={cn(
                    "size-3",
                    version.status === "shortlisted" && "fill-current",
                  )}
                />
                {version.status === "shortlisted"
                  ? "Unshortlist"
                  : copy.actions.shortlist}
              </Button>
            )}
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "ghost", size: "xs" })}
            >
              <ExternalLink className="size-3" /> Open
            </a>
          )}
          <Link
            href={`/p/${productionId}/review/${shotId}`}
            className={cn(
              buttonVariants({ variant: "ghost", size: "xs" }),
              "text-muted-foreground",
            )}
          >
            <GitCompare className="size-3" /> Compare in Review Room
          </Link>
        </div>
      </div>
    </Card>
  );
}

function VersionThumb({ version }: { version: VersionRow }) {
  const asset = version.asset;
  const isVideo = asset?.mimeType?.startsWith("video/") ?? false;
  const alt = asset?.name ?? `v${version.index}`;

  if (isVideo) {
    return (
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-[#101114]">
        {asset?.thumbUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbUrl}
            alt={alt}
            className="absolute inset-0 size-full object-cover opacity-80"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <Film className="size-6 text-white/70" />
        </div>
      </div>
    );
  }

  if (asset?.thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.thumbUrl}
        alt={alt}
        className="aspect-video w-full shrink-0 object-cover"
      />
    );
  }

  return (
    <div className="flex aspect-video w-full shrink-0 items-center justify-center bg-muted">
      <ImageIcon className="size-6 text-muted-foreground/60" />
    </div>
  );
}
