// Browser-only. Loads data, derives state, routes between screens, owns every mutation.

import * as store from './store.js';
import { compute, withDefaults, pushState } from './model.js';
import { toISO } from './schedule.js';
import { payOldest } from './penalties.js';
import { enablePush as subscribePush, syncPushState, sendTestPush, uploadBackup, downloadBackup } from './push.js';
import { parseHash, toast } from './ui/dom.js';
import { renderToday } from './ui/today.js';
import { renderLog } from './ui/log.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderHistory } from './ui/history.js';
import { renderSettings } from './ui/settings.js';

const data = { sessions: [], bodyweight: [], debts: [], moves: [], settings: null };
const root = document.getElementById('view');

async function load() {
  for (const k of ['sessions', 'bodyweight', 'debts', 'moves']) data[k] = await store.all(k);
  data.settings = withDefaults(await store.getKV('settings'));
  if (!data.settings.startDate) {
    data.settings.startDate = toISO(new Date());
    await store.setKV('settings', data.settings);
  }
}

// Derive, and persist any debts the rules just created.
async function derive() {
  const d = compute({ ...data, now: new Date() });
  if (d.createdDebts.length) {
    await store.putMany('debts', d.createdDebts);
    data.debts.push(...d.createdDebts);
    toast(`Missed session — ${d.createdDebts.length} penalt${d.createdDebts.length === 1 ? 'y' : 'ies'} added`);
  }
  return d;
}

let lastSync = '';
async function sync(d) {
  const cfg = data.settings.push;
  if (!cfg.workerUrl || !cfg.token) return;
  const state = pushState(d, data.moves);
  const key = JSON.stringify(state);
  if (key === lastSync) return;
  try { await syncPushState(cfg, state); lastSync = key; } catch (e) { console.warn('[forge] push sync failed', e); }
}

// Cloud backup: the whole export goes to the Worker whenever it changed. The Worker refuses
// an empty export over one that holds data (409), so a fresh install can't wipe the cloud copy.
let lastBackup = '';
async function backup() {
  const cfg = data.settings.push;
  if (!cfg.workerUrl || !cfg.token) return;
  const out = await store.exportAll();
  const key = JSON.stringify({ ...out, exportedAt: null });
  if (key === lastBackup) return;
  try { await uploadBackup(cfg, out); lastBackup = key; } catch (e) { console.warn('[forge] cloud backup failed', e); }
}

// Replace local data with the cloud backup, keeping the Worker URL + token just entered.
async function restoreFromCloud(cfg) {
  const cloud = await downloadBackup(cfg);
  if (!cloud) return false;
  await store.importAll(cloud);
  await load();
  data.settings = withDefaults({ ...data.settings, push: cfg });
  await store.setKV('settings', data.settings);
  lastSync = lastBackup = '';
  return true;
}

const VIEWS = { today: renderToday, log: renderLog, dash: renderDashboard, history: renderHistory, settings: renderSettings };

async function render() {
  const { name, params } = parseHash();
  const view = VIEWS[name] || renderToday;
  const d = await derive();
  root.onclick = root.oninput = root.onchange = null;
  view(root, { d, data, actions, now: new Date() }, params);
  document.querySelectorAll('.tabbar a').forEach((a) => {
    if (a.dataset.tab === (VIEWS[name] ? name : 'today')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.getElementById('topbar-date').textContent =
    new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  sync(d);
  backup();
}

const guard = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { console.error(e); toast(e.message || 'Something went wrong'); }
};

const actions = {
  saveSession: guard(async (s) => {
    const isNew = !s.id;
    const session = { ...s, id: s.id || store.uid(), loggedAt: s.loggedAt || new Date().toISOString() };
    await store.put('sessions', session);
    data.sessions = data.sessions.filter((x) => x.id !== session.id).concat(session);
    if (isNew && session.type === 'penalty') {
      const before = data.debts;
      data.debts = payOldest(data.debts, session.loggedAt, session.id);
      const paid = data.debts.find((x, i) => x !== before[i]);
      if (paid) await store.put('debts', paid);
      toast('Debt paid.');
    } else toast(isNew ? 'Logged.' : 'Saved.');
    await render();
  }),

  deleteSession: guard(async (id) => {
    await store.remove('sessions', id);
    data.sessions = data.sessions.filter((x) => x.id !== id);
    // Deleting a penalty session re-opens the debt it paid.
    for (const debt of data.debts.filter((x) => x.paidBy === id)) {
      const reopened = { ...debt, paidAt: null, paidBy: null };
      await store.put('debts', reopened);
      data.debts = data.debts.map((x) => (x.id === debt.id ? reopened : x));
    }
    toast('Deleted.');
  }),

  saveWeight: guard(async (date, kg) => {
    await store.put('bodyweight', { date, kg });
    data.bodyweight = data.bodyweight.filter((b) => b.date !== date).concat({ date, kg });
    toast(`${kg} kg saved.`);
    await render();
  }),

  deleteWeight: guard(async (date) => {
    await store.remove('bodyweight', date);
    data.bodyweight = data.bodyweight.filter((b) => b.date !== date);
    await render();
  }),

  addMove: guard(async (move) => {
    const m = { ...move, id: `${move.fromDate}:${move.type}`, declaredAt: new Date().toISOString() };
    await store.put('moves', m);
    data.moves = data.moves.filter((x) => x.id !== m.id).concat(m);
    toast('Moved to Thursday. No second chances.');
    await render();
  }),

  saveSettings: guard(async (patch) => {
    data.settings = withDefaults({ ...data.settings, ...patch });
    await store.setKV('settings', data.settings);
    toast('Saved.');
    await render();
  }),

  enablePush: guard(async (cfg) => {
    data.settings = withDefaults({ ...data.settings, push: cfg });
    await store.setKV('settings', data.settings);
    // Fresh install: pull the log back from the cloud before anything can overwrite it.
    const restored = !data.sessions.length && await restoreFromCloud(cfg).catch((e) => { console.warn('[forge] restore failed', e); return false; });
    if (restored) await render(); // show it even if subscribing below fails
    await subscribePush(cfg);
    lastSync = '';
    toast(restored ? 'Cloud backup restored. Notifications on.' : 'Notifications on.');
    await render();
  }),

  restoreCloud: guard(async () => {
    if (data.sessions.length && !confirm('Replace everything on this phone with the cloud backup?')) return;
    if (!await restoreFromCloud(data.settings.push)) { toast('No cloud backup yet.'); return; }
    toast('Cloud backup restored.');
    await render();
  }),

  testPush: guard(async () => {
    const here = await sendTestPush(data.settings.push);
    toast(here ? 'Test sent — check your notifications.' : 'Test sent to your subscribed device (not this one).');
  }),

  exportData: guard(async () => {
    const blob = new Blob([JSON.stringify(await store.exportAll(), null, 2)], { type: 'application/json' });
    const name = `forge-backup-${toISO(new Date())}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  }),

  importData: guard(async (text) => {
    await store.importAll(JSON.parse(text));
    await load();
    toast('Backup restored.');
    await render();
  }),
};

window.addEventListener('hashchange', render);
// Re-evaluate when the app comes back to the foreground (misses may have become final).
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[forge] sw failed', e));
}

(async () => {
  await store.persist();
  await load();
  await render();
})();
