// Exercises the real session store (src/lib/sessions.js) against a stubbed
// backend. Unlike refresh_test.mjs, which reimplements a session object inline,
// this loads the actual module — the one holding users' access tokens.
process.env.BOT_SHARED_SECRET = 'test-secret';
process.env.API_BASE_URL = 'http://backend.test';
process.env.TELEGRAM_BOT_TOKEN = 'x';

const P = (n, c) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n);

// ---- Stub backend ----
let stored = { '111': { accessToken: 'A1', lang: 'uz' } };
let calls = [];
let nextStatus = 200;
// Resolvers for PUT/DELETE, so a test can hold a write open and prove ordering.
let gate = null;

globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const path = new URL(url).pathname;
  calls.push({ method, path, secret: init.headers?.['x-bot-secret'], body: init.body });

  if (gate) await gate;
  if (nextStatus !== 200) return { ok: false, status: nextStatus };

  if (method === 'GET') {
    return { ok: true, status: 200, json: async () => ({ sessions: stored }) };
  }
  const id = path.split('/').pop();
  if (method === 'PUT') stored[id] = JSON.parse(init.body).data;
  if (method === 'DELETE') delete stored[id];
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const { sessions, hydrate, flush } = await import('../src/lib/sessions.js');

// ---- hydrate ----
await hydrate();
P('hydrate loads stored sessions', sessions.get('111')?.accessToken === 'A1');
P('hydrate sends the bot secret', calls[0].secret === 'test-secret');
P('unknown id reads as null', sessions.get('999') === null);
P('isAuthed true for a session with a token', sessions.isAuthed('111') === true);
P('isAuthed false for an unknown id', sessions.isAuthed('999') === false);

// ---- set merges, and persists ----
calls = [];
sessions.set('111', { refreshToken: 'R1' });
P('set merges into existing fields', sessions.get('111').lang === 'uz');
P('set applies the new field', sessions.get('111').refreshToken === 'R1');
await flush();
P('set issues a PUT', calls.some((c) => c.method === 'PUT' && c.path === '/api/bot/sessions/111'));
P('PUT persisted the merged object', stored['111'].refreshToken === 'R1' && stored['111'].lang === 'uz');

// ---- reads are synchronous (no await needed by 30+ call sites) ----
sessions.set('222', { accessToken: 'B1' });
P('value readable immediately after set', sessions.get('222').accessToken === 'B1');

// ---- clear ----
await flush();
calls = [];
sessions.clear('222');
P('clear empties the cache entry', sessions.get('222') === null);
await flush();
P('clear issues a DELETE', calls.some((c) => c.method === 'DELETE' && c.path === '/api/bot/sessions/222'));
P('DELETE removed it from the backend', stored['222'] === undefined);

// ---- writes for one user are serialised ----
// Two rapid sets must land in order; the second must not overtake the first and
// leave the backend holding a stale token.
let release;
gate = new Promise((r) => { release = r; });
sessions.set('333', { accessToken: 'first' });
sessions.set('333', { accessToken: 'second' });
release();
gate = null;
await flush();
P('concurrent writes land in order', stored['333'].accessToken === 'second');

// ---- a failed write must not corrupt the in-memory cache ----
nextStatus = 500;
sessions.set('111', { accessToken: 'A2' });
await flush();
P('cache keeps the value when the write fails', sessions.get('111').accessToken === 'A2');
nextStatus = 200;

// A later successful write still goes through: the failure must not have
// wedged that user's queue.
sessions.set('111', { accessToken: 'A3' });
await flush();
P('queue recovers after a failed write', stored['111'].accessToken === 'A3');

// ---- hydrate refuses to start on an unreachable/forbidden backend ----
// Silently starting with an empty cache would log every user out and then
// overwrite their real tokens.
nextStatus = 403;
let threw = false;
try { await hydrate(); } catch { threw = true; }
P('hydrate throws on a rejected secret', threw);
