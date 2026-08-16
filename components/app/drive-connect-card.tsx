"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Loader2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { openDrivePicker } from "@/lib/google-picker";
import { copy } from "@/lib/copy";

/**
 * Convex error messages can be multiline
 * ("[CONVEX M(...)] [Request ID: …] Server Error\nUncaught Error: …") —
 * surface only the human-readable line in toasts.
 */
export function firstErrorLine(message: string): string {
  const uncaught = message.match(/Uncaught (?:[A-Za-z]*Error): ?([^\n]*)/);
  if (uncaught && uncaught[1].trim()) return uncaught[1].trim();
  const first =
    message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0] ?? "";
  const stripped = first.replace(/^(\[[^\]]*\]\s*)+/, "").trim();
  return stripped || "Something didn't work — try again";
}

/** Server permission/invariant errors must surface as toasts (conventions). */
export function showMutationError(e: unknown): void {
  toast.error(
    e instanceof Error
      ? firstErrorLine(e.message)
      : "Something didn't work — try again",
  );
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * Drive hub connect card (spec §7.2) — shared by the setup wizard (/new,
 * step 2) and production settings. Walks through: connect my Google account
 * → choose where the hub lives → scaffold the folder tree → status card.
 */
export function DriveConnectCard({
  productionId,
  returnTo,
  canManage = true,
}: {
  productionId: Id<"productions">;
  returnTo: string;
  /** Only owners/producers may scaffold the hub (server enforces too). */
  canManage?: boolean;
}) {
  const status = useQuery(api.drive.connectionStatus, { productionId });
  const beginConnect = useMutation(api.drive.beginConnect);
  const getPickerConfig = useAction(api.drive.getPickerConfig);
  const scaffoldHub = useAction(api.drive.scaffoldHub);

  const [connecting, setConnecting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await beginConnect({ returnTo });
      window.location.href = url;
    } catch (e) {
      setConnecting(false);
      const message =
        e instanceof Error
          ? firstErrorLine(e.message)
          : "Something didn't work — try again";
      // (a) Drive not configured on the server — render inline, not as toast.
      if (message.toLowerCase().includes("not configured")) {
        setConfigError(message);
      } else {
        toast.error(message);
      }
    }
  };

  const scaffold = async (parentFolderId?: string) => {
    setCreating(true);
    try {
      await scaffoldHub({
        productionId,
        ...(parentFolderId !== undefined ? { parentFolderId } : {}),
      });
      setJustCreated(true);
    } catch (e) {
      showMutationError(e);
    } finally {
      setCreating(false);
    }
  };

  const pickFolderAndScaffold = async () => {
    try {
      const config = await getPickerConfig({});
      const picked = await openDrivePicker(config, { foldersOnly: true });
      if (!picked || picked.length === 0) return;
      await scaffold(picked[0].id);
    } catch (e) {
      showMutationError(e);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4 text-muted-foreground" /> Drive hub
        </CardTitle>
        <CardDescription>{copy.tagline}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : configError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {configError}
          </div>
        ) : status.hub.connected && status.hub.rootFolderId ? (
          <HubStatus
            rootFolderId={status.hub.rootFolderId}
            ownerEmail={status.hub.ownerEmail}
            revoked={status.hub.revoked === true}
            justCreated={justCreated}
            onReconnect={connect}
            reconnecting={connecting}
          />
        ) : !status.myConnection || status.myConnection.revoked ? (
          // (b) no usable personal connection yet → send them through OAuth.
          <div className="flex flex-col items-start gap-2">
            {status.myConnection?.revoked && (
              <p className="text-sm text-destructive">
                {copy.errors.driveExpired}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Connect your Google account so Slate can create and organize the
              production&apos;s folder tree in Drive.
            </p>
            <Button onClick={() => void connect()} disabled={connecting}>
              {connecting && <Loader2 className="size-4 animate-spin" />}
              {status.myConnection?.revoked
                ? copy.actions.reconnectDrive
                : copy.actions.connectDrive}
            </Button>
          </div>
        ) : canManage ? (
          // (c) connected, no hub yet → choose where the hub lives.
          <div className="flex flex-col gap-2.5">
            <p className="text-sm">
              Connected as{" "}
              <span className="font-medium">{status.myConnection.email}</span>.
            </p>
            {creating ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Creating folders…
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Choose where the Hub lives:
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => void scaffold()}>
                    <HardDrive className="size-4" /> My Drive root
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void pickFolderAndScaffold()}
                  >
                    <FolderOpen className="size-4" /> Pick a folder…
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Drive hub yet. An owner or producer can create one here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function HubStatus({
  rootFolderId,
  ownerEmail,
  revoked,
  justCreated,
  onReconnect,
  reconnecting,
}: {
  rootFolderId: string;
  ownerEmail?: string;
  revoked: boolean;
  justCreated: boolean;
  onReconnect: () => Promise<void>;
  reconnecting: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {justCreated && (
        <div className="flex items-center gap-2 rounded-lg border border-status-approved/25 bg-status-approved/10 p-3 text-sm text-status-approved">
          <CheckCircle2 className="size-4 shrink-0" />
          Hub created — the folder tree is ready in Drive.
        </div>
      )}
      {revoked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            {copy.errors.driveExpired}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onReconnect()}
            disabled={reconnecting}
          >
            {reconnecting && <Loader2 className="size-3.5 animate-spin" />}
            Reconnect
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-medium">Hub connected</p>
          <p className="truncate text-muted-foreground">
            {ownerEmail ? `Connected by ${ownerEmail}` : "Connected"}
          </p>
        </div>
        <a
          href={driveFolderUrl(rootFolderId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          {copy.actions.openInDrive} <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
