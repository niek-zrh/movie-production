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

  if (status.myConnection === null) {
    return (
      <Link
        href={`/p/${productionId}/settings`}
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <HardDrive className="size-3.5" /> Connect Drive to attach files
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
