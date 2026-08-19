"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { HardDrive, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { openDrivePicker } from "@/lib/google-picker";
import { copy } from "@/lib/copy";
import { showMutationError } from "./error-toast";

/**
 * "Attach from Drive" (spec F6): opens the Google Picker with the member's own
 * connection and registers picked files as new versions on this shot. Without
 * a connection it routes to production settings.
 */
export function AttachFromDrive({
  productionId,
  shotId,
}: {
  productionId: Id<"productions">;
  shotId: Id<"shots">;
}) {
  const status = useQuery(api.drive.connectionStatus, { productionId });
  const getPickerConfig = useAction(api.drive.getPickerConfig);
  const attachFromPicker = useAction(api.drive.attachFromPicker);
  const [busy, setBusy] = useState(false);

  if (status === undefined) return null;

  /**
   * drive.attachFromPicker needs BOTH tokens: the member's, to read the bytes
   * of what they picked, and the hub owner's, to write the copy into the
   * shot's Options folder. If either is missing the action throws — and the
   * user would only find out after picking, so gate the control instead.
   */
  const blocked = !status.hub.connected
    ? {
        label: "Set up Drive hub to attach",
        reason:
          "This production has no Drive hub yet — an owner or producer can create it in Settings → Drive hub.",
      }
    : status.hub.revoked === true
      ? {
          label: "Drive hub needs reconnecting",
          reason: `${copy.errors.driveExpired}${
            status.hub.ownerEmail ? ` Hub owner: ${status.hub.ownerEmail}.` : ""
          } Fix it in Settings → Drive hub.`,
        }
      : status.myConnection === null
        ? {
            label: "Connect Drive to attach files",
            reason:
              "Connect your own Google account in Settings → Drive hub to attach files from your Drive.",
          }
        : status.myConnection.revoked
          ? {
              label: "Reconnect Drive to attach files",
              reason: `${copy.errors.driveExpired} Reconnect in Settings → Drive hub.`,
            }
          : null;

  if (blocked !== null) {
    return (
      <Link
        href={`/p/${productionId}/settings`}
        title={blocked.reason}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <HardDrive className="size-3.5" /> {blocked.label}
      </Link>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const config = await getPickerConfig({});
          const files = await openDrivePicker(config);
          if (files !== null && files.length > 0) {
            const result = await attachFromPicker({
              shotId,
              files: files.map((f) => ({
                id: f.id,
                name: f.name,
                mimeType: f.mimeType,
              })),
              asVersions: true,
            });
            if (result.attached > 0) {
              toast.success(
                `Attached ${result.attached} file${result.attached === 1 ? "" : "s"} as options`,
              );
            }
            if (result.skipped.length > 0) {
              toast.error(`Skipped: ${result.skipped.join(", ")}`);
            }
          }
        } catch (e) {
          showMutationError(e);
        } finally {
          // Always clears — a Picker that never loaded must not leave the
          // button dead for the rest of the session.
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <HardDrive className="size-3.5" />
      )}
      Attach from Drive
    </Button>
  );
}
