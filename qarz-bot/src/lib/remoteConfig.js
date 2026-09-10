import { api } from './api.js';

/**
 * Deployment facts served by the backend (`GET /api/config/public`): whether
 * online payment is live, and who a shop owner contacts to pay for their
 * subscription.
 *
 * Fetched once at startup and cached, because the places that need it —
 * building a keyboard, deciding whether a button is worth showing — are
 * synchronous and run on every message. The values only change when the backend
 * is redeployed, so a per-process snapshot is accurate enough.
 *
 * The fallback is deliberately the pessimistic one: with no answer from the
 * backend we show no payment buttons. A missing button is a smaller failure
 * than a button that hands a customer a link to a checkout that does not exist.
 */
let cached = { clickEnabled: false, support: { telegram: '', phone: '' } };

/**
 * Whether the values above came from the backend or are still the pessimistic
 * defaults. A single failed request at startup used to be permanent: the bot
 * would spend the rest of its life telling owners "admin kontakti sozlanmagan"
 * and hiding payment buttons, with nothing but a restart to fix it. So a failed
 * load is retried in the background the next time anyone asks for the config.
 */
let loaded = false;
let lastAttempt = 0;
let inFlight = null;
const RETRY_COOLDOWN_MS = 60_000;

export const getRemoteConfig = () => {
  // Fire-and-forget: the callers here are synchronous (building a keyboard,
  // deciding whether a button is worth showing), so this refresh lands in time
  // for the NEXT message rather than this one. That is the right trade — the
  // alternative is an await on every keystroke of every user.
  if (!loaded && Date.now() - lastAttempt > RETRY_COOLDOWN_MS) {
    loadRemoteConfig().catch(() => {});
  }
  return cached;
};

export const loadRemoteConfig = async () => {
  // Collapse concurrent callers onto one request.
  if (inFlight) return inFlight;
  lastAttempt = Date.now();
  inFlight = (async () => {
    try {
      const cfg = await api.publicConfig();
      cached = {
        clickEnabled: Boolean(cfg?.clickEnabled),
        support: {
          telegram: cfg?.support?.telegram || '',
          phone: cfg?.support?.phone || '',
        },
      };
      loaded = true;
      console.log(
        `[config] click=${cached.clickEnabled ? 'on' : 'off'}, ` +
        `support=${cached.support.telegram ? '@' + cached.support.telegram : 'not set'}`
      );
    } catch (err) {
      // Not fatal: the bot's core job (writing debts) does not need this, and
      // `loaded` stays false so the next getRemoteConfig() tries again.
      console.warn('[config] public config unavailable, using defaults:', err.message);
    } finally {
      inFlight = null;
    }
    return cached;
  })();
  return inFlight;
};
