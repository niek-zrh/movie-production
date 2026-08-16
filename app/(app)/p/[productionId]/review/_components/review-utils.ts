import type { api } from "@/convex/_generated/api";

/** Enriched version shape returned by api.versions.listForShot. */
export type VersionCard = (typeof api.versions.listForShot._returnType)[number];

/** Enriched shot shape returned by api.shots.get. */
export type ShotDetail = typeof api.shots.get._returnType;

export type VersionStatus = VersionCard["status"];

/** Tiny status dot colors for version states (filmstrip + pane strips). */
export const VERSION_DOT: Record<VersionStatus, string> = {
  candidate: "bg-muted-foreground/50",
  shortlisted: "bg-status-options_ready",
  picked: "bg-tape",
  rejected: "bg-destructive",
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  candidate: "Candidate",
  shortlisted: "Shortlisted",
  picked: "Picked",
  rejected: "Rejected",
};

/**
 * Convex error messages can be multiline ("[CONVEX …] Server Error\n
 * Uncaught Error: …\n at …") — surface only the human line.
 */
export function firstErrorLine(e: unknown): string {
  if (!(e instanceof Error)) return "Something didn't work — try again";
  const marker = "Uncaught Error: ";
  const at = e.message.indexOf(marker);
  const rest = at >= 0 ? e.message.slice(at + marker.length) : e.message;
  const line = rest.split("\n")[0]?.trim();
  return line !== undefined && line !== ""
    ? line
    : "Something didn't work — try again";
}

/** File extension for the canonical approved filename. */
export function extensionOf(asset: VersionCard["asset"]): string {
  const name = asset?.name ?? "";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1);
  const sub = asset?.mimeType?.split("/")[1];
  return sub !== undefined && sub !== "" ? sub : "png";
}

export function isImageVersion(version: VersionCard): boolean {
  return version.asset?.mimeType?.startsWith("image/") ?? false;
}

/** Roles that may attempt decisions client-side (server is authoritative). */
export function roleCanDecide(role: string | null): boolean {
  return (
    role === "owner" ||
    role === "producer" ||
    role === "creative_director" ||
    role === "supervisor"
  );
}
