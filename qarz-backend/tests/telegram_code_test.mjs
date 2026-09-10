// Registration codes delivered into Telegram via the Gateway.
//
// THE BUG this replaced: the "Telegram orqali kod olish" button did not send a
// code at all — it minted a handshake token, sent the user off to our bot via a
// t.me deep link and polled for the bot to confirm. Telegram delivers a deep
// link's ?start= payload only when the chat is new, so for anyone who had ever
// opened the bot it arrived as a bare "/start": the bot had nothing to confirm
// and the page waited forever.
//
// Now both channels do the same thing — issue one 6-digit code and deliver it,
// by SMS or into the user's Telegram from @VerificationCodes — and the user
// types it on the website. This pins that the response leaks no handshake, that
// the code actually verifies, and that a Telegram failure is not silent.
import { createServer } from 'http';
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
mem.public.registerFunction({
  name: 'gen_random_uuid', returns: 'text', implementation: () => randomUUID(), impure: true,
});

mem.public.none(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    phone TEXT UNIQUE,
    password_hash TEXT,
    full_name TEXT,
    telegram_id BIGINT,
    parent_shop_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    purpose TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- registerShopOwner provisions the whole shop in one transaction, so these
  -- have to exist or the insert fails long before the code is ever checked.
  CREATE TABLE shops (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE sms_balance (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL,
    monthly_limit INTEGER NOT NULL,
    remaining INTEGER NOT NULL,
    extra_package INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE reminder_settings (
    shop_id TEXT PRIMARY KEY,
    days_before INTEGER NOT NULL DEFAULT 1
  );

  INSERT INTO users (id, role, phone) VALUES ('u-taken', 'personal', '+998909999999');
`);

const { Pool } = mem.adapters.createPg();
const memPool = new Pool();
const { default: pgMod } = await import('pg');
pgMod.Pool.prototype.query = function (text, params) { return memPool.query(text, params); };
pgMod.Pool.prototype.connect = async function () {
  const c = await memPool.connect();
  return { query: (t, p) => c.query(t, p), release: () => c.release() };
};

// Intercept the Gateway call so the suite never touches the network, and so we
// can see exactly what was sent and simulate a delivery failure.
process.env.TELEGRAM_GATEWAY_TOKEN = 'test-gateway-token';
// The bot-code channel below is gated on this; without it the developer's own
// .env value would be in force and every call would 401.
process.env.BOT_SHARED_SECRET = 'test-bot-secret';
const sentToTelegram = [];
const checksMade = [];
let gatewayFails = false;
let unreachableNumber = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('gatewayapi.telegram.org')) {
    const body = JSON.parse(init.body);
    if (gatewayFails) {
      return new Response(JSON.stringify({ ok: false, error: 'BALANCE_NOT_ENOUGH' }), { status: 400 });
    }
    // Step 1: can this number receive? Returns the request_id that makes the
    // following send free.
    if (u.endsWith('/checkSendAbility')) {
      if (unreachableNumber) {
        return new Response(JSON.stringify({ ok: false, error: 'PHONE_NUMBER_INVALID' }), { status: 400 });
      }
      checksMade.push(body);
      return new Response(
        JSON.stringify({ ok: true, result: { request_id: 'req-' + checksMade.length, request_cost: 0 } }),
        { status: 200 }
      );
    }
    sentToTelegram.push(body);
    return new Response(
      JSON.stringify({ ok: true, result: { request_id: body.request_id } }),
      { status: 200 }
    );
  }
  return realFetch(url, init);
};

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
const post = async (path, body) => {
  const res = await realFetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ---------------------------------------------------------------------------
console.log('--- the code goes to Telegram, the user stays on the site ---');

const PHONE = '+998901111111';
let r = await post('/api/auth/register/request-otp', { phone: PHONE, channel: 'telegram' });
P('request succeeds', r.status === 200 && r.body.sent === true, String(r.status));
P('channel is reported back', r.body.channel === 'telegram', r.body.channel);

// The old handshake leaked both of these; anything that still ships them would
// send the browser back to the bot.
P('no deepLink in the response', !('deepLink' in r.body), Object.keys(r.body).join(','));
P('no verifyToken in the response', !('verifyToken' in r.body));

P('reachability was checked first', checksMade.length === 1 && checksMade[0].phone_number === PHONE);
P('exactly one message was sent', sentToTelegram.length === 1, String(sentToTelegram.length));
const sent = sentToTelegram[0];
P('sent to the right number, in E.164', sent?.phone_number === PHONE, sent?.phone_number);
P('carries a 6-digit code', /^\d{6}$/.test(sent?.code || ''), sent?.code);
// Without the request_id from the check, the send is charged — and on a
// zero-balance account it simply fails.
P('reuses the check\'s request_id (free send)', sent?.request_id === 'req-1', sent?.request_id);
// The API rejects a ttl outside 30..3600 outright.
P('ttl is inside the API range', sent?.ttl >= 30 && sent?.ttl <= 3600, String(sent?.ttl));

// ---------------------------------------------------------------------------
console.log('\n--- and that code is what completes the registration ---');

r = await post('/api/auth/register/shop', {
  phone: PHONE, password: 'parol123', shopName: 'Test Do\'kon', otp: '000000',
});
P('a wrong code is refused', r.status === 400 && r.body.error?.code === 'OTP_INVALID', r.body.error?.code);

r = await post('/api/auth/register/shop', {
  phone: PHONE, password: 'parol123', shopName: 'Test Do\'kon', otp: sent.code,
});
P('the delivered code is accepted', r.status === 201, String(r.status));
P('the account exists', r.body.user?.phone === PHONE, r.body.error?.message || '');

// Single use: the same code must not open a second account.
r = await post('/api/auth/register/personal', {
  phone: '+998902222222', password: 'parol123', otp: sent.code,
});
P('the code cannot be reused for another number', r.status >= 400, String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- failures are reported, never swallowed ---');

// A registered number must not get a code at all — it should be told to log in.
r = await post('/api/auth/register/request-otp', { phone: '+998909999999', channel: 'telegram' });
P('an already-registered phone is refused', r.status === 409 && r.body.error?.code === 'PHONE_TAKEN', r.body.error?.code);

// If the Gateway rejects the send (no balance, bad token), the page must learn
// about it rather than sit waiting for a code that will never arrive.
gatewayFails = true;
r = await post('/api/auth/register/request-otp', { phone: '+998903333333', channel: 'telegram' });
P('a Gateway failure surfaces as an error', r.status === 503 && r.body.error?.code === 'TELEGRAM_SEND_FAILED', r.body.error?.code);
// The operator's error code must not reach the shop owner: "BALANCE_NOT_ENOUGH"
// reads like their mistake and tells them nothing they can act on.
P('the raw Gateway code is not shown to the user', !/BALANCE_NOT_ENOUGH/.test(r.body.error?.message || ''), r.body.error?.message);
P('the user is told what to do instead', /SMS orqali/.test(r.body.error?.message || ''), r.body.error?.message);
gatewayFails = false;

// A number with no Telegram account is caught by the reachability check, so we
// never charge for a message that cannot arrive — and the user is told, instead
// of staring at a code field nothing will ever fill.
unreachableNumber = true;
const sendsBefore = sentToTelegram.length;
r = await post('/api/auth/register/request-otp', { phone: '+998904444444', channel: 'telegram' });
P('a number without Telegram is refused up front', r.status === 422 && r.body.error?.code === 'TELEGRAM_UNREACHABLE', r.body.error?.code);
P('and is told the number has no Telegram', /Telegram topilmadi/.test(r.body.error?.message || ''), r.body.error?.message);
P('and nothing was sent', sentToTelegram.length === sendsBefore, String(sentToTelegram.length - sendsBefore));
unreachableNumber = false;

// ---------------------------------------------------------------------------
console.log('\n--- a failed send must not burn the code the user already has ---');

// THE BUG: issueOtp invalidated the previous outstanding code BEFORE delivery
// was attempted. Request an SMS code, receive it, then tap "Telegram orqali kod
// olish": the Gateway send fails (no balance), the request errors — and the SMS
// code in the user's hand has already been killed. Neither code works, and
// re-requesting runs into the 5-per-hour limiter.
const BURN_PHONE = '+998905555555';

r = await post('/api/auth/register/request-otp', { phone: BURN_PHONE, channel: 'telegram' });
P('the first code is issued', r.status === 200, String(r.status));
const firstCode = sentToTelegram.at(-1).code;

// Second attempt, this time the provider refuses.
gatewayFails = true;
r = await post('/api/auth/register/request-otp', { phone: BURN_PHONE, channel: 'telegram' });
P('the second attempt reports failure', r.status === 503, String(r.status));
gatewayFails = false;

// The code the user is holding must still work.
r = await post('/api/auth/register/personal', {
  phone: BURN_PHONE, password: 'parol123', otp: firstCode,
});
P('the code they already have still works', r.status === 201, r.body.error?.code || String(r.status));

// ---------------------------------------------------------------------------
console.log('\n--- the bot channel: free, and it still proves the phone ---');

// This is the channel that works without paying anyone. The website asks for
// nothing to be delivered; the bot mints the code once Telegram has vouched for
// the number, and the person carries it back to the browser. Nothing depends on
// a deep-link payload, which is what broke the previous handshake.
const BOT_PHONE = '+998906666666';

r = await post('/api/auth/register/request-otp', { phone: BOT_PHONE, channel: 'bot' });
P('the website sends nothing for this channel', r.status === 200 && r.body.sent === false, JSON.stringify(r.body));
P('it hands back where to go instead', /^https:\/\/t\.me\//.test(r.body.botLink || ''), r.body.botLink);
P('and no code was minted yet', (await memPool.query("SELECT 1 FROM otp_codes WHERE phone = $1 AND purpose = 'register' AND consumed_at IS NULL", [BOT_PHONE])).rows.length === 0);

// The bot asks — with the shared secret, for a phone Telegram confirmed.
const botCode = async (phone, secret = 'test-bot-secret') => {
  const res = await realFetch(base + '/api/auth/telegram/web-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-bot-secret': secret } : {}) },
    body: JSON.stringify({ phone, telegramId: 840369610 }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

r = await botCode(BOT_PHONE);
P('the bot receives a code', r.status === 200 && /^\d{6}$/.test(r.body.code || ''), r.body.code);
const readOut = r.body.code;

// That code is what the person types back into the website.
r = await post('/api/auth/register/personal', { phone: BOT_PHONE, password: 'parol123', otp: readOut });
P('typing it on the website completes registration', r.status === 201, r.body.error?.code || String(r.status));

// The response carries a plaintext code, so the secret is the entire gate.
r = await botCode('+998907777777', null);
P('without the bot secret it is refused', r.status === 401, String(r.status));

// A number that already has an account must not get a registration code — that
// would also make this a way to probe which numbers are registered.
r = await botCode(BOT_PHONE);
P('a registered number is refused', r.status === 409 && r.body.error?.code === 'PHONE_TAKEN', r.body.error?.code);

server.close();
