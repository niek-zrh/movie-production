"use client";

import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/app/empty-state";
import { UserAvatar } from "@/components/app/user-avatar";
import { useStudio } from "@/components/app/studio-context";
import { formatWhen } from "@/lib/format";
import { cn } from "@/lib/utils";
import { showMutationError } from "./error-toast";

type CommentRow = (typeof api.comments.list._returnType)[number];
type TeamMember = (typeof api.studios.team._returnType)[number];
type Mentionable = TeamMember & { userId: Id<"users"> };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap "@Name" runs of known mention users so they stand out in the body. */
function renderBody(body: string, mentionUsers: CommentRow["mentionUsers"]) {
  if (mentionUsers.length === 0) return body;
  const pattern = mentionUsers
    .map((u) => escapeRegExp(`@${u.name}`))
    .join("|");
  const parts = body.split(new RegExp(`(${pattern})`, "g"));
  return parts.map((part, i) => {
    const isMention = mentionUsers.some((u) => `@${u.name}` === part);
    return isMention ? (
      <span key={i} className="font-medium text-foreground">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    );
  });
}

export function DiscussionTab({
  productionId,
  shotId,
  canEditContent,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
  canEditContent: boolean;
}) {
  const { viewer } = useStudio();
  const comments = useQuery(api.comments.list, {
    targetType: "shot",
    targetId: shotId,
  });
  const resolve = useMutation(api.comments.resolve);

  return (
    <div className="max-w-2xl space-y-5">
      {comments === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : comments.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title="No comments yet. Notes and @mentions on this shot land here."
          className="py-10"
        />
      ) : (
        <ol className="space-y-4">
          {comments.map((comment) => {
            const resolved = comment.resolvedAt !== undefined;
            const canResolve =
              !resolved &&
              (comment.authorId === viewer?._id || canEditContent);
            return (
              <li key={comment._id} className="flex items-start gap-2.5">
                <UserAvatar
                  name={comment.author.name}
                  image={comment.author.image}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "flex flex-wrap items-baseline gap-x-2 text-xs",
                      resolved && "text-muted-foreground line-through",
                    )}
                  >
                    <span className="text-sm font-medium text-foreground">
                      {comment.author.name}
                    </span>
                    <span className="text-muted-foreground">
                      {formatWhen(comment._creationTime)}
                    </span>
                    {resolved && (
                      <span className="text-muted-foreground">Resolved</span>
                    )}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 text-sm whitespace-pre-wrap",
                      resolved && "text-muted-foreground",
                    )}
                  >
                    {renderBody(comment.body, comment.mentionUsers)}
                  </p>
                </div>
                {canResolve && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0 text-muted-foreground"
                    onClick={() =>
                      void resolve({ commentId: comment._id }).catch(
                        showMutationError,
                      )
                    }
                  >
                    Resolve
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Composer productionId={productionId} shotId={shotId} />
    </div>
  );
}

function Composer({
  productionId,
  shotId,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
}) {
  const { studioId } = useStudio();
  const team = useQuery(api.studios.team, studioId ? { studioId } : "skip");
  const addComment = useMutation(api.comments.add);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  // Users inserted via the popover; filtered against the final body on submit.
  const [inserted, setInserted] = useState<{ id: Id<"users">; name: string }[]>(
    [],
  );
  // Active "@query" token: start index of "@" + text typed after it.
  const [mention, setMention] = useState<{ at: number; query: string } | null>(
    null,
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const mentionables = useMemo(
    () =>
      (team ?? []).filter(
        (m): m is Mentionable => m.userId !== undefined,
      ),
    [team],
  );

  const suggestions = useMemo(() => {
    if (mention === null) return [];
    const q = mention.query.toLowerCase();
    return mentionables
      .filter(
        (m) =>
          q.length === 0 ||
          m.name.toLowerCase().includes(q) ||
          (m.email?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 5);
  }, [mention, mentionables]);

  function detectMention(value: string, caret: number) {
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at === -1) return setMention(null);
    // "@" must start the text or follow whitespace, and the token can't span lines.
    const before = at === 0 ? " " : upToCaret[at - 1];
    const token = upToCaret.slice(at + 1);
    if (!/[\s([]/.test(before) && at !== 0) return setMention(null);
    if (/[\n\r]/.test(token) || token.length > 40) return setMention(null);
    setMention({ at, query: token });
    setActiveIndex(0);
  }

  function insertMention(member: Mentionable) {
    if (mention === null) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.at)}@${member.name} ${body.slice(caret)}`;
    setBody(next);
    setInserted((prev) =>
      prev.some((m) => m.id === member.userId)
        ? prev
        : [...prev, { id: member.userId, name: member.name }],
    );
    setMention(null);
    const newCaret = mention.at + member.name.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCaret, newCaret);
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (trimmed.length === 0 || sending) return;
    const mentions = [
      ...new Set(
        inserted
          .filter((m) => trimmed.includes(`@${m.name}`))
          .map((m) => m.id),
      ),
    ];
    setSending(true);
    try {
      await addComment({
        productionId,
        targetType: "shot",
        targetId: shotId,
        body: trimmed,
        mentions,
        hrefHint: `/p/${productionId}/shots/${shotId}`,
      });
      setBody("");
      setInserted([]);
      setMention(null);
    } catch (e) {
      showMutationError(e);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention !== null && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  let popover: ReactNode = null;
  if (mention !== null && suggestions.length > 0) {
    popover = (
      <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10">
        {suggestions.map((member, i) => (
          <button
            key={member.userId}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
              i === activeIndex && "bg-accent text-accent-foreground",
            )}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              insertMention(member);
            }}
          >
            <UserAvatar name={member.name} image={member.image} className="size-5 text-[9px]" />
            <span className="truncate">{member.name}</span>
            {member.craftTitle && (
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {member.craftTitle}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      {popover}
      <Textarea
        ref={textareaRef}
        value={body}
        placeholder="Add a comment — @ to mention someone"
        className="min-h-20 pr-24"
        onChange={(e) => {
          setBody(e.target.value);
          detectMention(e.target.value, e.target.selectionStart ?? 0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMention(null), 100)}
      />
      <Button
        size="sm"
        className="absolute right-2 bottom-2"
        disabled={body.trim().length === 0 || sending}
        onClick={() => void submit()}
      >
        <Send className="size-3.5" /> Comment
      </Button>
    </div>
  );
}
