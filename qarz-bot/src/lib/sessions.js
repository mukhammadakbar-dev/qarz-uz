import { config } from './config.js';

/**
 * Per-user session store, backed by the backend database.
 *
 * Previously this lived in a local .sessions.json holding live access AND
 * refresh tokens in plaintext on the bot's disk — lost on every container
 * rebuild, logging out every user. It now persists through the backend's
 * shared-secret-gated /api/bot/sessions endpoints.
 *
 * Reads stay synchronous against an in-memory cache, because all 30-odd call
 * sites are synchronous and threading `await` through every handler and
 * conversation would be a large, bug-prone change for no behavioural gain.
 * The cache is hydrated once at startup and written through on every change.
 *
 * This assumes a SINGLE bot process, which long polling requires anyway (two
 * pollers would fight over the same updates). Running several instances would
 * need reads to go to the database instead — the cache would otherwise go
 * stale as soon as another instance wrote.
 *
 * Shape: { [telegramId]: { accessToken, refreshToken, role, phone, lang } }
 */

let cache = {};

const headers = () => ({
  'Content-Type': 'application/json',
  // Proves the caller is our own bot. Without it the backend refuses outright:
  // these endpoints span every user's session, so they are bot-only.
  'x-bot-secret': config.botSharedSecret,
});

/**
 * Writes are fire-and-forget so the bot can answer the user without waiting on
 * a round trip, but two writes for the same user must not race — an older
 * payload landing last would resurrect a stale token. Chain them per user.
 */
const writeQueues = new Map();

const enqueueWrite = (tgId, task) => {
  const prev = writeQueues.get(tgId) || Promise.resolve();
  // `task` on both settle paths: a failed write must not stall the chain.
  const next = prev.then(task, task).catch((err) => {
    // A failed write only costs persistence — the in-memory cache is still
    // correct for this process, so the user's current session keeps working.
    console.error(`[session] persist failed for ${tgId}:`, err.message);
  });
  writeQueues.set(tgId, next);
  // Don't let the map grow forever: drop the entry once this user goes idle.
  next.finally(() => {
    if (writeQueues.get(tgId) === next) writeQueues.delete(tgId);
  });
  return next;
};

const persist = (tgId) =>
  enqueueWrite(tgId, async () => {
    const res = await fetch(`${config.apiBaseUrl}/api/bot/sessions/${tgId}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ data: cache[tgId] || {} }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

const remove = (tgId) =>
  enqueueWrite(tgId, async () => {
    const res = await fetch(`${config.apiBaseUrl}/api/bot/sessions/${tgId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });

/**
 * Load every stored session into the cache. Must be awaited before the bot
 * starts accepting updates, otherwise the first users to message appear logged
 * out and get sent back through /start.
 *
 * Throws if the backend is unreachable: starting with an empty cache would
 * silently sign everyone out and then overwrite their stored sessions on the
 * next write, so the caller must treat this as fatal rather than continue.
 */
export const hydrate = async () => {
  if (!config.botSharedSecret) {
    throw new Error(
      'BOT_SHARED_SECRET is not set — the bot cannot reach its session store. ' +
        'Set it to the same value as the backend.'
    );
  }

  const res = await fetch(`${config.apiBaseUrl}/api/bot/sessions`, { headers: headers() });
  if (!res.ok) {
    throw new Error(
      `Session store unreachable: HTTP ${res.status}` +
        (res.status === 403 ? ' — BOT_SHARED_SECRET does not match the backend' : '')
    );
  }
  const data = await res.json();
  cache = data?.sessions || {};
  console.log(`[session] hydrated ${Object.keys(cache).length} session(s) from backend`);
};

/** Wait for in-flight writes to land — used on shutdown so nothing is lost. */
// allSettled consumes the iterator synchronously, so entries removing
// themselves on completion cannot race this.
export const flush = () => Promise.allSettled(writeQueues.values());

/** Test seam: load a cache directly, without touching the network. */
export const __setCacheForTests = (next) => {
  cache = next;
};

export const sessions = {
  get(tgId) {
    return cache[tgId] || null;
  },
  set(tgId, data) {
    cache[tgId] = { ...(cache[tgId] || {}), ...data };
    persist(tgId);
    return cache[tgId];
  },
  clear(tgId) {
    delete cache[tgId];
    remove(tgId);
  },
  isAuthed(tgId) {
    return !!cache[tgId]?.accessToken;
  },
};
