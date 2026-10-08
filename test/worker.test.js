import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../worker/index.js';
import { generateVapidKeys } from '../worker/webpush.js';

function kv() {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}

async function env() {
  const keys = await generateVapidKeys();
  // A real P-256 key for the fake subscription so encryption succeeds.
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
  return { TOKEN: 'secret', VAPID_PUBLIC: keys.publicKey, VAPID_PRIVATE: keys.privateKey, FORGE: kv(), p256dh };
}

const post = (path, body, token = 'secret') => new Request(`https://w.example${path}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('worker: auth, subscribe, state, cron sends once and dedupes', async (t) => {
  const e = await env();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 201 }); });

  assert.equal((await worker.fetch(post('/state', {}, 'wrong'), e)).status, 401);
  assert.equal((await (await worker.fetch(new Request('https://w.example/vapid'), e)).json()).publicKey, e.VAPID_PUBLIC);

  const sub = { endpoint: 'https://web.push.apple.com/xyz', keys: { p256dh: e.p256dh, auth: Buffer.from(new Uint8Array(16).fill(7)).toString('base64url') } };
  assert.equal((await worker.fetch(post('/subscribe', sub), e)).status, 200);
  assert.equal((await worker.fetch(post('/state', { logged: [] }), e)).status, 200);

  // Monday 2026-09-28 06:30 Prague = 04:30 UTC. Run the scheduled handler at that time.
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-28T04:30:00Z') });
  try {
    const waits = [];
    await worker.scheduled({}, e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, sub.endpoint);
    assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm');
    assert.match(calls[0].init.headers.Authorization, /^vapid t=/);

    const again = [];
    await worker.scheduled({}, e, { waitUntil: (p) => again.push(p) });
    await Promise.all(again);
    assert.equal(calls.length, 1, 'same reminder must not be sent twice');
  } finally {
    mock.timers.reset();
  }
});

test('worker: expired subscription (410) is dropped', async (t) => {
  const e = await env();
  t.mock.method(globalThis, 'fetch', async () => new Response('gone', { status: 410 }));
  await e.FORGE.put('sub', JSON.stringify({ endpoint: 'https://push.example/a', keys: { p256dh: e.p256dh, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } }));
  const res = await (await worker.fetch(post('/test', {}), e)).json();
  assert.equal(res.reason, 'subscription expired');
  assert.equal(e.FORGE.m.has('sub'), false);
});

test('service worker precaches every browser module', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = [
    ...readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'reminders.js').map((f) => `src/${f}`),
    ...readdirSync(new URL('../src/ui/', import.meta.url)).map((f) => `src/ui/${f}`),
  ];
  for (const f of files) assert.ok(sw.includes(`'${f}'`), `sw.js SHELL is missing ${f}`);
});

test('worker: backup, restore, dated copy, and no empty overwrite', async () => {
  const e = await env();
  const empty = { app: 'forge', sessions: [], bodyweight: [], debts: [], moves: [], kv: [] };
  const full = { ...empty, sessions: [{ id: 'a', type: 'run', date: '2026-10-07' }] };
  const restore = async (body = {}) => worker.fetch(post('/restore', body), e);

  assert.equal((await restore()).status, 404, 'nothing stored yet');
  assert.equal((await worker.fetch(post('/backup', full, 'wrong'), e)).status, 401);
  assert.equal((await worker.fetch(post('/backup', { app: 'other' }), e)).status, 400);
  assert.equal((await worker.fetch(post('/backup', empty), e)).status, 200, 'empty is fine when the cloud is empty');
  assert.equal((await worker.fetch(post('/backup', full), e)).status, 200);
  assert.deepEqual(await (await restore()).json(), full);

  const res = await worker.fetch(post('/backup', empty), e);
  assert.equal(res.status, 409, 'a fresh install must not wipe a backup that holds data');
  assert.deepEqual(await (await restore()).json(), full);

  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(await (await restore({ date: day })).json(), full);
  assert.equal((await restore({ date: '../sub' })).status, 400);
});
