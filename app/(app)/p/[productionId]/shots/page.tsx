"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Film, LayoutGrid, Plus, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { useStudio } from "@/components/app/studio-context";
import {
  SHOT_STATUSES,
  STAGES,
  type ShotStatusKey,
  type StageKey,
} from "@/convex/lib/domain";
import { copy } from "@/lib/copy";
import { useHotkeys } from "@/lib/hooks/use-hotkeys";
import { cn } from "@/lib/utils";
import { isContentEditor } from "./_components/shots-common";
import { ShotsFilters } from "./_components/shots-filters";
import { ShotsTable } from "./_components/shots-table";
import { ShotsGrid } from "./_components/shots-grid";
import {
  BulkCreateDialog,
  BulkCreateForm,
  NewShotDialog,
} from "./_components/shots-create";

const VIEW_KEY = "slate.shotsView";
type ShotsView = "table" | "grid";

export default function ShotsPage() {
  // useSearchParams needs a Suspense boundary for prerendering.
  return (
    <Suspense
      fallback={
        <main className="flex-1 px-6 py-6">
          <Skeleton className="h-72 w-full" />
        </main>
      }
    >
      <ShotsScreen />
    </Suspense>
  );
}

function ShotsScreen() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { viewer, role } = useStudio();

  const production = useQuery(api.productions.get, { productionId });
  const scenes = useQuery(api.scenes.list, { productionId });
  const team = useQuery(
    api.studios.team,
    production ? { studioId: production.studioId } : "skip",
  );

  const statusParam = searchParams.get("status");
  const stageParam = searchParams.get("stage");
  const sceneParam = searchParams.get("scene");
  const assigneeParam = searchParams.get("assignee");
  const episodeParam = searchParams.get("episode");
  const hasFilters = [
    statusParam,
    stageParam,
    sceneParam,
    assigneeParam,
    episodeParam,
  ].some((p) => p !== null);

  const shots = useQuery(api.shots.list, {
    productionId,
    status: SHOT_STATUSES.some((s) => s.key === statusParam)
      ? (statusParam as ShotStatusKey)
      : undefined,
    stage: STAGES.some((s) => s.key === stageParam)
      ? (stageParam as StageKey)
      : undefined,
    sceneId: sceneParam ? (sceneParam as Id<"scenes">) : undefined,
    assigneeId: assigneeParam ? (assigneeParam as Id<"users">) : undefined,
    episodeId: episodeParam ? (episodeParam as Id<"episodes">) : undefined,
  });

  const [view, setView] = useState<ShotsView>("table");
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === "grid" || stored === "table") setView(stored);
  }, []);
  const changeView = (next: ShotsView) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  const canCreate = isContentEditor(role);
  const [newShotOpen, setNewShotOpen] = useState(false);
  useHotkeys({ n: () => setNewShotOpen(true) }, canCreate);

  const episodic = production?.kind === "episodic";
  const episodes = production?.episodes;

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            Shots
            {shots !== undefined && (
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                {shots.length}
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <ViewToggle view={view} onChange={changeView} />
            {canCreate && (
              <>
                <BulkCreateDialog
                  productionId={productionId}
                  scenes={scenes}
                  episodes={episodes}
                  episodic={episodic === true}
                />
                <Button
                  size="sm"
                  onClick={() => setNewShotOpen(true)}
                  title="Press N"
                >
                  <Plus /> {copy.actions.newShot}
                </Button>
              </>
            )}
          </div>
        </div>

        <ShotsFilters
          scenes={scenes}
          team={team}
          episodes={episodes}
          episodic={episodic === true}
        />

        {shots === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : shots.length === 0 ? (
          hasFilters ? (
            <EmptyState icon={<Film />} title="No shots match these filters.">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.replace(pathname, { scroll: false })}
              >
                Clear filters
              </Button>
            </EmptyState>
          ) : (
            <EmptyState icon={<Film />} title={copy.empty.shots}>
              {canCreate && (
                <div className="mt-1 w-full max-w-md text-left">
                  <BulkCreateForm
                    productionId={productionId}
                    scenes={scenes}
                    episodes={episodes}
                    episodic={episodic === true}
                  />
                </div>
              )}
            </EmptyState>
          )
        ) : view === "table" ? (
          <ShotsTable
            shots={shots}
            team={team}
            role={role}
            viewerId={viewer?._id ?? null}
            productionId={productionId}
            timezone={production?.timezone}
          />
        ) : (
          <ShotsGrid shots={shots} productionId={productionId} />
        )}
      </div>

      {canCreate && (
        <NewShotDialog
          productionId={productionId}
          scenes={scenes}
          episodes={episodes}
          episodic={episodic === true}
          open={newShotOpen}
          onOpenChange={setNewShotOpen}
        />
      )}
    </main>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ShotsView;
  onChange: (view: ShotsView) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5"
      role="group"
      aria-label="View"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-pressed={view === "table"}
        className={cn(view === "table" && "bg-muted text-foreground")}
        onClick={() => onChange("table")}
        title="Table view"
      >
        <Rows3 />
        <span className="sr-only">Table view</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-pressed={view === "grid"}
        className={cn(view === "grid" && "bg-muted text-foreground")}
        onClick={() => onChange("grid")}
        title="Grid view"
      >
        <LayoutGrid />
        <span className="sr-only">Grid view</span>
      </Button>
    </div>
  );
}
