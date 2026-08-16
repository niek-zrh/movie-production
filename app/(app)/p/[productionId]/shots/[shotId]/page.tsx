"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ArrowLeft, CalendarDays, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { StatusPill, STATUS_DOT_CLASSES } from "@/components/app/status-pill";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import {
  SHOT_STATUSES,
  STAGES,
  STAGE_BY_KEY,
  WORKING_STATUSES,
  type ShotStatusKey,
  type StageKey,
} from "@/convex/lib/domain";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OptionsTab } from "./_components/options-tab";
import { DiscussionTab } from "./_components/discussion-tab";
import { FilesTab } from "./_components/files-tab";
import { HistoryTab } from "./_components/history-tab";
import { showMutationError } from "./_components/error-toast";

const CONTENT_EDIT_ROLES = [
  "owner",
  "producer",
  "creative_director",
  "supervisor",
];

export default function ShotDetailPage() {
  const params = useParams<{ productionId: string; shotId: string }>();
  const productionId = params.productionId as Id<"productions">;
  const shotId = params.shotId as Id<"shots">;

  const { studioId, role, viewer } = useStudio();
  const shot = useQuery(api.shots.get, { shotId });
  const team = useQuery(api.studios.team, studioId ? { studioId } : "skip");
  // Subscribed at page level so the Discussion tab count stays live.
  const comments = useQuery(api.comments.list, {
    targetType: "shot",
    targetId: shotId,
  });

  const updateShot = useMutation(api.shots.update);
  const setStatus = useMutation(api.shots.setStatus);
  const setStage = useMutation(api.shots.setStage);

  const canEditContent = role !== null && CONTENT_EDIT_ROLES.includes(role);
  const isAssignedArtist =
    role === "artist" && shot !== undefined && shot.assigneeId === viewer?._id;
  // Title / status / assignee / due date: content.edit roles + assigned artist.
  const canEditFields = canEditContent || isAssignedArtist;
  const canDecide = canEditContent; // supervisor scoped server-side
  const canUpload = role !== null && role !== "viewer";

  const statusOptions =
    role === "artist"
      ? SHOT_STATUSES.filter((s) => WORKING_STATUSES.includes(s.key))
      : SHOT_STATUSES;

  const members = (team ?? []).filter(
    (m): m is (typeof m & { userId: Id<"users"> }) => m.userId !== undefined,
  );

  if (shot === undefined) {
    return (
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-7 w-96" />
          <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </main>
    );
  }

  const metaBits = [
    shot.scene ? shot.scene.code : null,
    shot.episode ? `EP${String(shot.episode.number).padStart(2, "0")}` : null,
    `${shot.versionsCount} option${shot.versionsCount === 1 ? "" : "s"}`,
    shot.pickedVersionIndex !== null ? `picked v${shot.pickedVersionIndex}` : null,
  ].filter((bit): bit is string => bit !== null);

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto w-full max-w-6xl">
        <Link
          href={`/p/${productionId}/shots`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Shots
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {shot.code}
            </h1>
            <InlineTitle
              shotId={shotId}
              title={shot.title}
              canEdit={canEditFields}
            />
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {metaBits.join(" · ")}
            </p>
          </div>
          {shot.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${shot.driveFolderId}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <HardDrive className="size-3.5" /> Open shot folder in Drive
            </a>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canEditFields ? (
            <Select
              value={shot.status}
              onValueChange={(value) =>
                void setStatus({
                  shotId,
                  status: value as ShotStatusKey,
                }).catch(showMutationError)
              }
            >
              <SelectTrigger size="sm" aria-label="Status" className="gap-1.5">
                <StatusPill status={shot.status} />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        STATUS_DOT_CLASSES[s.key],
                      )}
                    />
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StatusPill status={shot.status} />
          )}

          {canEditContent ? (
            <Select
              value={shot.stage}
              onValueChange={(value) =>
                void setStage({ shotId, stage: value as StageKey }).catch(
                  showMutationError,
                )
              }
            >
              <SelectTrigger size="sm" aria-label="Stage">
                <span className="text-muted-foreground">Stage</span>
                {STAGE_BY_KEY[shot.stage].label}
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline">
              Stage · {STAGE_BY_KEY[shot.stage].label}
            </Badge>
          )}

          {canEditFields ? (
            <Select
              value={shot.assigneeId ?? null}
              onValueChange={(value) => {
                if (typeof value === "string" && value.length > 0)
                  void updateShot({
                    shotId,
                    assigneeId: value as Id<"users">,
                  }).catch(showMutationError);
              }}
            >
              <SelectTrigger size="sm" aria-label="Assignee">
                {shot.assignee ? (
                  <span className="flex items-center gap-1.5">
                    <UserAvatar
                      name={shot.assignee.name}
                      image={shot.assignee.image}
                      className="size-4 text-[8px]"
                    />
                    {shot.assignee.name}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Assign</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
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
          ) : (
            shot.assignee && (
              <span className="flex items-center gap-1.5 text-sm">
                <UserAvatar
                  name={shot.assignee.name}
                  image={shot.assignee.image}
                  className="size-4 text-[8px]"
                />
                {shot.assignee.name}
              </span>
            )
          )}

          {canEditFields ? (
            <Input
              type="date"
              aria-label="Due date"
              value={shot.dueDate ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(value))
                  void updateShot({ shotId, dueDate: value }).catch(
                    showMutationError,
                  );
              }}
              className="h-7 w-fit rounded-[min(var(--radius-md),12px)] text-[0.8rem]"
            />
          ) : (
            shot.dueDate && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="size-3.5" />
                Due {formatDay(shot.dueDate)}
              </span>
            )
          )}
        </div>

        <Tabs defaultValue="options" className="mt-6">
          <TabsList
            variant="line"
            className="w-full justify-start gap-4 rounded-none border-b p-0"
          >
            <TabsTrigger value="options" className="flex-none px-1">
              Options
              {shot.versionsCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {shot.versionsCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="discussion" className="flex-none px-1">
              Discussion
              {comments !== undefined && comments.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {comments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-none px-1">
              Files
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-none px-1">
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="options" className="pt-4">
            <OptionsTab
              productionId={productionId}
              shotId={shotId}
              productionCode={shot.production.code}
              shotCode={shot.code}
              canDecide={canDecide}
              canUpload={canUpload}
            />
          </TabsContent>
          <TabsContent value="discussion" className="pt-4">
            <DiscussionTab
              productionId={productionId}
              shotId={shotId}
              canEditContent={canEditContent}
            />
          </TabsContent>
          <TabsContent value="files" className="pt-4">
            <FilesTab shotId={shotId} />
          </TabsContent>
          <TabsContent value="history" className="pt-4">
            <HistoryTab
              productionId={productionId}
              shotId={shotId}
              shotCode={shot.code}
            />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function InlineTitle({
  shotId,
  title,
  canEdit,
}: {
  shotId: Id<"shots">;
  title?: string;
  canEdit: boolean;
}) {
  const updateShot = useMutation(api.shots.update);
  const [value, setValue] = useState(title ?? "");
  const cancelled = useRef(false);
  useEffect(() => {
    setValue(title ?? "");
  }, [title]);

  if (!canEdit) {
    return title ? (
      <p className="font-display text-lg text-muted-foreground">{title}</p>
    ) : null;
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const trimmed = value.trim();
    if (trimmed === (title ?? "")) return;
    void updateShot({ shotId, title: trimmed }).catch(showMutationError);
  };

  return (
    <input
      value={value}
      placeholder="Add a title"
      aria-label="Shot title"
      className="w-full max-w-md border-b border-transparent bg-transparent font-display text-lg outline-none placeholder:text-muted-foreground/50 hover:border-border focus:border-ring"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setValue(title ?? "");
          e.currentTarget.blur();
        }
      }}
    />
  );
}
