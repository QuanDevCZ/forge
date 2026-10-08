# CLAUDE.md

Forge — personal training tracker PWA for the user's iPhone. `README.md` covers what it does
and the deploy/install/notification setup. `plan.txt` is the agreed plan. This file covers how
the code is arranged and what must not break.

Read `about-this-project.md` at the start of every session — it holds the owner's own context
(purpose, priorities, what to avoid) that the code doesn't show.

## Commands

```bash
npm test                   # node --test — the whole suite, zero dependencies
py -m http.server 8138     # local serve; `npx serve` redirects index.html, which breaks the SW cache
node tools/make-icons.mjs  # icons/*.png, pure Node
cd worker && npx wrangler deploy --dry-run --outdir <tmp>   # check the Worker bundles
```

Single test file / single test (tests live in `test/*.test.js`, one per pure module plus `webpush` and `worker`):

```bash
node --test test/schedule.test.js
node --test --test-name-pattern="streak" test/penalties.test.js
```

No build, no bundler, no `dependencies`. Hosted as static files on GitHub Pages.

## Data flow

`store.js` (IndexedDB) → `app.js` loads raw data → `model.compute(data, now)` derives everything the
screens render → `ui/*.js` draw it; every mutation goes through `app.js`, which re-derives. Push state is
separate: `model.pushState()` builds the snapshot that `push.js` POSTs to the Worker's `/state`
(Bearer TOKEN); the Worker's cron then runs `reminders.js` against that snapshot.

Cloud backup (since 2026-10-07, after the phone's data was lost — see `plan.txt`): after each render
`app.js` POSTs the full `store.exportAll()` to `/backup` when it changed, so the Worker *does* hold the
whole log, in KV `backup` plus `backup:YYYY-MM-DD` copies kept 30 days. "Save & enable" on a phone with
no sessions restores from `/restore` first. The Worker returns 409 for an empty export over one that holds
data — that guard is what stops a fresh install from wiping the only copy. Don't remove it.

Secrets: `worker/.dev.vars` (VAPID keys + token) is git-ignored — never commit it; `tools/push-secrets.mjs`
uploads it as Worker secrets. Deploy/setup steps are in `README.md`.

## Module split — the load-bearing boundary

```
src/schedule.js   PURE  week template, due sessions, status (done/late/pending/overdue/missed), moves
src/penalties.js  PURE  miss → debt, payOldest, streak, discipline score
src/stats.js      PURE  e1RM, tonnage, adherence, pace, weight avg/trend
src/feedback.js   PURE  rules → ranked findings + weekly verdict (THRESHOLDS at top)
src/model.js      PURE  compute(): stored data → everything the screens show; pushState()
src/reminders.js  PURE  which push notifications are due now (used by the Worker only)
src/store.js      browser  IndexedDB + export/import
src/push.js       browser  Worker client: subscribe, sync push state, upload/download the cloud backup
src/app.js        browser  load, derive, route (#today #log #dash #history #settings), all mutations
src/ui/*.js       browser  one file per screen; charts.js = hand-rolled SVG charts
sw.js             offline shell (SHELL list) + push/notificationclick
worker/           Cloudflare Worker: index.js (routes + cron), webpush.js (VAPID + aes128gcm, WebCrypto only)
```

Pure modules import nothing browser-side and take `now` as an argument — keep new logic there
and test it in Node. The Worker imports `src/reminders.js` directly (wrangler bundles it).

## Invariants the tests assert

- Status is judged on `effectiveDate` (the Thursday a session was moved to, else its own date);
  grace ends 12:00 the next day. Misses are evaluated over every day since `startDate`, so not
  opening the app never dodges a miss.
- `newDebts` is idempotent (keyed by due id); the Sunday combo owes both gym and TKD penalties.
- The streak does not grow for sessions logged while any debt was open.
- Reminders fire at most once per key per day and never more than 60 min late.
- `/backup` refuses an empty export over a backup that holds data; `/restore` returns it intact.
- `sw.js` SHELL must list every browser module (a test checks). Bump `VERSION` when shell files change.
- Dark only. Chart colours follow the dataviz reference palette (dark steps); status colours
  (good / warning / critical) are reserved for status and always paired with a text label.
