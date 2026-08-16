# Slate — build plan

Working name **Slate** (per mega prompt). Milestones from spec §11; a box is
checked only after its acceptance criteria passed locally (typecheck + build +
Playwright end-to-end run in `e2e/`).

## M0 — Foundation ✅
- [x] Scaffold Next 15 (App Router, TS strict) + Tailwind v4 + shadcn/ui
- [x] Convex local dev deployment (anonymous), schema pushed
- [x] Convex Auth: Password (dev fallback) + Google (activates via env)
- [x] Permissions helper (`assertCan`) + activity + notify helpers
- [x] Studio create / invite claim on sign-in / team management (F1)
- [x] App shell: left rail, topbar, studio switcher, notifications bell
- [x] Team page UI

## M1 — Structure ✅
- [x] Production setup wizard (Drive step functional but env-gated) (F2)
- [x] Episodes / scenes / shots CRUD, bulk-create from pasted codes (F5)
- [x] Shot table + grid views, filters, inline edits (F5)
- [x] Pipeline board, drag between stages, stage instances (F4)

## M2 — Decisions ✅
- [x] Versions + uploads (Convex storage behind the assets interface) (F6)
- [x] Shot detail: Options / Discussion / Files / History (F6)
- [x] Review Room: queue, N-up compare, synced zoom, hotkeys, pick flow (F7)
- [x] Stage gates: request sign-off, approve/reject with note (F4 gates)
- [x] Decisions ledger + CSV export (F9)
- [x] Activity rows from every state-changing mutation

## M3 — Drive ✅ (code complete; dormant until GCP credentials exist)
- [x] Connect Google Drive flow (OAuth code flow, `drive.file`) (§7.2)
- [x] Hub scaffold + member sharing (§7.3), wizard step 2 (F2)
- [x] Uploads to Hub via Hub token; Picker attach; canonical Approved copies (§7.4)
- [x] Sync cron + thumbnails in Convex storage; Files tab; missing-file state (F8)
- [x] README GCP setup guide (§7.6)
- [ ] Live end-to-end test against a real Drive — **needs the GCP OAuth client
      only you can create (README §Google setup); everything else is done.**

## M4 — Rhythm ✅
- [x] Overview dashboard (F3)
- [x] Daily report cron (18:00 production tz) + publish + notify (F10)
- [x] Notifications center + fan-out (F12)

## M5 — Delivery & polish ✅
- [x] QC template (studio) + QC runs (production) (F11)
- [x] Seed script (§12): Aurora North / SIGNAL LOST / 14 shots / activity
- [x] Design pass via full-app screenshot review; keyboard overlay (`?`)
- [x] README: quickstart, GCP guide, demo script (§13)
- [x] Demo (§13) verified end-to-end via Playwright (`e2e/qa-flow.mjs`) —
      studio → wizard → bulk shots → upload → review-room keyboard pick →
      gate request/approve → report generate/publish → QC run to passed →
      delivery sign-off in Decisions. Zero console errors.
- [x] Adversarial multi-agent review (24 findings raised, 21 confirmed, all
      confirmed fixes applied — see DECISIONS.md)

## Post-pilot backlog
See DECISIONS.md parking lot (resource planning first, Telegram fan-out,
video preview pipeline).
