// Browser-only. Forge Worker client: subscribe this device to push, keep the Worker's copy of
// the schedule/log state current so its reminders are accurate, and back the full log up to it.

const b64urlToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const base = (cfg) => cfg.workerUrl.replace(/\/+$/, '');

const NO_CONFIG = 'Enter the Worker URL and token under Notifications first.';

async function api(cfg, path, body) {
  // Without a Worker URL the fetch would hit the app's own host and fail with its HTML error page.
  if (!cfg?.workerUrl || !cfg?.token) throw new Error(NO_CONFIG);
  const res = await fetch(`${base(cfg)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.error).catch(() => '');
    const msg = res.status === 401 ? 'Wrong token — check it under Notifications.' : `${path} failed (${res.status})${detail ? `: ${detail}` : ''}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json().catch(() => ({}));
}

export function pushSupport() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // iPadOS reports itself as a Mac; touch points tell them apart.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return { supported, standalone, ios, permission: 'Notification' in window ? Notification.permission : 'unsupported' };
}

export async function enablePush(cfg) {
  if (!cfg.workerUrl || !cfg.token) throw new Error(NO_CONFIG);
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
export const uploadBackup = (cfg, backup) => api(cfg, '/backup', backup);

// The Worker keeps one subscription and answers 200 with { sent: 0, reason } when it has nothing to
// send to — that is a failure, not "test sent". Resolves to whether this device is the subscribed one.
export async function sendTestPush(cfg) {
  const { sent, reason } = await api(cfg, '/test', {});
  if (!sent) throw new Error(`Test not sent: ${reason || 'unknown reason'}. Tap "Save & enable" on this device first.`);
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  return !!(reg && await reg.pushManager?.getSubscription());
}

// The latest cloud backup, or null when the Worker has none yet.
export async function downloadBackup(cfg) {
  try { return await api(cfg, '/restore', {}); } catch (e) { if (e.status === 404) return null; throw e; }
}
