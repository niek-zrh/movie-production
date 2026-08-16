"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { STAGES, type StageKey } from "@/convex/lib/domain";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { useStudio } from "@/components/app/studio-context";
import { copy } from "@/lib/copy";
import { BoardColumn } from "./_components/board-column";
import { showMutationError, type BoardShot } from "./_components/board-helpers";

export default function BoardPage() {
  const params = useParams<{ productionId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const { role } = useStudio();

  const stages = useQuery(api.productions.listStages, { productionId });
  const shots = useQuery(api.shots.list, { productionId });
  const setShotStage = useMutation(api.shots.setStage);

  // Optimistic stage overrides while a drop's mutation is in flight; each entry
  // clears once the server value catches up (or rolls back on rejection).
  const [overrides, setOverrides] = useState<Record<string, StageKey>>({});

  useEffect(() => {
    if (!shots) return;
    setOverrides((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      const serverStage = new Map(shots.map((s) => [s._id as string, s.stage]));
      const next: Record<string, StageKey> = {};
      let changed = false;
      for (const [shotId, stage] of entries) {
        const server = serverStage.get(shotId);
        if (server === undefined || server === stage) changed = true;
        else next[shotId] = stage;
      }
      return changed ? next : prev;
    });
  }, [shots]);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(
      STAGES.map((s) => [s.key, [] as BoardShot[]]),
    ) as Record<StageKey, BoardShot[]>;
    for (const shot of shots ?? []) {
      map[overrides[shot._id] ?? shot.stage].push(shot);
    }
    return map;
  }, [shots, overrides]);

  // shots.setStage needs content.edit — artists/viewers get a read-only board.
  const canDrag =
    role === "owner" ||
    role === "producer" ||
    role === "creative_director" ||
    role === "supervisor";

  const handleMoveShot = (shotId: Id<"shots">, stage: StageKey) => {
    const shot = shots?.find((s) => s._id === shotId);
    if (!shot) return;
    if ((overrides[shotId] ?? shot.stage) === stage) return;
    setOverrides((prev) => ({ ...prev, [shotId]: stage }));
    void setShotStage({ shotId, stage }).catch((e: unknown) => {
      setOverrides((prev) => {
        if (prev[shotId] !== stage) return prev;
        const next = { ...prev };
        delete next[shotId];
        return next;
      });
      showMutationError(e);
    });
  };

  const loading = stages === undefined || shots === undefined;

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Board
        </h1>
        {canDrag && (
          <p className="hidden text-xs text-muted-foreground sm:block">
            Drag shots between stages — stages can run in parallel.
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-x-hidden">
          {STAGES.map((s) => (
            <Skeleton
              key={s.key}
              className="h-80 min-w-[260px] max-w-[360px] flex-1 rounded-xl"
            />
          ))}
        </div>
      ) : (
        <>
          {shots.length === 0 && (
            <EmptyState title={copy.empty.shots} className="mb-5 py-10">
              <Link
                href={`/p/${productionId}/shots`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Plus className="size-4" /> {copy.actions.newShot}
              </Link>
            </EmptyState>
          )}
          <div className="flex items-stretch gap-3 overflow-x-auto pb-4">
            {stages.map((stage) => (
              <BoardColumn
                key={stage._id}
                stage={stage}
                shots={grouped[stage.stage]}
                canDrag={canDrag}
                onMoveShot={handleMoveShot}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
