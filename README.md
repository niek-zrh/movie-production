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

# 3. Seed the demo studio (Aurora North / SIGNAL LOST). LOCAL DEMOS ONLY —
#    never against the pilot backend, see §Go-live checklist:
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

Those four rows are **claimable pending invites**: the password provider does
not verify email ownership, so whoever registers with one of these addresses
takes that seat — including the owner seat. Fine on a local dev backend (where
sign-ups are open by design), never on the pilot backend.

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
5. Set the env vars:

```bash
# on the Convex deployment:
npx convex env set AUTH_GOOGLE_ID <oauth-client-id>
npx convex env set AUTH_GOOGLE_SECRET <oauth-client-secret>
npx convex env set GOOGLE_DRIVE_CLIENT_ID <oauth-client-id>      # may reuse
npx convex env set GOOGLE_DRIVE_CLIENT_SECRET <oauth-client-secret>
npx convex env set GOOGLE_PICKER_API_KEY <api-key>
```

That is the whole inventory — nothing Google-related belongs in `.env.local`.
The browser never sees these: the Picker gets its `apiKey`, a short-lived
access token and the `appId` from `drive.getPickerConfig`, which derives the
`appId` from the numeric prefix of the OAuth client id (that prefix *is* the
GCP project number).

**What this costs: nothing.** The OAuth client id/secret and the Picker API
key identify *this application* to Google — they are not metered and they do
not require a billing account on the GCP project. Sign in with Google, the
Drive API and the Picker API are free; they have per-day quotas, not charges.
One client serves the whole studio: every member signs in with their own
Google account, and each person's Drive connection is stored per-user.

If the studio runs on Google Workspace, create the OAuth client as **Internal**
— then only Workspace accounts can use it and Google requires no app
verification at all.

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
npx convex run seed:run                 # demo deployments only — plants
                                        # claimable invites (see §Go-live checklist)
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

The pilot environment:

| What | URL |
|---|---|
| Frontend (this compose, via Traefik) | `https://pilot.kinolab.ai` |
| Convex backend API (`CONVEX_CLOUD_ORIGIN`) | `https://api.kinolab.ai` |
| Convex HTTP actions (`CONVEX_SITE_ORIGIN`) | `https://actions.kinolab.ai` |

Prerequisites: the self-hosted Convex backend — `deploy/convex-backend.compose.yml`
(pinned backend + dashboard images, nightly export service) deployed as its
own Dokploy project with the two origins above — its admin key
(`generate_admin_key.sh` in the backend container), and Traefik/Dokploy with
the external `dokploy-network`.

Environment (in Dokploy's compose Environment tab — the compose also accepts
`NEXT_PUBLIC_DEPLOYMENT_URL` as the API-origin fallback, matching the
dashboard's variable):

```bash
CONVEX_SELF_HOSTED_URL=https://api.kinolab.ai
CONVEX_SELF_HOSTED_ADMIN_KEY=<never commit this>
NEXT_PUBLIC_CONVEX_URL=https://api.kinolab.ai       # inlined at build → rebuild to change
NEXT_PUBLIC_CONVEX_SITE_URL=https://actions.kinolab.ai  # also feeds the CSP (build time)
ALLOWED_HOSTS=pilot.kinolab.ai                      # hosts allowed into redirect URLs
FORCE_HTTPS=1                                       # served only via TLS proxies
```

`.env.local.example` carries the full inventory of every variable this app
reads, on all four surfaces: frontend build args, frontend runtime, the Convex
deployment (`npx convex env set …`) and the backend compose project.

One-time backend setup (from any machine, with those two `CONVEX_SELF_*`
vars exported):

```bash
node scripts/setup-auth.mjs https://pilot.kinolab.ai  # JWT keys + SITE_URL
npx convex env set INVITE_ONLY_SIGNUPS 1              # close registration (see below)
npx convex env set ADMIN_SIGNUP_ALLOWLIST you@studio.com  # bootstrap the first owner
npx convex env set GOOGLE_DRIVE_CLIENT_ID …           # Google vars, see above
```

**Do NOT run `npx convex run seed:run` against the pilot backend.** The demo
seed is for local demos: it plants pending invites for
`niek.tenhove@gmail.com` (owner), `producer@`, `director@` and
`artist@demo.slate`, and because the password provider does not verify email
ownership, anyone who registers with one of those addresses claims that seat.
If it has already been run there, remove those memberships — see §Go-live
checklist.

The frontend serves on port 8090 with `GET /api/health` as the container
healthcheck; Traefik routes `pilot.kinolab.ai` to it. Google OAuth redirect
URIs for this environment point at the **actions origin**:

- `https://actions.kinolab.ai/api/auth/callback/google` (sign-in)
- `https://actions.kinolab.ai/google/drive/callback` (Drive connect)

(Inside Convex functions, `CONVEX_SITE_URL` is populated from the backend's
`CONVEX_SITE_ORIGIN`, so the app builds these URLs automatically.)

## Go-live checklist (pilot backend)

Work top to bottom. Everything here is a decision someone has to make once;
none of it has a safe default that guesses right.

1. **Close registration.** The gate lives in `convex/auth.ts` and fails
   closed, but set it explicitly so nobody has to reason about defaults:

   ```bash
   npx convex env set INVITE_ONLY_SIGNUPS 1
   npx convex env set ADMIN_SIGNUP_ALLOWLIST you@studio.com   # comma-separated
   ```

   Precedence: `INVITE_ONLY_SIGNUPS=1` forces invite-only · else
   `ALLOW_OPEN_SIGNUPS=1` opens registration · else invite-only everywhere
   except a local dev backend (detected from `CONVEX_SITE_URL` pointing at
   `127.0.0.1` / `localhost` / `[::1]`). With the gate on, a new account is
   created only when the email has a pending invite, is on
   `ADMIN_SIGNUP_ALLOWLIST`, or the backend has no users at all (first boot).
   Existing users always sign in. **Never set `ALLOW_OPEN_SIGNUPS` on the
   pilot** — the password provider does not verify email ownership, so open
   registration means anyone with the URL can create an account.

2. **Onboard the studio by invite.** Owner (an allowlisted email) signs up
   first, then Team → invite each person with their role. They sign up with
   that exact email and the membership attaches on first sign-in.

3. **Never seed the pilot backend.** `npx convex run seed:run` plants
   claimable pending invites — `niek.tenhove@gmail.com` (owner),
   `producer@`, `director@`, `artist@demo.slate`. If it has already been run
   against the pilot:
   - In the app (as owner): Team → remove every demo row — the pending
     invites *and* any account that has already claimed one.
   - Or in the dashboard (SSH tunnel, Data tab): delete the `memberships`
     rows whose `invitedEmail` is one of those addresses, and for seats
     already claimed also the `users` row and its `authAccounts` row (the
     password credential — without it the address can no longer sign in).
   - The seeded demo studio *Aurora North / SIGNAL LOST* itself is harmless
     once no membership points at it, but delete it too if the studio will
     see it.

4. **Backups running and restored once** — §Backups and restore.
5. **Images pinned** (they are, in `deploy/convex-backend.compose.yml`) —
   §Upgrading the self-hosted backend.
6. **`ALLOWED_HOSTS` set** for the frontend — §Security headers and the host
   allowlist.
7. **Decide the Cloudflare → origin hop** — §The Cloudflare → origin hop.
8. Keys and secrets: `INSTANCE_SECRET` and the admin key never leave the
   server or a password manager; `.env*` is gitignored and everything in
   `.env.local.example` is a placeholder.
9. **Know the one gap you are shipping with: there is no password reset.**
   The Password provider is the pilot fallback and there is no email sender
   wired up, so a forgotten password cannot be reset from inside the app and
   an owner cannot reset it for someone else. Over a pilot with 20+ people,
   someone will forget. Until a reset flow exists (it needs an email provider,
   e.g. Resend via `@convex-dev/auth`), plan for it:
   - Tell the crew at hand-over to save the password in their browser or a
     password manager. This is the cheapest mitigation by far.
   - Finish the **Google sign-in** setup (§Google setup) before the pilot if
     you can — Google accounts recover themselves and remove this problem
     entirely for everyone who uses them.
   - Recovery of last resort, from the server: the person signs up again with
     a *different* address, an owner invites that address to the same role,
     and the old membership is removed. Their past decisions, comments and
     uploads stay attributed to the old identity — history is immutable by
     design, so this is a new person in the ledger, not a rename.

## Backups and restore

The studio's entire production record — every decision, pick, gate, report,
QC run and uploaded image — lives in the single `convex-data` Docker volume.
The volume is not a backup: one `docker volume rm`, one disk failure, one bad
upgrade and the pilot is gone.

`deploy/convex-backend.compose.yml` runs a **`kinolab-convex-backup`**
service: every `BACKUP_INTERVAL_SECONDS` (default 24h) it runs
`npx convex export --include-file-storage` against the backend over the
compose network and writes `kinolab-<UTC timestamp>.zip` into `BACKUP_DIR`
(default `./backups` on the host), keeping `BACKUP_KEEP_DAYS` (default 14)
days. It needs `CONVEX_SELF_HOSTED_ADMIN_KEY` in that project's `.env`;
without it the service logs `NO BACKUP IS BEING TAKEN` and waits.

**Verify it once, by hand — an unverified backup is a wish:**

```bash
docker compose logs -f kinolab-convex-backup     # expect "[backup] ok: /backups/…zip"
ls -lh backups/                                  # a zip, tens of MB, not 0 bytes
unzip -l backups/kinolab-*.zip | head            # tables + a _storage folder
```

Or take one on demand from any machine (same command the service runs):

```bash
export CONVEX_SELF_HOSTED_URL=https://api.kinolab.ai
export CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key>
npx convex export --include-file-storage --path ./kinolab-$(date -u +%Y%m%dT%H%M%SZ).zip
```

Prefer a host cron over the service? Same thing, one line:

```cron
17 3 * * * cd /etc/dokploy/compose/kinolab-convex && CONVEX_SELF_HOSTED_URL=https://api.kinolab.ai CONVEX_SELF_HOSTED_ADMIN_KEY=$(cat admin.key) npx --yes convex@1.44.0 export --include-file-storage --path backups/kinolab-$(date -u +\%Y\%m\%dT\%H\%M\%SZ).zip
```

**Copy the zips off this machine.** A backup on the server it backs up dies
with it — `scp`/`rsync` `backups/` to a laptop or object storage daily.

### Restore

```bash
export CONVEX_SELF_HOSTED_URL=https://api.kinolab.ai
export CONVEX_SELF_HOSTED_ADMIN_KEY=<admin key>
npx convex import --replace-all kinolab-20260818T030000Z.zip
```

`--replace-all` overwrites every table in the deployment with the snapshot's
contents, so it restores users, memberships and file storage together. Do a
dry run **before** go-live against a throwaway backend (a second compose
project, or a local `npx convex dev`) and sign in to it — that is the only
way to know the zip is real. If Google Drive was connected, reconnect it
after a restore: refresh tokens in the snapshot may have been revoked.

## Upgrading the self-hosted backend

`deploy/convex-backend.compose.yml` pins the backend and dashboard to an
explicit build tag (`CONVEX_IMAGE_TAG`, default
`c0cb7ae17f54e14846c243c5332a8a5e6d0e19d4` — what ghcr's `latest` resolved to
on 2026-08-18; get-convex publishes one immutable commit-sha tag per build).
`:latest` is not used on purpose: with it, any container recreate — a restart,
a Dokploy redeploy, a host reboot — can swap the database engine under a live
pilot.

To upgrade deliberately:

1. Take an export and copy it off the host (§Backups and restore).
2. Pick the new tag: `latest` today resolves to
   `docker manifest inspect ghcr.io/get-convex/convex-backend:latest` — or
   read the tag from the upstream `self-hosted/docker/docker-compose.yml`.
3. Set `CONVEX_IMAGE_TAG=<new tag>` in the backend project's `.env`
   (backend and dashboard share the tag) and `docker compose up -d`.
4. Check `/version`, sign in, open a production. If it misbehaves, put the
   old tag back — and if the data migrated forward, restore the export.

## The Cloudflare → origin hop

Every Traefik router in `docker-compose.yml` and
`deploy/convex-backend.compose.yml` uses `${TRAEFIK_ENTRYPOINT:-web}`, i.e.
**plain HTTP between the proxy and the containers**. TLS ends at Cloudflare;
session cookies and all app traffic cross the Cloudflare → origin hop
unencrypted. On a single host where Traefik and the containers share a
private Docker network that is a small exposure; over a public network
between Cloudflare and this server it is not.

Pick one:

- **Cloudflare Full (strict) + an origin certificate** (simplest, recommended
  here). In Cloudflare: SSL/TLS → Overview → *Full (strict)*; SSL/TLS →
  Origin Server → create an Origin Certificate for `*.kinolab.ai`, install it
  on Traefik as the default cert. Then set, in both compose projects'
  environments:

  ```bash
  TRAEFIK_ENTRYPOINT=websecure
  TRAEFIK_TLS=1
  ```

- **A `websecure` entrypoint with a resolver** (Let's Encrypt). Same two
  variables, plus a `certresolver` label — the commented lines in both compose
  files. It cannot be an env var with a blank default: Traefik rejects a
  router whose `tls.certresolver` is empty.

The entrypoint is a variable rather than a hardcoded change because the
switch takes the site down if this Traefik has no matching entrypoint or
resolver. Verify the entrypoint exists in the Traefik dashboard first, then
flip both projects and reload one at a time.

## Security headers and the host allowlist

`next.config.ts` sends, on every route: a Content-Security-Policy,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
that switches off camera/microphone/geolocation/payment/USB, and (production
builds only) HSTS for a year including subdomains.

The CSP allows what this app actually uses: the Convex API + WebSocket
origins, the Convex HTTP-actions origin, Google Fonts, and the Google
Picker/Drive endpoints; `'unsafe-inline'` scripts and styles are allowed
because Next inlines both. Its origins come from `NEXT_PUBLIC_CONVEX_URL` and
`NEXT_PUBLIC_CONVEX_SITE_URL`, and Next bakes headers in at **build** time —
changing either needs a rebuild, exactly like the public Convex URL. Escape
hatches, both build args: `CSP_EXTRA_ORIGINS` (comma-separated additions) and
`CSP_REPORT_ONLY=1` (ship the policy report-only while keeping the other
headers enforced).

`ALLOWED_HOSTS` (comma-separated, port optional) is the set of hosts whose
inbound `Host` header the middleware is willing to copy into redirect URLs.
Without it, `Host: evil.example` came back as
`Location: https://evil.example/sign-in` and Traefik's host rule was the only
guard. An unrecognised host now falls back to the first entry, so redirects
land on the real site. Unset, only local development hosts are trusted
(`localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`) — `pnpm dev` and the Playwright
suite need no configuration, and a real deployment fails closed. **Set it to
the public host** (`pilot.kinolab.ai`) wherever the app is deployed; keep it
in step with the Traefik `Host()` rule.

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
  seed.ts             npx convex run seed:run (local demos only)
lib/                  client helpers (copy, format, hotkeys, google-picker)
scripts/setup-auth.mjs  Convex Auth key generation
deploy/convex-backend.compose.yml  self-hosted Convex backend + dashboard + nightly export
docker-compose.yml    frontend (+ one-shot function push) behind Traefik
```

Working agreements: every mutation is permission-checked server-side and
writes one human-readable activity row; picks/approvals are immutable;
tokens never reach a client. UI tokens and the two-mood design system live
in `app/globals.css` (spec §9).
