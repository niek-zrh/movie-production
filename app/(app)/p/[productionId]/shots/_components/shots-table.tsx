"use client";

import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/components/app/status-pill";
import { UserAvatar } from "@/components/app/user-avatar";
import {
  SHOT_STATUSES,
  STAGE_BY_KEY,
  WORKING_STATUSES,
  type ShotStatusKey,
} from "@/convex/lib/domain";
import { todayInTz } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  isContentEditor,
  onMutationError,
  type ShotRow,
  type TeamMember,
} from "./shots-common";

type SortKey = "code" | "status" | "due";
type Sort = { key: SortKey; dir: 1 | -1 } | null;

const STATUS_ORDER = new Map(SHOT_STATUSES.map((s, i) => [s.key as string, i]));
/** Statuses where a past due date no longer matters. */
const SETTLED_STATUSES: ShotStatusKey[] = [
  "approved",
  "final",
  "delivered",
  "killed",
];

export function ShotsTable({
  shots,
  team,
  role,
  viewerId,
  productionId,
  timezone,
}: {
  shots: ShotRow[];
  team: TeamMember[] | undefined;
  role: string | null;
  viewerId: Id<"users"> | null;
  productionId: Id<"productions">;
  timezone: string | undefined;
}) {
  const [sort, setSort] = useState<Sort>(null);
  const today = timezone
    ? todayInTz(timezone)
    : new Date().toISOString().slice(0, 10);

  const sorted = useMemo(() => {
    if (sort === null) return shots;
    const arr = [...shots];
    arr.sort((a, b) => {
      if (sort.key === "code") return a.code.localeCompare(b.code) * sort.dir;
      if (sort.key === "status")
        return (
          ((STATUS_ORDER.get(a.status) ?? 0) -
            (STATUS_ORDER.get(b.status) ?? 0)) *
          sort.dir
        );
      // due — shots without a due date always sink to the bottom.
      if (a.dueDate === undefined && b.dueDate === undefined) return 0;
      if (a.dueDate === undefined) return 1;
      if (b.dueDate === undefined) return -1;
      return a.dueDate.localeCompare(b.dueDate) * sort.dir;
    });
    return arr;
  }, [shots, sort]);

  const cycleSort = (key: SortKey) =>
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 1 };
      if (prev.dir === 1) return { key, dir: -1 };
      return null; // back to board order
    });

  const contentEditor = isContentEditor(role);
  const canEditRow = (shot: ShotRow) =>
    contentEditor ||
    (role === "artist" && viewerId !== null && shot.assignee?._id === viewerId);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead
              label="Code"
              sortKey="code"
              sort={sort}
              onSort={cycleSort}
            />
            <TableHead>Title</TableHead>
            <TableHead>Scene</TableHead>
            <TableHead>Stage</TableHead>
            <SortableHead
              label="Status"
              sortKey="status"
              sort={sort}
              onSort={cycleSort}
            />
            <TableHead>Assignee</TableHead>
            <TableHead className="text-right">Versions</TableHead>
            <SortableHead
              label="Due"
              sortKey="due"
              sort={sort}
              onSort={cycleSort}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((shot) => {
            const editable = canEditRow(shot);
            return (
              <TableRow key={shot._id}>
                <TableCell>
                  <Link
                    href={`/p/${productionId}/shots/${shot._id}`}
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {shot.code}
                  </Link>
                </TableCell>
                <TableCell className="max-w-56">
                  {shot.title ? (
                    <span className="block truncate">{shot.title}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {shot.scene ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {shot.scene.code}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {STAGE_BY_KEY[shot.stage].label}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusCell shot={shot} role={role} editable={editable} />
                </TableCell>
                <TableCell>
                  <AssigneeCell shot={shot} team={team} editable={editable} />
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs text-muted-foreground">
                    {shot.versionsCount}
                  </span>
                </TableCell>
                <TableCell>
                  <DueDateCell shot={shot} editable={editable} today={today} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <TableHead>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        {active ? (
          sort.dir === 1 ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ChevronsUpDown className="size-3 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

/**
 * Inline status change → api.shots.setStatus. Artists only get their working
 * statuses (server enforces the same rule); refusals surface as toasts.
 */
function StatusCell({
  shot,
  role,
  editable,
}: {
  shot: ShotRow;
  role: string | null;
  editable: boolean;
}) {
  const setStatus = useMutation(api.shots.setStatus);
  const artistLocked =
    role === "artist" && !WORKING_STATUSES.includes(shot.status);
  if (!editable || artistLocked) {
    return <StatusPill status={shot.status} size="xs" />;
  }
  const options =
    role === "artist"
      ? SHOT_STATUSES.filter((s) => WORKING_STATUSES.includes(s.key))
      : SHOT_STATUSES;
  return (
    <Select
      value={shot.status as string}
      onValueChange={(v) => {
        if (v === shot.status) return;
        void setStatus({
          shotId: shot._id,
          status: v as ShotStatusKey,
        }).catch(onMutationError);
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-6 gap-0.5 border-transparent bg-transparent px-1 hover:border-input"
        aria-label={`Change status of ${shot.code}`}
      >
        <StatusPill status={shot.status} size="xs" />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((s) => (
          <SelectItem key={s.key} value={s.key}>
            <StatusPill status={s.key} size="xs" />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Inline assignee change → api.shots.update (server has no way to unassign). */
function AssigneeCell({
  shot,
  team,
  editable,
}: {
  shot: ShotRow;
  team: TeamMember[] | undefined;
  editable: boolean;
}) {
  const updateShot = useMutation(api.shots.update);
  const members = (team ?? []).filter((m) => m.userId !== undefined);
  if (!editable || members.length === 0) {
    return shot.assignee ? (
      <span className="flex items-center gap-1.5 text-xs">
        <UserAvatar
          name={shot.assignee.name}
          image={shot.assignee.image}
          className="size-4 text-[8px]"
        />
        {shot.assignee.name}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }
  return (
    <Select
      value={(shot.assignee?._id ?? "__none__") as string}
      onValueChange={(v) => {
        if (v === "__none__" || v === shot.assignee?._id) return;
        void updateShot({
          shotId: shot._id,
          assigneeId: v as Id<"users">,
        }).catch(onMutationError);
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-6 max-w-44 gap-0.5 border-transparent bg-transparent px-1 hover:border-input"
        aria-label={`Assign ${shot.code}`}
      >
        {shot.assignee ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <UserAvatar
              name={shot.assignee.name}
              image={shot.assignee.image}
              className="size-4 text-[8px]"
            />
            <span className="truncate">{shot.assignee.name}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Assign</span>
        )}
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {members.map((m) => (
          <SelectItem key={m._id} value={m.userId as string}>
            <UserAvatar
              name={m.name}
              image={m.image}
              className="size-4 text-[8px]"
            />
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Click the date → native date input → api.shots.update on change. */
function DueDateCell({
  shot,
  editable,
  today,
}: {
  shot: ShotRow;
  editable: boolean;
  today: string;
}) {
  const updateShot = useMutation(api.shots.update);
  const [editing, setEditing] = useState(false);
  const overdue =
    shot.dueDate !== undefined &&
    shot.dueDate < today &&
    !SETTLED_STATUSES.includes(shot.status);

  if (!editable) {
    return (
      <span
        className={cn(
          "font-mono text-xs",
          overdue ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {shot.dueDate ?? "—"}
      </span>
    );
  }
  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={shot.dueDate ?? ""}
        className="h-6 rounded-md border border-input bg-transparent px-1 font-mono text-xs outline-none focus-visible:border-ring"
        onChange={(e) => {
          const next = e.target.value;
          if (next === (shot.dueDate ?? "")) return;
          void updateShot({
            shotId: shot._id,
            dueDate: next === "" ? null : next,
          }).catch(onMutationError);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || e.key === "Enter") setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "rounded font-mono text-xs hover:underline",
        overdue
          ? "text-destructive"
          : shot.dueDate
            ? undefined
            : "text-muted-foreground",
      )}
      aria-label={`Set due date for ${shot.code}`}
    >
      {shot.dueDate ?? "Set date"}
    </button>
  );
}
