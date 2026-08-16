# Decisions log

Format: date — decision — why. Spec references are to the mega prompt
(`stravi-pilot-mega-prompt.md`).

- 2026-08-17 — **Working name "Slate" used in UI.** Spec calls it the working
  name; the shell, sign-in and README use it consistently.
- 2026-08-17 — **Dev auth fallback: Convex Auth Password provider** alongside
  Google. Google OAuth requires the studio's GCP client (user will set up
  later); Password keeps the app usable/testable now. Google activates
  automatically when `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set on the
  deployment. Pilot onboarding should use Google sign-in.
- 2026-08-17 — **Convex anonymous local deployment** for development; linking
  to a Convex cloud project is a later one-liner (`npx convex login` +
  `npx convex dev --configure`).
- 2026-08-17 — **Asset provider `storage` added** to the spec's
  `gdrive | url` union: file bytes in Convex storage. This is the sanctioned
  M2 interim upload path (spec §11 M2) kept as a permanent fallback so every
  flow (upload, review, pick) works before a Drive hub is connected. On
  connect, new uploads go to Drive; pick-to-Approved copies only apply to
  Drive-backed assets.
- 2026-08-17 — **Drive API via REST (`fetch`) instead of the `googleapis`
  package.** Same server-side calls and scopes, but no huge dependency inside
  the Convex bundle and no `"use node"` runtime needed. Behavior per spec §7
  is unchanged (all writes with the Hub token, `supportsAllDrives=true`
  everywhere).
- 2026-08-17 — **Direct-upload cutoff 20 MB, not 25 MB** — Convex HTTP action
  request limit is 20 MiB. Larger files: "add big files in Drive, they'll
  appear here on next sync" (spec's own fallback).
- 2026-08-17 — **Daily-report cron runs hourly (UTC)** and fires a
  production's report when its local time passes 18:00 (Convex crons are
  UTC-only). Idempotent per (production, date).
- 2026-08-17 — **Invites claim on sign-in with matching email; no email
  sending anywhere** (spec F1). The team page shows the pending invite so the
  producer can tell people out-of-band (their Telegram).
- 2026-08-17 — **Seed placeholders are SVG, not PNG** — gradients + burned-in
  shot code, generated with zero dependencies and no network, stored in
  Convex storage. Browsers render them identically in cards and the Review
  Room compare.
- 2026-08-17 — **Membership `userId` made optional** in the schema (spec had
  it required with a separate `invitedEmail`): a pending invite is a
  membership row without a user, which makes "invite = membership row"
  literal and claim-on-signin atomic.
- 2026-08-17 — **shadcn/ui current generation (Base UI primitives)** — the
  CLI now installs `@base-ui/react`-based components rather than Radix.
  Accepted as-is; visual system is ours via tokens.
- 2026-08-17 — **Telegram notification fan-out**: `convex/lib/notify.ts` is
  the single fan-out point where a Telegram webhook can be added post-pilot.
- 2026-08-17 — **Parked (top post-pilot candidate): resource planning**, per
  spec §14.

- 2026-08-17 — **Adversarial review round applied** (multi-agent find →
  refute → fix): pick() now refuses to regress approved/final/delivered/
  killed shots; @mentions are filtered to studio members and notification
  hrefs validated against the production path (cross-studio injection
  closed); QC runs with zero required checks can no longer auto-pass;
  attach-to-shot refuses assets that already back a version; malformed URL
  filter ids no longer crash the shots query; due dates are clearable;
  Settings tab hidden for non-managers and the active studio auto-follows
  the production being viewed; Drive lib hardened (random multipart
  boundary, full pagination, refresh-token rotation, 10-min OAuth state
  TTL, folder-creation compare-and-set); user-facing server errors use
  `ConvexError` so messages survive production deployments' redaction.
- 2026-08-17 — **E2E harness**: `e2e/qa-flow.mjs` runs the full §13 demo
  (minus live Drive) headlessly via Playwright against the dev servers;
  `e2e/qa-aurora.mjs` walks every seeded screen. QA users/studios created in
  the local DB are invisible to real users (multi-tenant isolation).
- 2026-08-17 — **Known limitation**: the seeded "yesterday" daily report has
  fabricated stats and an empty full-day list — Convex `_creationTime`
  cannot be backdated, so seeded activity is all "today" (which makes
  "Generate now" demos rich instead).

## Post-pilot parking lot
1. Resource planning / workload view (raised in discovery, spec §14).
2. Telegram notification delivery via `lib/notify.ts` fan-out.
3. Full-res video preview pipeline (currently: poster + Open in Drive).
