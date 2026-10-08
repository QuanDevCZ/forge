// Browser-only. Forge Worker client: subscribe this device to push, keep the Worker's copy of
// the schedule/log state current so its reminders are accurate, and back the full log up to it.

const b64urlToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const base = (cfg) => cfg.workerUrl.replace(/\/+$/, '');

async function api(cfg, path, body) {
  const res = await fetch(`${base(cfg)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw Object.assign(new Error(`${path} failed: ${res.status} ${await res.text()}`), { status: res.status });
  return res.json().catch(() => ({}));
}

export function pushSupport() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, standalone, permission: 'Notification' in window ? Notification.permission : 'unsupported' };
}

export async function enablePush(cfg) {
  if (!cfg.workerUrl || !cfg.token) throw new Error('Enter the Worker URL and token first.');
  const { supported, standalone } = pushSupport();
  if (!supported) {
    throw new Error(standalone ? 'This iOS version has no web push (needs iOS 16.4+).'
      : 'Open Forge from the Home Screen icon — iPhone only allows notifications there.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. Enable them in iOS Settings → Notifications → Forge.');
  const reg = await navigator.serviceWorker.ready;
  const res = await fetch(`${base(cfg)}/vapid`);
  if (!res.ok) throw new Error(`Worker not reachable (${res.status}).`);
  const { publicKey } = await res.json();
  let sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
  await api(cfg, '/subscribe', sub.toJSON());
}

export const syncPushState = (cfg, state) => (cfg.workerUrl && cfg.token ? api(cfg, '/state', state) : Promise.resolve());
export const sendTestPush = (cfg) => api(cfg, '/test', {});
export const uploadBackup = (cfg, backup) => api(cfg, '/backup', backup);

// The latest cloud backup, or null when the Worker has none yet.
export async function downloadBackup(cfg) {
  if (!cfg.workerUrl || !cfg.token) throw new Error('Enter the Worker URL and token under Notifications first.');
  try { return await api(cfg, '/restore', {}); } catch (e) { if (e.status === 404) return null; throw e; }
}
