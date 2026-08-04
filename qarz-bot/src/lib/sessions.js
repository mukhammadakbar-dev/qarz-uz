import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', '..', '.sessions.json');
const TMP_PATH = STORE_PATH + '.tmp';

/**
 * Very simple persistent session store keyed by telegram user id.
 * For production, swap this for Redis or the backend DB.
 * Shape: { [telegramId]: { accessToken, refreshToken, role, phone, lang } }
 */
let cache = {};

const load = () => {
  if (existsSync(STORE_PATH)) {
    try {
      cache = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      // Tighten permissions on a store written by an older version.
      chmodSync(STORE_PATH, 0o600);
    } catch {
      cache = {};
    }
  }
};
load();

/**
 * This file holds live access and refresh tokens in plaintext, so:
 *  - mode 0600, not the default 0644 (anyone with a shell on the box could
 *    otherwise read every user's credentials);
 *  - write to a temp file and rename, because rename is atomic — a crash
 *    partway through the previous in-place write left truncated JSON, and the
 *    loader silently reset every session to {} on the next start.
 */
const persist = () => {
  try {
    writeFileSync(TMP_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
    renameSync(TMP_PATH, STORE_PATH);
  } catch (err) {
    console.error('[session] persist failed:', err.message);
  }
};

export const sessions = {
  get(tgId) {
    return cache[tgId] || null;
  },
  set(tgId, data) {
    cache[tgId] = { ...(cache[tgId] || {}), ...data };
    persist();
    return cache[tgId];
  },
  clear(tgId) {
    delete cache[tgId];
    persist();
  },
  isAuthed(tgId) {
    return !!cache[tgId]?.accessToken;
  },
};
