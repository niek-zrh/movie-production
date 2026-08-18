/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as approvals from "../approvals.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as drive from "../drive.js";
import type * as drive_http from "../drive_http.js";
import type * as episodes from "../episodes.js";
import type * as externalLinks from "../externalLinks.js";
import type * as http from "../http.js";
import type * as lib_activity from "../lib/activity.js";
import type * as lib_domain from "../lib/domain.js";
import type * as lib_google from "../lib/google.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as notifications from "../notifications.js";
import type * as productions from "../productions.js";
import type * as qc from "../qc.js";
import type * as reports from "../reports.js";
import type * as scenes from "../scenes.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as shots from "../shots.js";
import type * as studios from "../studios.js";
import type * as users from "../users.js";
import type * as versions from "../versions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  approvals: typeof approvals;
  assets: typeof assets;
  auth: typeof auth;
  comments: typeof comments;
  crons: typeof crons;
  drive: typeof drive;
  drive_http: typeof drive_http;
  episodes: typeof episodes;
  externalLinks: typeof externalLinks;
  http: typeof http;
  "lib/activity": typeof lib_activity;
  "lib/domain": typeof lib_domain;
  "lib/google": typeof lib_google;
  "lib/notify": typeof lib_notify;
  "lib/permissions": typeof lib_permissions;
  notifications: typeof notifications;
  productions: typeof productions;
  qc: typeof qc;
  reports: typeof reports;
  scenes: typeof scenes;
  search: typeof search;
  seed: typeof seed;
  shots: typeof shots;
  studios: typeof studios;
  users: typeof users;
  versions: typeof versions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
