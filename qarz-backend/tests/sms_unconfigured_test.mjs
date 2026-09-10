// An unconfigured SMS provider must not look like a working one.
//
// THE BUG: with ESKIZ_EMAIL / ESKIZ_PASSWORD empty, sendSms logged the message
// and returned { ok: true }. That is correct in development — the log IS the
// delivery — but the same branch ran in production, where it meant:
//   * notifyDebtor recorded the notification as `sent`
//   * the SMS credit it had reserved was NOT refunded
//   * the debtor received nothing
// So a deployment that simply forgot ESKIZ_* drained every shop's monthly
// allowance on messages that never existed, and the notifications table said
// they had all been delivered. Nothing anywhere reported a problem.
//
// The fix is to fail closed in production only. This suite pins both halves:
// production refuses, development keeps its log-and-continue behaviour.

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

// Neither branch may reach the network; a real call would also make the suite
// depend on Eskiz being up.
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('test must not reach the network');
};

// ---------------------------------------------------------------------------
console.log('--- production, no credentials ---');

process.env.NODE_ENV = 'production';
// The production config guard rejects weak values for these before anything
// else runs; they are irrelevant to what is being tested here.
process.env.JWT_ACCESS_SECRET = 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET = 'y'.repeat(32);
process.env.PAYMENT_LINK_SECRET = 'z'.repeat(32);
process.env.BOT_SHARED_SECRET = 'w'.repeat(32);
process.env.ESKIZ_EMAIL = '';
process.env.ESKIZ_PASSWORD = '';

const { sendSms: sendProd } = await import('../src/services/sms.service.js');

let r = await sendProd('+998901111111', 'test');
P('reports failure instead of success', r.ok === false, JSON.stringify(r));
P('names the missing configuration', /ESKIZ_EMAIL/.test(r.error || ''), r.error);
P('no id is handed back', r.id === undefined);
P('nothing was sent over the network', networkCalls === 0, String(networkCalls));

// This is what the fix is worth: notifyDebtor branches on `ok` to refund the
// reserved SMS credit and to store 'failed' rather than 'sent'.
P('caller can tell delivery failed', !r.ok);

// ---------------------------------------------------------------------------
console.log('\n--- development, no credentials ---');

// A second import of the same module would be cached along with its config, so
// the development case runs in its own process.
const { spawnSync } = await import('child_process');
const devCheck = spawnSync(
  process.execPath,
  [
    '-e',
    `
    globalThis.fetch = async () => { throw new Error('no network'); };
    const { sendSms } = await import('./src/services/sms.service.js');
    const r = await sendSms('+998901111111', 'salom');
    console.log(JSON.stringify({ ok: r.ok, dev: r.dev, hasId: Boolean(r.id) }));
    `,
  ],
  {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, NODE_ENV: 'development', ESKIZ_EMAIL: '', ESKIZ_PASSWORD: '' },
  }
);

const devOut = (devCheck.stdout || '').trim().split('\n').filter((l) => l.startsWith('{')).pop();
const dev = devOut ? JSON.parse(devOut) : {};
P('development still succeeds', dev.ok === true, devOut || devCheck.stderr?.slice(-200));
P('and is marked as a dev send', dev.dev === true);
P('with an id, so callers behave normally', dev.hasId === true);
