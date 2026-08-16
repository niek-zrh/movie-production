"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/app/user-avatar";
import { formatWhen } from "@/lib/format";
import { showMutationError } from "./qc-shared";

/** Discussion on the run itself — targetType "qcRun" (spec F11). */
export function RunComments({
  productionId,
  qcRunId,
}: {
  productionId: Id<"productions">;
  qcRunId: Id<"qcRuns">;
}) {
  const comments = useQuery(api.comments.list, {
    targetType: "qcRun",
    targetId: qcRunId,
  });
  const addComment = useMutation(api.comments.add);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      await addComment({
        productionId,
        targetType: "qcRun",
        targetId: qcRunId,
        body: body.trim(),
        mentions: [],
        hrefHint: `/p/${productionId}/qc/${qcRunId}`,
      });
      setBody("");
    } catch (e) {
      showMutationError(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Comments
      </h2>
      {comments === undefined ? (
        <Skeleton className="h-16" />
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet — notes about this master land here.
        </p>
      ) : (
        <ol className="space-y-3">
          {comments.map((comment) => (
            <li key={comment._id} className="flex items-start gap-2.5">
              <UserAvatar
                name={comment.author.name}
                image={comment.author.image}
                className="mt-px"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">
                    {comment.author.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatWhen(comment._creationTime)}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-snug">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <form
        className="mt-4 flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note for the team…"
          rows={2}
          className="min-h-16 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button type="submit" size="sm" disabled={!body.trim() || sending}>
          Comment
        </Button>
      </form>
    </section>
  );
}
