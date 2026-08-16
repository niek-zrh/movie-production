import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Google Drive integration (spec §7). These are placeholder signatures so
 * cross-module scheduler references typecheck; the full implementation
 * (connect flow, hub scaffold, uploads, picker attach, sync) replaces the
 * bodies in the M3 slice. Each internal hook is a quiet no-op until then.
 */

export const completeConnection = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (): Promise<{ returnTo: string }> => {
    throw new Error(
      "Drive integration requires GCP credentials — see README §Google setup",
    );
  },
});

/** Copies a picked version into Shots/{code}/Approved/ with the canonical name. */
export const copyPickToApproved = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (_ctx, args) => {
    console.log("drive.copyPickToApproved: hub not implemented yet", args);
  },
});

/** Mirrors a Convex-storage upload into the Drive hub once one is connected. */
export const mirrorUploadToHub = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (_ctx, args) => {
    console.log("drive.mirrorUploadToHub: hub not implemented yet", args);
  },
});

/** 5-minute metadata sync for every production with a connected hub. */
export const cronSync = internalAction({
  args: {},
  handler: async () => {
    // No productions can have hubs until the connect flow ships; nothing to do.
  },
});
