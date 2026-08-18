# Kinolab

Production orchestration for AI-native film studios. **Files live in Drive.
Decisions live here.** One calm overview per production, a stage-gated
pipeline, a shot list, a Review Room that formalizes the
options-screenshots-and-pick workflow, Google Drive as the file home, daily
production reports, and a TV-delivery QC checklist.

Built on Next.js 15 + Convex (realtime) + Tailwind v4 + shadcn/ui.
Spec: `stravi-pilot-mega-prompt.md` · decisions log: [DECISIONS.md](DECISIONS.md) ·
backend API contract: [docs/CONTRACTS.md](docs/CONTRACTS.md) · plan: [PLAN.md](PLAN.md).

---

## Quickstart (clone → seeded app in ~10 minutes)

Prerequisites: Node 20+, pnpm 9+.

```bash
pnpm install

# 1. Create the local Convex dev deployment (no account needed) and push:
CONVEX_AGENT_MODE=anonymous npx convex dev --once

# 2. Generate + store the Convex Auth signing keys on that deployment:
node scripts/setup-auth.mjs

# 3. Seed the demo studio (Aurora North / SIGNAL LOST):
CONVEX_AGENT_MODE=anonymous npx convex run seed:run

# 4. Run backend + frontend together:
pnpm dev            # convex dev + next dev → http://localhost:3000
```

Sign in with **email + password** (the dev fallback — Google sign-in activates
once you finish the Google setup below). Sign-up with one of these emails
(any password ≥ 8 chars) claims a seeded role:

| Email | Role |
|---|---|
| `niek.tenhove@gmail.com` | Owner |
| `producer@demo.slate` | Producer |
| `director@demo.slate` | Creative Director |
| `artist@demo.slate` | Artist |

Use two browser profiles (e.g. producer + director) to see realtime
collaboration — boards, review rooms and gate chips update live.

## The demo that must work (pilot acceptance, spec §13)

1. **Producer** signs in → opens **SIGNAL LOST** → Overview shows the stage
   strip, pending decisions, today's activity.
2. Board → column *Previews & Review* menu → **Request sign-off**. In the
   second browser, the **Creative Director** sees the approval (bell +
   Overview), approves with a note → the chip flips live in browser one.
3. **Artist** opens shot `SC010_SH020` → pastes/drops two images → versions
   v5, v6 appear (with a Drive hub connected they also land in
   `…/Shots/SC010_SH020/Options/`).
4. **Creative Director** → Review → `SC010_SH020`: `2`–`4` to compare,
   scroll to zoom (synced), `S` to shortlist two, `P` to **pick** with a note
   → siblings rejected, shot flips to *picked*, Decisions ledger + activity
   updated, artist notified. With a hub: the canonical file appears in
   `Approved/`.
5. **Producer** → Reports → **Generate now** → the day's picks/uploads/
   comments are in the report → **Publish** (everyone gets notified).
6. **Delivery engineer** (owner works) → QC → **New QC run** "EP01 — TV
   Master" → work the checklist to *passed* → it appears in Decisions as a
   delivery sign-off.
7. Drop a file into the Drive hub in Drive itself → Files → **Sync now** →
   it appears (unassigned) → **Attach to shot…**.

---

## Google setup (spec §7.6) — enables Google sign-in, Drive hub, Picker

The app runs fully without this (password auth + Convex-storage uploads).
Do this before the pilot so files live in the studio's own Drive.

1. Create a GCP project → enable **Google Drive API** and **Google Picker
   API** (APIs & Services → Library).
2. **OAuth consent screen**: External · app name "Kinolab" · scopes: `openid`,
   `email`, `profile`, `https://www.googleapis.com/auth/drive.file` (all
   non-sensitive → no CASA security assessment) · **Publish to "In
   production"** (do NOT stay in Testing — testing refresh tokens expire
   every 7 days and silently break sync).
3. **Credentials → OAuth client (Web application)** with redirect URIs
   (`<convex-site-url>` is `NEXT_PUBLIC_CONVEX_SITE_URL` from `.env.local`,
   e.g. `http://127.0.0.1:3211` locally):
   - `<convex-site-url>/api/auth/callback/google` (sign-in)
   - `<convex-site-url>/google/drive/callback` (Drive connect)
4. **Credentials → API key**, restricted to the Picker API (browser).
5. Note the **project number** (Console dashboard) — the Picker `appId`.
   Wrong value = picked files are NOT granted to the app (classic gotcha).
6. Set the env vars:

```bash
# on the Convex deployment:
npx convex env set AUTH_GOOGLE_ID <oauth-client-id>
npx convex env set AUTH_GOOGLE_SECRET <oauth-client-secret>
npx convex env set GOOGLE_DRIVE_CLIENT_ID <oauth-client-id>      # may reuse
npx convex env set GOOGLE_DRIVE_CLIENT_SECRET <oauth-client-secret>
npx convex env set GOOGLE_PICKER_API_KEY <api-key>

# in .env.local (browser):
NEXT_PUBLIC_GOOGLE_API_KEY=<api-key>
NEXT_PUBLIC_GOOGLE_APP_ID=<project-NUMBER>
```

Then in the app: production **Settings → Drive hub → Connect Google Drive**
→ choose where the hub lives → the folder tree is scaffolded and shared with
the team. Uploads, picks (canonical `Approved/` copies) and the 5-minute
metadata sync activate automatically.

How the integration behaves (spec §7): scope is only `drive.file` — the app
can touch nothing in anyone's Drive except the hub **it created** and files
users **explicitly picked**. All hub writes use the hub owner's token;
personal tokens only read files their owner picked. Thumbnails are cached in
Convex storage; full files never pass through the app.

## Going to Convex cloud (shared pilot deployment)

```bash
npx convex login
npx convex dev --once --configure=new   # attaches this repo to a cloud dev deployment
node scripts/setup-auth.mjs <your-app-url>
npx convex run seed:run                 # optional
# re-set the Google env vars on the cloud deployment (env vars don't migrate)
```

`.env.local` is rewritten automatically with the cloud
`NEXT_PUBLIC_CONVEX_URL`. Deploy the Next app anywhere (Vercel etc.) with
`NEXT_PUBLIC_CONVEX_URL` + `NEXT_PUBLIC_CONVEX_SITE_URL` set, and update
`SITE_URL` + the Google redirect URIs to the public URLs.

## Deploying with Docker (self-hosted Convex + Dokploy/Traefik)

`docker-compose.yml` follows the Corticum pattern: every
`docker compose up -d --build` first runs the one-shot **convex-deploy**
service (pushes `convex/` to the self-hosted backend), and only if that push
succeeds does the **frontend** container get (re)created — a new frontend
never serves against stale functions. Without
`CONVEX_SELF_HOSTED_ADMIN_KEY` set, the push logs a skip notice and the
frontend deploys as before.

Prerequisites: a self-hosted Convex backend (the official
`ghcr.io/get-convex/convex-backend` compose) reachable at e.g.
`https://api.kinolab.ai`, and its admin key (`generate_admin_key.sh` in the
backend container). Traefik/Dokploy with the external `dokploy-network`.

Environment (in Dokploy's compose Environment tab):

```bash
CONVEX_SELF_HOSTED_URL=https://api.kinolab.ai
CONVEX_SELF_HOSTED_ADMIN_KEY=<never commit this>
NEXT_PUBLIC_CONVEX_URL=https://api.kinolab.ai   # inlined at build → rebuild to change
```

One-time backend setup (from any machine, same two env vars exported):

```bash
node scripts/setup-auth.mjs https://app.kinolab.ai   # JWT keys + SITE_URL
npx convex env set GOOGLE_DRIVE_CLIENT_ID …          # Google vars, see above
npx convex run seed:run                              # optional demo data
```

The frontend serves on port 8090 with `GET /api/health` as the container
healthcheck; Traefik routes `app.kinolab.ai` to it (edit the labels in
`docker-compose.yml` for other domains). The Google OAuth redirect URIs must
point at the backend's **site origin** (HTTP-actions URL) —
`<site-origin>/google/drive/callback` — see the backend's
`CONVEX_SITE_ORIGIN` setting.

## E2E smoke tests

With `pnpm dev` running (and the seed applied):

```bash
SHOTS_DIR=/tmp/slate-shots node e2e/qa-flow.mjs    # full §13 demo: studio → wizard →
                                                   # bulk shots → upload → review-room
                                                   # keyboard pick → gates → report → QC
QA_SIGNUP=1 SHOTS_DIR=/tmp/slate-shots node e2e/qa-aurora.mjs  # screenshot walk of every
                                                   # seeded Aurora North screen
```

Each run creates throwaway users/studios in the local dev DB; multi-tenant
isolation keeps them invisible to real accounts.

## Repo map

```
app/                  Next.js routes (App Router)
  (auth)/sign-in      Sign-in (password fallback + Google)
  (app)/              Shell: studio home, team, /new wizard, /p/[productionId]/*
components/app        Kinolab components (slate-strip, status-pill, shell…)
components/ui         shadcn/ui primitives (Base UI generation)
convex/               Backend: schema, auth, modules per docs/CONTRACTS.md
  lib/                permissions (assertCan), activity, notify, domain, google (Drive REST)
  seed.ts             npx convex run seed:run
lib/                  client helpers (copy, format, hotkeys, google-picker)
scripts/setup-auth.mjs  Convex Auth key generation
```

Working agreements: every mutation is permission-checked server-side and
writes one human-readable activity row; picks/approvals are immutable;
tokens never reach a client. UI tokens and the two-mood design system live
in `app/globals.css` (spec §9).
