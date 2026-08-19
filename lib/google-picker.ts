"use client";

/**
 * Google Picker loader (spec §7.2/§7.4). The Picker is the only Google
 * surface that runs in the browser; it is initialized with the user's own
 * short-lived access token from api.drive.getPickerConfig.
 */

export type PickerConfig = {
  accessToken: string;
  apiKey: string;
  appId: string;
};

export type PickedFile = { id: string; name: string; mimeType?: string };

type PickerNamespace = {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: unknown) => DocsView;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  Feature: { MULTISELECT_ENABLED: unknown; SUPPORT_DRIVES: unknown };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string; MIME_TYPE: string };
};

interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  enableFeature(feature: unknown): PickerBuilder;
  setCallback(cb: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface DocsView {
  setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled(enabled: boolean): DocsView;
  setMimeTypes(types: string): DocsView;
}

declare global {
  interface Window {
    gapi?: { load: (api: string, cb: () => void) => void };
    google?: { picker?: PickerNamespace };
  }
}

/**
 * apis.google.com can never answer at all — ad blocker, corporate proxy,
 * offline, or (for this studio) Google being unreachable from the network.
 * Neither onload nor onerror fires then, so without a deadline the promise
 * never settles and the caller's spinner latches for the whole session.
 */
const SCRIPT_TIMEOUT_MS = 15_000;
const SCRIPT_ID = "google-api-js";
const SCRIPT_SRC = "https://apis.google.com/js/api.js";

/** Shown to the user, so it must say what to do — not "load failed". */
const UNREACHABLE =
  "Couldn't reach Google — check the connection (or a blocker/extension) and try again";
const NOT_LOADED = "Google Picker didn't load — try again";

let loadPromise: Promise<PickerNamespace> | null = null;

function loadPickerApi(): Promise<PickerNamespace> {
  if (loadPromise) return loadPromise;
  const attempt = new Promise<PickerNamespace>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(
      () => fail(new Error(UNREACHABLE)),
      SCRIPT_TIMEOUT_MS,
    );
    const done = (ns: PickerNamespace) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ns);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    };
    const ready = () => {
      const gapi = window.gapi;
      // Script tag fired load but gapi is absent — treat as unreachable
      // rather than throwing out of an event handler.
      if (!gapi) {
        fail(new Error(UNREACHABLE));
        return;
      }
      try {
        gapi.load("picker", () => {
          const ns = window.google?.picker;
          if (ns) done(ns);
          else fail(new Error(NOT_LOADED));
        });
      } catch {
        fail(new Error(NOT_LOADED));
      }
    };
    if (window.gapi) {
      ready();
      return;
    }
    // Reuse the tag from an earlier attempt: a script that timed out may still
    // be in flight, and a second <script> would only race it.
    const existing = document.getElementById(SCRIPT_ID);
    const script =
      existing instanceof HTMLScriptElement
        ? existing
        : document.createElement("script");
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", () => fail(new Error(UNREACHABLE)), {
      once: true,
    });
    if (script !== existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  // Cache successes only. A cached rejection (or a cached promise that never
  // settled) would kill "Attach from Drive" and "Pick a folder…" for the rest
  // of the session; dropping it lets the next click start over.
  loadPromise = attempt;
  void attempt.catch(() => {
    if (loadPromise === attempt) loadPromise = null;
  });
  return attempt;
}

/**
 * Opens the Picker; resolves with picked files, or null when cancelled.
 * foldersOnly=true switches to folder-select mode (used to choose the Hub
 * parent). Multi-select is on for files, off for folders.
 * Rejects with a user-readable message when Google can't be loaded — callers
 * surface it as a toast and stay clickable.
 */
export async function openDrivePicker(
  config: PickerConfig,
  opts: { foldersOnly?: boolean } = {},
): Promise<PickedFile[] | null> {
  const picker = await loadPickerApi();
  return new Promise((resolve, reject) => {
    let settled = false;
    // The Picker may call back more than once (e.g. "loaded" then "cancel").
    const finish = (result: PickedFile[] | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const view = new picker.DocsView(
      opts.foldersOnly ? picker.ViewId.FOLDERS : picker.ViewId.DOCS,
    );
    if (opts.foldersOnly) {
      view.setIncludeFolders(true);
      view.setSelectFolderEnabled(true);
      view.setMimeTypes("application/vnd.google-apps.folder");
    }
    let builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.accessToken)
      .setAppId(config.appId)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) {
          const docs =
            (data[picker.Response.DOCUMENTS] as
              | Record<string, string>[]
              | undefined) ?? [];
          finish(
            docs
              .filter((d) => typeof d[picker.Document.ID] === "string")
              .map((d) => ({
                id: d[picker.Document.ID],
                name: d[picker.Document.NAME] ?? "Untitled",
                mimeType: d[picker.Document.MIME_TYPE],
              })),
          );
        } else if (action === picker.Action.CANCEL) {
          // Closed without choosing — a normal outcome, not an error.
          finish(null);
        }
      });
    if (config.apiKey) builder = builder.setDeveloperKey(config.apiKey);
    if (!opts.foldersOnly)
      builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    try {
      builder.build().setVisible(true);
    } catch (e) {
      // A bad token/appId throws here; without this the promise would hang.
      reject(e instanceof Error ? e : new Error(NOT_LOADED));
    }
  });
}
