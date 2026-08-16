# Slate — build plan

Working name **Slate** (per mega prompt). Milestones from spec §11; boxes are
checked only when the milestone's acceptance criteria pass locally.

## M0 — Foundation
- [x] Scaffold Next 15 (App Router, TS strict) + Tailwind v4 + shadcn/ui
- [x] Convex local dev deployment (anonymous), schema pushed
- [x] Convex Auth: Password (dev fallback) + Google (activates via env)
- [x] Permissions helper (`assertCan`) + activity + notify helpers
- [x] Studio create / invite claim on sign-in / team management (F1)
- [ ] App shell: left rail, topbar, studio switcher, notifications bell
- [ ] Team page UI

## M1 — Structure
- [ ] Production setup wizard steps 1+3 (Drive step stubbed) (F2 partial)
- [ ] Episodes / scenes / shots CRUD, bulk-create from pasted codes (F5)
- [ ] Shot table + grid views, filters, inline edits (F5)
- [ ] Pipeline board, drag between stages, stage instances (F4 minus gates)

## M2 — Decisions
- [ ] Versions + uploads (Convex storage behind the assets interface) (F6)
- [ ] Shot detail: Options / Discussion / Files / History (F6)
- [ ] Review Room: queue, N-up compare, synced zoom, hotkeys, pick flow (F7)
- [ ] Stage gates: request sign-off, approve/reject with note (F4 gates)
- [ ] Decisions ledger + CSV export (F9)
- [ ] Activity rows from every state-changing mutation

## M3 — Drive
- [ ] Connect Google Drive flow (OAuth code flow, `drive.file`) (§7.2)
- [ ] Hub scaffold + member sharing (§7.3), wizard step 2 (F2)
- [ ] Uploads to Hub via Hub token; Picker attach; canonical Approved copies (§7.4)
- [ ] Sync cron + thumbnails in Convex storage; Files tab; missing-file state (F8)
- [ ] README GCP setup guide (§7.6)
- Note: code complete + dormant until GCP credentials exist; storage fallback
  stays active for every flow so the pilot is demoable without Google.

## M4 — Rhythm
- [ ] Overview dashboard (F3)
- [ ] Daily report cron (18:00 production tz) + publish + notify (F10)
- [ ] Notifications center + fan-out (F12)

## M5 — Delivery & polish
- [ ] QC template (studio) + QC runs (production) (F11)
- [ ] Seed script (§12): Aurora North / SIGNAL LOST / 14 shots / activity
- [ ] Design pass against §9 on every screen; keyboard overlay (`?`)
- [ ] README: quickstart, GCP guide, demo script (§13)
- [ ] Demo (§13) runs end-to-end locally
