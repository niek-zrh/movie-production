"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Archive, ChevronDown, ChevronRight, ChevronUp, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useStudio } from "@/components/app/studio-context";
import { cn } from "@/lib/utils";
import { AddParameterDialog } from "./add-parameter-dialog";
import { QC_CATEGORIES, showMutationError } from "./qc-shared";

type Parameter = Doc<"qcParameters">;

/**
 * The studio-wide QC template (spec F11). Collapsed by default so runs stay
 * the star of the page — auto-opens while there's nothing to run against.
 * Edits are studio.manage (owner/producer); everyone else reads.
 */
export function TemplateSection() {
  const { studioId, role, viewer } = useStudio();
  const canManage = role === "owner" || role === "producer";
  const parameters = useQuery(
    api.qc.listParameters,
    studioId ? { studioId } : "skip",
  );
  const updateParameter = useMutation(api.qc.updateParameter);
  const seedTemplate = useMutation(api.qc.seedDefaultTemplate);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [seeding, setSeeding] = useState(false);

  const studioName =
    viewer?.studios.find((s) => s._id === studioId)?.name ?? "studio";
  const isEmpty = parameters !== undefined && parameters.length === 0;
  // null = untouched: open automatically when the template still needs seeding.
  const expanded = toggled ?? isEmpty;

  const moveWithinGroup = async (group: Parameter[], index: number, dir: -1 | 1) => {
    const other = group[index + dir];
    const current = group[index];
    if (!other || !current) return;
    try {
      // Swap the two global order values — grouping by category is display-only.
      await Promise.all([
        updateParameter({ parameterId: current._id, order: other.order }),
        updateParameter({ parameterId: other._id, order: current.order }),
      ]);
    } catch (e) {
      showMutationError(e);
    }
  };

  const handleSeed = async () => {
    if (!studioId) return;
    setSeeding(true);
    try {
      await seedTemplate({ studioId });
    } catch (e) {
      showMutationError(e);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-left"
          onClick={() => setToggled(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <h2 className="truncate font-display text-base font-semibold tracking-tight">
            QC template — {studioName}
          </h2>
          {parameters !== undefined && parameters.length > 0 && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {parameters.length} checks
            </span>
          )}
        </button>
        {expanded && canManage && studioId && !isEmpty && (
          <AddParameterDialog studioId={studioId} />
        )}
      </div>
      <p className="mt-1 pl-[22px] text-xs text-muted-foreground">
        Every new QC run copies this checklist. Shared across all productions
        in the studio.
      </p>

      {expanded && (
        <div className="mt-4">
          {parameters === undefined ? (
            <div className="space-y-1.5">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-8 py-10 text-center">
              <ListChecks className="size-7 text-muted-foreground" />
              <p className="max-w-sm text-sm text-muted-foreground">
                No QC template yet — every delivery check starts from one.
              </p>
              {canManage ? (
                <Button size="sm" onClick={handleSeed} disabled={seeding}>
                  Seed the standard TV-delivery template (~25 checks)
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Ask a producer to seed it.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {QC_CATEGORIES.map(({ key, label }) => {
                const group = parameters.filter((p) => p.category === key);
                if (group.length === 0) return null;
                return (
                  <div key={key}>
                    <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </h3>
                    <ul className="divide-y rounded-lg border bg-card">
                      {group.map((parameter, i) => (
                        <ParameterRow
                          key={parameter._id}
                          parameter={parameter}
                          canManage={canManage}
                          isFirst={i === 0}
                          isLast={i === group.length - 1}
                          onMove={(dir) => void moveWithinGroup(group, i, dir)}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ParameterRow({
  parameter,
  canManage,
  isFirst,
  isLast,
  onMove,
}: {
  parameter: Parameter;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
}) {
  const updateParameter = useMutation(api.qc.updateParameter);

  return (
    <li className="flex items-center gap-2.5 px-3 py-2">
      {canManage && (
        <div className="flex shrink-0 flex-col">
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground"
            disabled={isFirst}
            aria-label={`Move ${parameter.name} up`}
            onClick={() => onMove(-1)}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="size-5 text-muted-foreground"
            disabled={isLast}
            aria-label={`Move ${parameter.name} down`}
            onClick={() => onMove(1)}
          >
            <ChevronDown />
          </Button>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{parameter.name}</span>
          {!canManage && parameter.required && (
            <span
              className="size-1 shrink-0 rounded-full bg-foreground/35"
              title="Required"
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
          <span className="font-mono">{parameter.spec}</span>
          {parameter.tolerance && (
            <span className="text-muted-foreground">
              · {parameter.tolerance}
            </span>
          )}
        </div>
      </div>
      {canManage && (
        <>
          <label
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-xs",
              parameter.required ? "text-foreground" : "text-muted-foreground",
            )}
          >
            Required
            <Switch
              size="sm"
              checked={parameter.required}
              onCheckedChange={(checked) =>
                void updateParameter({
                  parameterId: parameter._id,
                  required: checked === true,
                }).catch(showMutationError)
              }
            />
          </label>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            title="Archive — future runs skip this check"
            aria-label={`Archive ${parameter.name}`}
            onClick={() =>
              void updateParameter({
                parameterId: parameter._id,
                archived: true,
              }).catch(showMutationError)
            }
          >
            <Archive />
          </Button>
        </>
      )}
    </li>
  );
}
