// Boot the app with a stubbed pg pool so we can exercise routes without PostgreSQL.
import { createServer } from 'http';

// stub pg before app import
const { default: pgMod } = await import('pg');
const rowsFor = { };
pgMod.Pool.prototype.query = async function(text, params) {
  const t = String(text);
  if (t.includes('FROM users WHERE phone')) return { rows: [] }; // no such user
  if (t.includes('INSERT INTO otp_codes')) return { rows: [{}] };
  if (t.includes('UPDATE otp_codes')) return { rows: [] };
  return { rows: [] };
};
pgMod.Pool.prototype.connect = async function(){ return { query: async()=>({rows:[]}), release(){} }; };

const { createApp } = await import('../src/app.js');
const app = createApp();
const server = createServer(app);
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const call = async (path, opts={}) => {
  const res = await fetch(base+path, {
    method: opts.method||'GET',
    headers: {'Content-Type':'application/json'},
    body: opts.body?JSON.stringify(opts.body):undefined
  });
  let j; try { j = await res.json(); } catch { j = {}; }
  return { status: res.status, body: j };
};

const P=(n,c,extra='')=>console.log((c?'PASS':'FAIL')+' '+n+(extra?' :: '+extra:''));

// 1. legacy endpoint gone
let r = await call('/api/auth/telegram/link', {method:'POST', body:{phone:'901234567', telegramId:1}});
P('legacy /telegram/link returns 410', r.status===410, `got ${r.status} ${r.body?.error?.code}`);

// 2. request-link does not leak whether the account exists
r = await call('/api/auth/telegram/request-link', {method:'POST', body:{phone:'901234567'}});
P('request-link 200 + {sent:true} for unknown phone', r.status===200 && r.body.sent===true, JSON.stringify(r.body));

// 3. confirm-link requires 6-digit otp
r = await call('/api/auth/telegram/confirm-link', {method:'POST', body:{phone:'901234567', telegramId:1, otp:'12'}});
P('confirm-link rejects short OTP (422)', r.status===422, `got ${r.status}`);

// 4. confirm-link requires otp field at all
r = await call('/api/auth/telegram/confirm-link', {method:'POST', body:{phone:'901234567', telegramId:1}});
P('confirm-link rejects missing OTP (422)', r.status===422, `got ${r.status}`);

// 5. debtor create requires phone or telegramId -> but needs auth first (401 expected)
r = await call('/api/debtors', {method:'POST', body:{fullName:'Test'}});
P('debtors requires auth (401)', r.status===401, `got ${r.status}`);

// 6. staff endpoint exists and requires auth
r = await call('/api/shop/staff', {method:'POST', body:{phone:'901234567',password:'secret1'}});
P('POST /api/shop/staff requires auth (401)', r.status===401, `got ${r.status}`);

r = await call('/api/shop/staff');
P('GET /api/shop/staff requires auth (401)', r.status===401, `got ${r.status}`);

// 7. health still fine
r = await call('/health');
P('health ok', r.status===200 && r.body.ok===true);

server.close();
