# Forge

Personal training tracker for iPhone. A web app (PWA): no App Store, no cost.

**Live:** https://webjohn7.github.io/forge/ — open it in Safari on the iPhone, then
Share → Add to Home Screen (details in [§2](#2-install-on-the-iphone)).

- **Enforced week:** Mon run + TKD club 18:00, Tue lower body, Wed TKD club, Thu rest,
  Fri upper body, Sat TKD at home, Sun full body + TKD.
- **Consequences:** a session not logged by 23:59 can still be logged until 12:00 the next day
  (marked *late*); after that it's a **miss** → penalty workout added to your debt, streak reset
  and frozen until the debt is paid, discipline score −15 (and −2/day per unpaid penalty).
- **Honest feedback:** rules engine on your log — stalled/regressing lifts, volume spikes,
  RPE too high/low, run pace, missing intervals, weight vs the 69 kg category, skipped-session
  patterns. Offline, free. (Weight vs the category limit only when "Watch my weight" is on in Settings.)
- **Stats:** discipline score, streak, debt, adherence, e1RM per lift, weekly volume,
  bodyweight (when weight watching is on), run pace.
- **Notifications** (optional): via a free Cloudflare Worker.

## 1. Put it online (GitHub Pages, free)

1. Create a GitHub repo (e.g. `forge`), push this folder to it.
2. Repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
3. After ~1 minute it's live at `https://<your-username>.github.io/forge/`.

## 2. Install on the iPhone

1. Open that URL in **Safari** (not Chrome — only Safari can install web apps on iOS).
2. Share button → **Add to Home Screen** → Add.
3. Open Forge **from the Home Screen icon** from now on. The rules start counting from the
   first day you open it.

Data is stored on the phone only. Use **Settings → Export JSON** now and then and save the
file to iCloud Drive / Files.

## 3. Notifications (optional, free)

iPhone web push needs iOS 16.4+ and the app opened from the Home Screen. A small
Cloudflare Worker sends the reminders (06:30 morning session, 07:00 unpaid/unlogged,
17:15 club days, 21:00 not logged yet, Sunday 20:00 weekly verdict).

Live setup: `https://forge-push.nguyenhonza1301.workers.dev` (KV id in `worker/wrangler.toml`).
Keys and the phone token are in `worker/.dev.vars` — git-ignored, never commit it.

To set it up again from scratch:

1. Create a free account at <https://dash.cloudflare.com/sign-up> (no card needed).
2. From `worker/`:
   ```powershell
   npx wrangler login                        # click Allow in the browser tab
   npx wrangler kv namespace create FORGE    # paste the printed id into wrangler.toml
   node ../tools/vapid-keys.mjs | Select-String "=" | Out-File -Encoding ascii .dev.vars
   Add-Content .dev.vars "VAPID_SUBJECT=https://webjohn7.github.io/forge/"
   npx wrangler deploy                       # needs a workers.dev subdomain on the account
   node ../tools/push-secrets.mjs            # uploads .dev.vars as Worker secrets
   ```
3. On the iPhone: Forge (opened from the Home Screen icon) → **Settings → Notifications** →
   Worker URL + TOKEN → **Save & enable** → Allow → **Send test**.

Free-tier usage: ~100 cron runs/day and a handful of KV writes — far below the limits.

## Develop

```powershell
npm test                  # node --test — pure logic + push crypto + worker, no deps
py -m http.server 8138    # then http://localhost:8138/  (serve over http, not file://)
node tools/make-icons.mjs # regenerate icons
```
