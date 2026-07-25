// Exercises the new registration-OTP gate, debtor validation and debtor CRUD
// against the real Express app with a stateful in-memory pg stub.
import { createServer } from 'http';

const { default: pgMod } = await import('pg');

// --- stateful stub ---
const db = {
  users: [],          // {id, phone, role, password_hash}
  otps: [],           // {id, phone, code_hash, purpose, attempts, consumed_at, expires_at}
  debtors: [],        // {id, shop_id, full_name, phone, telegram_id, is_archived}
  debts: [],          // {id, debtor_id, amount, paid_amount, status}
};
let seq = 0;
const uid = () => `id-${++seq}`;

// capture the OTP the service generates by intercepting the INSERT
let lastOtpHash = null;

pgMod.Pool.prototype.query = async function (text, params = []) {
  const t = String(text).replace(/\s+/g, ' ').trim();

  if (t.includes('SELECT id FROM users WHERE phone')) {
    const u = db.users.find((x) => x.phone === params[0]);
    return { rows: u ? [{ id: u.id }] : [] };
  }
  if (t.startsWith('SELECT * FROM users WHERE phone')) {
    const u = db.users.find((x) => x.phone === params[0]);
    return { rows: u ? [u] : [] };
  }
  if (t.includes('UPDATE otp_codes SET consumed_at = now() WHERE phone')) {
    db.otps.forEach((o) => {
      if (o.phone === params[0] && o.purpose === params[1] && !o.consumed_at) o.consumed_at = new Date();
    });
    return { rows: [] };
  }
  if (t.includes('INSERT INTO otp_codes')) {
    lastOtpHash = params[1];
    db.otps.push({
      id: uid(), phone: params[0], code_hash: params[1], purpose: params[2],
      attempts: 0, consumed_at: null, expires_at: params[3], created_at: new Date(),
    });
    return { rows: [] };
  }
  if (t.includes('FROM otp_codes WHERE phone')) {
    const rows = db.otps
      .filter((o) => o.phone === params[0] && o.purpose === params[1] && !o.consumed_at)
      .sort((a, b) => b.created_at - a.created_at);
    return { rows: rows.slice(0, 1) };
  }
  if (t.includes('UPDATE otp_codes SET attempts')) {
    const o = db.otps.find((x) => x.id === params[0]);
    if (o) o.attempts++;
    return { rows: [] };
  }
  if (t.includes('UPDATE otp_codes SET consumed_at = now() WHERE id')) {
    const o = db.otps.find((x) => x.id === params[0]);
    if (o) o.consumed_at = new Date();
    return { rows: [] };
  }
  if (t.includes('INSERT INTO users')) {
    const u = { id: uid(), role: t.includes("'shop_owner'") ? 'shop_owner' : 'personal',
      phone: params[0], password_hash: params[1], full_name: params[2], is_active: true };
    db.users.push(u);
    return { rows: [u] };
  }
  return { rows: [] };
};
pgMod.Pool.prototype.connect = async function () {
  return {
    query: async (text, params) => pgMod.Pool.prototype.query(text, params),
    release() {},
  };
};

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = createServer(app);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};
const P = (n, c, extra = '') => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

// Recover the plaintext OTP by brute-forcing the 6-digit space against the hash
// (only possible because we control the secret in tests).
const crypto = await import('crypto');
const { config } = await import('../src/config/index.js');
const findCode = (phone, purpose) => {
  for (let i = 0; i < 1000000; i++) {
    const c = String(i).padStart(6, '0');
    const h = crypto.createHmac('sha256', config.jwt.paymentLinkSecret).update(`${phone}:${c}`).digest('hex');
    if (h === lastOtpHash) return c;
  }
  return null;
};

console.log('--- #0 registration requires phone ownership ---');

// registering with no OTP must fail
let r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: '901234567', password: 'parol123', fullName: 'Ali Aliyev' },
});
P('register without OTP rejected', r.status >= 400, `got ${r.status} ${r.body?.error?.code || ''}`);
P('no account created', db.users.length === 0);

// wrong OTP must fail
r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: '901234567', password: 'parol123', fullName: 'Ali', otp: '000000' },
});
P('register with wrong OTP rejected', r.status >= 400, `got ${r.status}`);
P('still no account created', db.users.length === 0);

// request an OTP, then register with it
r = await call('/api/auth/register/request-otp', { method: 'POST', body: { phone: '901234567' } });
P('request-otp succeeds for new phone', r.status === 200 && r.body.sent === true, `got ${r.status}`);

const code = findCode('+998901234567', 'register');
P('OTP generated and hashed', !!code, code ? `code=${code}` : 'not found');

r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: '901234567', password: 'parol123', fullName: 'Ali', otp: code },
});
P('register succeeds with correct OTP', r.status === 201, `got ${r.status} ${JSON.stringify(r.body?.error||'')}`);
P('account created', db.users.length === 1);

// OTP is single use
r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: '998901112299', password: 'parol123', fullName: 'Bob', otp: code },
});
P('same OTP cannot be reused', r.status >= 400, `got ${r.status}`);

// taken phone is reported clearly
r = await call('/api/auth/register/request-otp', { method: 'POST', body: { phone: '901234567' } });
P('taken phone -> 409 PHONE_TAKEN', r.status === 409 && r.body?.error?.code === 'PHONE_TAKEN', `got ${r.status}`);

// a client cannot grant itself the bot privilege via the body
r = await call('/api/auth/register/personal', {
  method: 'POST', body: { phone: '935556677', password: 'parol123', fullName: 'Eve', skipOtp: true },
});
P('body skipOtp:true does NOT bypass OTP', r.status >= 400, `got ${r.status}`);

// wrong bot secret is rejected too
r = await call('/api/auth/register/personal', {
  method: 'POST', headers: { 'x-bot-secret': 'guessed' },
  body: { phone: '935556677', password: 'parol123', fullName: 'Eve' },
});
P('wrong x-bot-secret does NOT bypass OTP', r.status >= 400, `got ${r.status}`);

console.log('\n--- #7 debtor validation ---');
// unauthenticated, but validation runs before auth? verify it is auth-guarded first
r = await call('/api/debtors', { method: 'POST', body: { fullName: 'Ali', phone: '901234567' } });
P('debtor create requires auth', r.status === 401, `got ${r.status}`);

// schema-level checks via zod directly
const { debtorSchemas } = await import('../src/controllers/debtor.controller.js');
const okName = debtorSchemas.create.safeParse({ fullName: 'Akmal Yusupov', phone: '901234567' });
P('valid name+phone accepted', okName.success);
const numName = debtorSchemas.create.safeParse({ fullName: '12345', phone: '901234567' });
P('numeric name rejected', !numName.success);
const shortName = debtorSchemas.create.safeParse({ fullName: 'A', phone: '901234567' });
P('1-char name rejected', !shortName.success);
const cyr = debtorSchemas.create.safeParse({ fullName: 'Дилноза Каримова', phone: '901234567' });
P('cyrillic name accepted', cyr.success);
const uzb = debtorSchemas.create.safeParse({ fullName: "G'ulomjon O'ktamov", phone: '901234567' });
P('uzbek apostrophes accepted', uzb.success);
const letterPhone = debtorSchemas.create.safeParse({ fullName: 'Ali Valiyev', phone: 'abcdefgh' });
P('letters in phone rejected', !letterPhone.success);
const noContact = debtorSchemas.create.safeParse({ fullName: 'Ali Valiyev' });
P('no phone and no telegram rejected', !noContact.success);

// update schema
const upd = debtorSchemas.update.safeParse({ fullName: 'Yangi Ism' });
P('partial update accepted', upd.success);
const updBadPhone = debtorSchemas.update.safeParse({ phone: 'xyz' });
P('update with bad phone rejected', !updBadPhone.success);

server.close();
