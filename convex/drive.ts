import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Google Drive integration (spec §7). Placeholder — the full module
 * (connect flow, hub scaffold, uploads, picker attach, pick-to-Approved,
 * sync) is implemented in the M3 slice.
 */
export const completeConnection = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (): Promise<{ returnTo: string }> => {
    throw new Error(
      "Drive integration requires GCP credentials — see README §Google setup",
    );
  },
});
