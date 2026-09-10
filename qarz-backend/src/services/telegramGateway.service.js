import { config } from '../config/index.js';

const BASE = 'https://gatewayapi.telegram.org';

// The API accepts a ttl of 30..3600 seconds and rejects anything outside it.
const TTL_MIN_SECONDS = 30;
const TTL_MAX_SECONDS = 3600;

/**
 * Deliver a verification code through Telegram Gateway.
 *
 * The code arrives in the user's own Telegram from the "Verification Codes"
 * (@VerificationCodes) service account — no bot chat, no deep link, nothing to
 * press: they read the number and type it back on the website. That is what
 * replaced the old handshake, where the page sent the user off to the bot and
 * waited: Telegram silently dropped the deep link's payload whenever a chat with
 * the bot already existed, so the bot received a bare "/start" and the page
 * polled forever.
 *
 * We pass our OWN code rather than letting the Gateway generate one, so the
 * existing otp_codes machinery still owns hashing, attempt limits and expiry —
 * and checkVerificationStatus never has to be called.
 *
 * Returns { ok, id?, error? }, matching sendSms so callers treat the two
 * channels alike. In dev (no token) it logs the code instead of failing, again
 * mirroring the SMS service.
 */
export const sendTelegramCode = async (phone, code, ttlMinutes) => {
  if (!config.telegramGateway.token) {
    console.log(`[tg-gateway:dev] -> ${phone}: ${code}`);
    return { ok: true, id: 'dev-' + Date.now(), dev: true };
  }

  const ttl = Math.min(
    TTL_MAX_SECONDS,
    Math.max(TTL_MIN_SECONDS, Math.round((ttlMinutes || 5) * 60))
  );

  try {
    // Step 1 — ask whether this number can receive at all. Two reasons to do
    // this rather than send blind: a number with no Telegram account is
    // discovered before anything is charged (the caller can steer the user to
    // SMS), and the request_id it returns makes the send that follows free of
    // charge, which is what lets a zero-balance account work at all.
    const check = await call('checkSendAbility', { phone_number: phone });
    if (!check.ok) return check;

    // Step 2 — deliver our own code under that request_id.
    return await call('sendVerificationMessage', {
      phone_number: phone, // E.164, which normalizePhone already guarantees
      request_id: check.id,
      code: String(code),
      ttl,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

/** One Gateway call, normalised to { ok, id?, error? }. */
const call = async (method, body) => {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.telegramGateway.token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  // The Gateway reports failures in the body with ok:false, not only by status.
  if (!res.ok || data?.ok === false) {
    return { ok: false, error: data?.error || `HTTP ${res.status}` };
  }
  return { ok: true, id: data?.result?.request_id };
};

/** Whether code delivery over Telegram is actually available on this deployment. */
export const isTelegramGatewayConfigured = () => Boolean(config.telegramGateway.token);
