"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/app/user-avatar";
import { formatAgo, formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DecisionActions } from "./decision-dialogs";
import {
  firstErrorLine,
  VERSION_DOT,
  VERSION_STATUS_LABEL,
  type VersionCard,
} from "./review-utils";

/**
 * Right rail: the focused version's decision buttons, its prompt metadata,
 * its decision when decided, and the comment thread on that version.
 */
export function RightRail({
  productionId,
  shotId,
  version,
  canDecide,
  onShortlist,
  onReject,
  onPick,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  version: VersionCard;
  /** Roles that can't decide never see the controls (spec §6 permissions). */
  canDecide: boolean;
  onShortlist: () => void;
  onReject: () => void;
  onPick: () => void;
}) {
  const meta = version.promptMeta;
  const decided = version.decidedBy !== undefined;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Focused version header */}
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">
              v{version.index}
            </span>
            <span
              className={cn(
                "size-1.5 rounded-full",
                VERSION_DOT[version.status],
              )}
            />
            <span className="text-xs text-muted-foreground">
              {VERSION_STATUS_LABEL[version.status]}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <UserAvatar
              name={version.createdByUser.name}
              image={version.createdByUser.image}
              className="size-5 text-[9px]"
            />
            <span className="truncate">{version.createdByUser.name}</span>
            <span>·</span>
            <span className="whitespace-nowrap">
              {formatAgo(version._creationTime)}
            </span>
          </div>
          {version.asset && (
            <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
              {version.asset.name}
            </p>
          )}
          {canDecide && (
            <DecisionActions
              version={version}
              onShortlist={onShortlist}
              onReject={onReject}
              onPick={onPick}
              className="mt-3"
            />
          )}
        </div>

        {/* Prompt metadata */}
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prompt
            </h3>
            {meta?.prompt !== undefined && meta.prompt !== "" && (
              <Button
                variant="ghost"
                size="icon-xs"
                title="Copy prompt"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(meta.prompt ?? "")
                    .then(() => toast.success("Prompt copied"))
                    .catch(() => toast.error("Couldn't copy the prompt"));
                }}
              >
                <Copy />
                <span className="sr-only">Copy prompt</span>
              </Button>
            )}
          </div>
          {meta ? (
            <dl className="space-y-2">
              {meta.tool !== undefined && meta.tool !== "" && (
                <MetaRow label="Tool" value={meta.tool} />
              )}
              {meta.model !== undefined && meta.model !== "" && (
                <MetaRow label="Model" value={meta.model} />
              )}
              {meta.seed !== undefined && meta.seed !== "" && (
                <MetaRow label="Seed" value={meta.seed} />
              )}
              {meta.prompt !== undefined && meta.prompt !== "" && (
                <div>
                  <dt className="text-[11px] text-muted-foreground">Prompt</dt>
                  <dd className="mt-1 max-h-40 overflow-y-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                    {meta.prompt}
                  </dd>
                </div>
              )}
              {meta.params !== undefined && meta.params !== "" && (
                <div>
                  <dt className="text-[11px] text-muted-foreground">Params</dt>
                  <dd className="mt-1 max-h-24 overflow-y-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                    {meta.params}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              No prompt metadata on this version.
            </p>
          )}
          {version.note !== undefined && version.note !== "" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Note: {version.note}
            </p>
          )}
        </div>

        {/* Decision */}
        {decided && (
          <div className="border-b border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Decision
            </h3>
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  VERSION_DOT[version.status],
                )}
              />
              <span>{VERSION_STATUS_LABEL[version.status]}</span>
              {version.decidedByUser && (
                <span className="text-muted-foreground">
                  by {version.decidedByUser.name}
                </span>
              )}
            </div>
            {version.decidedAt !== undefined && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatWhen(version.decidedAt)}
              </p>
            )}
            {version.decisionNote !== undefined &&
              version.decisionNote !== "" && (
                <p className="mt-1.5 text-sm italic">
                  &ldquo;{version.decisionNote}&rdquo;
                </p>
              )}
          </div>
        )}

        {/* Comments */}
        <CommentThread
          productionId={productionId}
          shotId={shotId}
          versionId={version._id}
        />
      </div>
    </aside>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs" title={value}>
        {value}
      </dd>
    </div>
  );
}

function CommentThread({
  productionId,
  shotId,
  versionId,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  versionId: Id<"versions">;
}) {
  const comments = useQuery(api.comments.list, {
    targetType: "version",
    targetId: versionId,
  });
  const addComment = useMutation(api.comments.add);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await addComment({
        productionId,
        targetType: "version",
        targetId: versionId,
        body: text,
        mentions: [],
        hrefHint: `/p/${productionId}/review/${shotId}`,
      });
      setBody("");
    } catch (e) {
      toast.error(firstErrorLine(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Comments
      </h3>
      {comments === undefined ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No comments on this version yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c._id} className="flex gap-2">
              <UserAvatar
                name={c.author.name}
                image={c.author.image}
                className="mt-0.5 size-5 shrink-0 text-[9px]"
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-xs font-medium">
                    {c.author.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatAgo(c._creationTime)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Add a comment…"
          className="min-h-9 flex-1 text-sm"
          rows={1}
        />
        <Button
          variant="secondary"
          size="icon-sm"
          disabled={!body.trim() || sending}
          onClick={() => void send()}
          title="Send"
        >
          <SendHorizonal />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  );
}
