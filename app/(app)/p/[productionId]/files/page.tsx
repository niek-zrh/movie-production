"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { FolderOpen, HardDrive, TriangleAlert, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { useStudio } from "@/components/app/studio-context";
import { HUB_FOLDERS } from "@/convex/lib/domain";
import { copy } from "@/lib/copy";
import { useHotkeys } from "@/lib/hooks/use-hotkeys";
import { FilesAttachDialog } from "./_components/files-attach-dialog";
import {
  FilesSection,
  firstErrorLine,
  type AssetRow,
} from "./_components/files-section";
import { FilesToolbar, type FilesFilter } from "./_components/files-toolbar";

type Section = {
  key: string;
  label: string;
  kind: "drive" | "uploads" | "other";
  assets: AssetRow[];
};

export default function FilesPage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const { role } = useStudio();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilesFilter>("all");
  const [attachAsset, setAttachAsset] = useState<AssetRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const production = useQuery(api.productions.get, { productionId });
  const connection = useQuery(api.drive.connectionStatus, { productionId });
  const assets = useQuery(api.assets.listForProduction, {
    productionId,
    unassignedOnly: filter === "unassigned" ? true : undefined,
  });
  const shots = useQuery(api.shots.list, { productionId });
  const syncNow = useAction(api.drive.syncNow);

  useHotkeys({ "/": () => searchRef.current?.focus() });

  const hub = production?.hub;
  const hubConnected = connection?.hub.connected === true;
  const hubRevoked = connection?.hub.revoked === true;

  // folderId → pretty label ("04 Production / Shots"), root included.
  const folderLabelById = useMemo(() => {
    const map = new Map<string, string>();
    if (hub === undefined) return map;
    map.set(hub.rootFolderId, "Hub root");
    for (const def of HUB_FOLDERS) {
      const id: string | undefined = hub.folderIds[def.key];
      if (id !== undefined) map.set(id, def.path.join(" / "));
    }
    for (const [key, id] of Object.entries(hub.folderIds)) {
      if (!map.has(id)) map.set(id, key);
    }
    return map;
  }, [hub]);

  // Section order mirrors the Drive tree (root, then 00 Admin…06 Delivery).
  const orderedFolderIds = useMemo(() => {
    if (hub === undefined) return [];
    const ids = [hub.rootFolderId];
    for (const def of HUB_FOLDERS) {
      const id: string | undefined = hub.folderIds[def.key];
      if (id !== undefined && !ids.includes(id)) ids.push(id);
    }
    for (const id of Object.values(hub.folderIds)) {
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }, [hub]);

  const sections: Section[] | undefined = useMemo(() => {
    if (assets === undefined) return undefined;
    const needle = search.trim().toLowerCase();
    let rows = assets;
    if (needle.length > 0)
      rows = rows.filter((a) => a.name.toLowerCase().includes(needle));
    if (filter === "uploads")
      rows = rows.filter((a) => a.provider === "storage");
    if (filter === "missing") rows = rows.filter((a) => a.missing === true);

    const groups = new Map<string, AssetRow[]>();
    for (const asset of rows) {
      const key =
        asset.provider === "storage"
          ? "__uploads"
          : asset.driveParentId !== undefined &&
              folderLabelById.has(asset.driveParentId)
            ? asset.driveParentId
            : "__other";
      const list = groups.get(key);
      if (list !== undefined) list.push(asset);
      else groups.set(key, [asset]);
    }

    const out: Section[] = [];
    for (const id of orderedFolderIds) {
      const g = groups.get(id);
      if (g !== undefined)
        out.push({
          key: id,
          label: folderLabelById.get(id) ?? id,
          kind: "drive",
          assets: g,
        });
    }
    const uploads = groups.get("__uploads");
    if (uploads !== undefined)
      out.push({
        key: "__uploads",
        label: "App uploads",
        kind: "uploads",
        assets: uploads,
      });
    const other = groups.get("__other");
    if (other !== undefined)
      out.push({ key: "__other", label: "Other", kind: "other", assets: other });
    return out;
  }, [assets, search, filter, folderLabelById, orderedFolderIds]);

  const shotCodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const shot of shots ?? []) map.set(shot._id, shot.code);
    return map;
  }, [shots]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncNow({ productionId });
      const parts: string[] = [];
      if (result.newFiles > 0) parts.push(`${result.newFiles} new`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.missing > 0) parts.push(`${result.missing} missing`);
      toast.success(
        parts.length > 0
          ? `Synced hub — ${parts.join(", ")}`
          : "Synced hub — everything up to date",
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? firstErrorLine(e.message)
          : "Something didn't work — try again",
      );
    } finally {
      setSyncing(false);
    }
  };

  const canAttach = role !== null && role !== "viewer";
  const loading =
    production === undefined || connection === undefined ||
    assets === undefined || sections === undefined;
  const settingsHref = `/p/${productionId}/settings`;
  // Full-page invitation only when there is genuinely nothing to browse.
  const showConnectEmpty =
    !loading && !hubConnected && filter === "all" && assets.length === 0;
  const filtered = filter !== "all" || search.trim().length > 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {copy.nav.files}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {hubConnected && connection?.hub.ownerEmail !== undefined
            ? `Synced from the Drive hub — ${connection.hub.ownerEmail}`
            : copy.tagline}
        </p>
      </div>

      {hubRevoked && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-status-rework/30 bg-status-rework/10 px-3 py-2 text-sm text-status-rework">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="flex-1">{copy.errors.driveExpired}</span>
          <Link
            href={settingsHref}
            className={buttonVariants({ variant: "outline", size: "xs" })}
          >
            {copy.actions.reconnectDrive}
          </Link>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-full max-w-xl" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : showConnectEmpty ? (
        <EmptyState icon={<HardDrive />} title={copy.empty.files}>
          <Link href={settingsHref} className={buttonVariants({ size: "sm" })}>
            {copy.actions.connectDrive}
          </Link>
        </EmptyState>
      ) : (
        <>
          <FilesToolbar
            search={search}
            onSearchChange={setSearch}
            filter={filter}
            onFilterChange={setFilter}
            hubConnected={hubConnected}
            syncing={syncing}
            onSync={() => void handleSync()}
            searchRef={searchRef}
          />

          {!hubConnected && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              <HardDrive className="size-4 shrink-0" />
              <span className="flex-1">
                No Drive hub yet — uploads stay in the app until one is
                connected.
              </span>
              <Link
                href={settingsHref}
                className={buttonVariants({ variant: "outline", size: "xs" })}
              >
                {copy.actions.connectDrive}
              </Link>
            </div>
          )}

          {sections.length === 0 ? (
            filtered ? (
              <EmptyState className="mt-4" title="No files match." />
            ) : (
              <EmptyState
                className="mt-4"
                icon={<FolderOpen />}
                title={copy.empty.files}
              >
                {hubConnected && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={syncing}
                    onClick={() => void handleSync()}
                  >
                    {copy.actions.syncNow}
                  </Button>
                )}
              </EmptyState>
            )
          ) : (
            <div className="mt-5 space-y-6">
              {sections.map((section) => (
                <FilesSection
                  key={section.key}
                  label={section.label}
                  icon={
                    section.kind === "uploads" ? (
                      <Upload />
                    ) : section.kind === "other" ? (
                      <FolderOpen />
                    ) : undefined
                  }
                  assets={section.assets}
                  productionId={productionId}
                  shotCodeById={shotCodeById}
                  canAttach={canAttach}
                  onAttach={setAttachAsset}
                />
              ))}
            </div>
          )}
        </>
      )}

      <FilesAttachDialog
        asset={attachAsset}
        productionId={productionId}
        onClose={() => setAttachAsset(null)}
      />
    </main>
  );
}
