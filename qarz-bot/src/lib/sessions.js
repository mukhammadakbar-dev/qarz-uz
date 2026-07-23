import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = join(__dirname, '..', '..', '.sessions.json');

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
    } catch {
      cache = {};
    }
  }
};
load();

const persist = () => {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(cache, null, 2));
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
