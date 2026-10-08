// Browser-only. Settings: schedule, penalties, weight, notifications, backup.

import { SESSION_TYPES, DAY_NAMES } from '../schedule.js';
import { pushSupport } from '../push.js';
import { esc } from './dom.js';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

export function renderSettings(root, { d, actions }) {
  const s = d.settings;
  const push = pushSupport();
  const sched = ORDER.map((dow) => {
    const on = new Set((s.schedule[dow] || []).map((x) => x.type));
    return `<div style="margin-bottom:10px"><div class="tile-label" style="margin-bottom:6px">${DAY_NAMES[dow]}</div>
      <div class="seg" style="margin:0">${Object.entries(SESSION_TYPES).map(([t, m]) =>
        `<button type="button" data-dow="${dow}" data-type="${t}" aria-pressed="${on.has(t)}">${esc(m.label)}</button>`).join('')}</div></div>`;
  }).join('');

  root.innerHTML = `<h1>Settings</h1>
    <h2>Weekly schedule</h2>
    <div class="card">${sched}
      <p class="hint">Changes apply from today. Past days are judged by the schedule as it is now — don't edit it to dodge a miss.</p></div>

    <h2>Penalties</h2>
    <form class="card" id="pen">
      <label class="field"><span>Missed TKD (club or home)</span><input type="text" name="tkd" value="${esc(s.penalties.tkd)}"></label>
      <label class="field"><span>Missed gym</span><input type="text" name="gym" value="${esc(s.penalties.gym)}"></label>
      <label class="field"><span>Missed run</span><input type="text" name="run" value="${esc(s.penalties.run)}"></label>
      <p class="hint">A missed Sunday session owes both the gym and the TKD penalty.</p>
      <label class="check"><input type="checkbox" name="watchWeight" ${s.watchWeight ? 'checked' : ''}> Watch my weight (competition category)</label>
      <p class="hint">Off: no weigh-in, no weight stats or feedback. Turn on when you have a competition to make weight for.</p>
      <label class="field"><span>Weight category limit (kg)</span><input type="number" step="0.1" name="weightLimit" value="${esc(s.weightLimit)}"></label>
      <button class="btn primary" type="submit">Save</button>
    </form>

    <h2>Notifications</h2>
    <form class="card" id="push">
      <p class="secondary">Reminders at 06:30, 07:00, 17:15 (club days), 21:00 and Sunday 20:00. Sent by your free Cloudflare Worker — see README.</p>
      ${push.ios && !push.standalone ? '<p style="color:var(--warning)">⚠ Open Forge from the Home Screen icon to enable notifications (iPhone requirement).</p>' : ''}
      <label class="field"><span>Worker URL</span><input type="url" name="workerUrl" placeholder="https://forge-push.yourname.workers.dev" value="${esc(s.push.workerUrl)}"></label>
      <label class="field"><span>Token</span><input type="password" name="token" autocomplete="off" value="${esc(s.push.token)}"></label>
      <p class="hint">Status: permission ${esc(push.permission)}</p>
      <div class="btn-row">
        <button class="btn primary" type="submit">Save &amp; enable</button>
        <button class="btn" type="button" id="test-push">Send test</button>
      </div>
    </form>

    <h2>Backup</h2>
    <div class="card">
      <p class="secondary">${s.push.workerUrl && s.push.token
        ? 'Every change is also backed up to your Worker. After a reinstall, enter the Worker URL + token above and tap Save &amp; enable — the log comes back.'
        : 'Your data lives only on this phone. Set up the Worker above to back it up automatically, or export now and then (save it to Files / iCloud Drive).'}</p>
      <div class="btn-row">
        <button class="btn" type="button" id="restore-cloud">Restore from cloud</button>
        <button class="btn" type="button" id="export">Export JSON</button>
        <label class="btn" style="position:relative">Import JSON<input type="file" id="import" accept="application/json,.json" style="position:absolute;inset:0;opacity:0"></label>
      </div>
    </div>
    <p class="hint" style="margin-top:18px">Rules apply since ${esc(d.startDate)}.</p>`;

  root.onclick = async (ev) => {
    const b = ev.target.closest('[data-dow]');
    if (b) {
      const dow = +b.dataset.dow, type = b.dataset.type;
      const day = (s.schedule[dow] || []).slice();
      const i = day.findIndex((x) => x.type === type);
      if (i >= 0) day.splice(i, 1);
      else day.push(type === 'tkd-club' ? { type, slot: 'pm', time: '18:00' } : { type, slot: 'am' });
      await actions.saveSettings({ schedule: { ...s.schedule, [dow]: day } });
      return;
    }
    if (ev.target.id === 'export') await actions.exportData();
    if (ev.target.id === 'restore-cloud') await actions.restoreCloud();
    if (ev.target.id === 'test-push') await actions.testPush();
  };

  root.querySelector('#pen').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    await actions.saveSettings({
      penalties: { tkd: f.get('tkd'), gym: f.get('gym'), run: f.get('run') },
      watchWeight: f.get('watchWeight') === 'on',
      weightLimit: parseFloat(f.get('weightLimit')) || 69,
    });
  });
  root.querySelector('#push').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    await actions.enablePush({ workerUrl: f.get('workerUrl').trim(), token: f.get('token').trim() });
  });
  root.querySelector('#import').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (file) await actions.importData(await file.text());
  });
}
