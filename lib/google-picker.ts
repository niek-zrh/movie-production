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

let loadPromise: Promise<PickerNamespace> | null = null;

function loadPickerApi(): Promise<PickerNamespace> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const ready = () => {
      window.gapi!.load("picker", () => {
        const ns = window.google?.picker;
        if (ns) resolve(ns);
        else reject(new Error("Google Picker failed to load"));
      });
    };
    if (window.gapi) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Could not load Google APIs script"));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Opens the Picker; resolves with picked files, or null when cancelled.
 * foldersOnly=true switches to folder-select mode (used to choose the Hub
 * parent). Multi-select is on for files, off for folders.
 */
export async function openDrivePicker(
  config: PickerConfig,
  opts: { foldersOnly?: boolean } = {},
): Promise<PickedFile[] | null> {
  const picker = await loadPickerApi();
  return new Promise((resolve) => {
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
          const docs = data[picker.Response.DOCUMENTS] as Record<
            string,
            string
          >[];
          resolve(
            docs.map((d) => ({
              id: d[picker.Document.ID],
              name: d[picker.Document.NAME],
              mimeType: d[picker.Document.MIME_TYPE],
            })),
          );
        } else if (action === picker.Action.CANCEL) {
          resolve(null);
        }
      });
    if (config.apiKey) builder = builder.setDeveloperKey(config.apiKey);
    if (!opts.foldersOnly)
      builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}
