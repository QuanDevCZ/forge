// Service worker: offline app shell + push notifications.
// Bump VERSION whenever any shell file changes, or phones keep the old copy.
const VERSION = 'forge-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'src/app.js', 'src/store.js', 'src/model.js', 'src/schedule.js', 'src/penalties.js', 'src/stats.js',
  'src/feedback.js', 'src/push.js',
  'src/ui/dom.js', 'src/ui/charts.js', 'src/ui/today.js', 'src/ui/log.js', 'src/ui/dashboard.js',
  'src/ui/history.js', 'src/ui/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first for our own files (so updates land), cache as the fallback — both when the
// network is down and when the host answers with an error (a 404 from a missing Pages site
// must not replace an app that is sitting in the cache).
const fromCache = (req) => caches.match(req, { ignoreSearch: true })
  .then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; }
        return fromCache(e.request).then((r) => r || res);
      })
      .catch(() => fromCache(e.request).then((r) => r || Response.error())),
  );
});

self.addEventListener('push', (e) => {
  let msg = { title: 'Forge', body: 'Open the app.' };
  try { msg = { ...msg, ...e.data.json() }; } catch { if (e.data) msg.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag || undefined, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { url: msg.url || './#today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#today', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if ('focus' in w) { w.navigate?.(target); return w.focus(); }
    return self.clients.openWindow(target);
  }));
});
