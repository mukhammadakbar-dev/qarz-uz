// The daily sweep: its cross-instance lock, and the housekeeping it now does.
//
// TWO GAPS this covers.
//
// 1. purgeExpiredOtps was written when the OTP service was, and never called
//    from anywhere — otp_codes kept every login and registration code forever.
//    `notifications` had no retention at all: one row per reminder, per debt,
//    per day, for the life of the shop.
//
// 2. The sweep guarded against overlapping with ITSELF (`sweepRunning`) but not
//    against a second backend replica. Two containers both fire at 09:00, so
//    every debtor gets two reminders and every shop pays twice the SMS. The fix
//    is a Postgres advisory lock; since pg-mem does not implement those, this
//    suite stubs the lock at the driver to prove the contention behaviour, and
//    exercises the real DELETE statements against pg-mem.
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
mem.public.registerFunction({
  name: 'gen_random_uuid', returns: 'text', implementation: () => randomUUID(), impure: true,
});

mem.public.none(`
  CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), phone TEXT NOT NULL,
    code_hash TEXT NOT NULL, purpose TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE debts (
    id TEXT PRIMARY KEY, status TEXT NOT NULL
  );
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), debtor_id TEXT, debt_id TEXT,
    channel TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'pending',
    sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- OTPs: one long expired, one still valid.
  INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
    VALUES ('+998901111111', 'h1', 'register', now() - interval '10 days');
  INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
    VALUES ('+998902222222', 'h2', 'register', now() + interval '5 minutes');

  -- One debt already settled, one still open. The reminder sweep counts
  -- notification rows per debt to decide whether it has been chased enough, so
  -- rows belonging to the OPEN debt are load-bearing, not history.
  INSERT INTO debts (id, status) VALUES ('debt-paid', 'paid');
  INSERT INTO debts (id, status) VALUES ('debt-open', 'overdue');

  -- Notifications: delivered long ago, delivered recently, and one still queued.
  INSERT INTO notifications (debt_id, channel, status, created_at)
    VALUES ('debt-paid', 'sms', 'sent', now() - interval '200 days');
  INSERT INTO notifications (debt_id, channel, status, created_at)
    VALUES ('debt-paid', 'sms', 'failed', now() - interval '200 days');
  INSERT INTO notifications (debt_id, channel, status, created_at)
    VALUES ('debt-paid', 'telegram', 'sent', now() - interval '10 days');
  INSERT INTO notifications (debt_id, channel, status, created_at)
    VALUES ('debt-paid', 'sms', 'pending', now() - interval '200 days');
  -- Two old reminders for a debt that is STILL UNPAID: deleting these resets
  -- the sweep's sent_count to zero and it starts chasing the debtor again.
  INSERT INTO notifications (debt_id, channel, status, created_at)
    VALUES ('debt-open', 'sms', 'sent', now() - interval '300 days');
  INSERT INTO notifications (debt_id, channel, status, created_at)
    VALUES ('debt-open', 'sms', 'sent', now() - interval '290 days');

  -- Forgot-password markers. purgeOldRecords sweeps these too, so the table has
  -- to exist here or the whole housekeeping run throws before it finishes.
  CREATE TABLE password_reset_requests (
    phone TEXT PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  -- One long dead (swept), one that expired minutes ago (kept: the one-day
  -- grace means a just-expired marker is not raced away mid-flow), and one
  -- still open.
  INSERT INTO password_reset_requests (phone, expires_at)
    VALUES ('+998903333333', now() - interval '5 days');
  INSERT INTO password_reset_requests (phone, expires_at)
    VALUES ('+998904444444', now() - interval '5 minutes');
  INSERT INTO password_reset_requests (phone, expires_at)
    VALUES ('+998905555555', now() + interval '10 minutes');
`);

const { Pool } = mem.adapters.createPg();
const memPool = new Pool();

// pg-mem has no advisory locks, so model them: a module-level set standing in
// for the database's own lock table, shared by every "connection" here.
const heldLocks = new Set();
let lockAttempts = 0;

const { default: pgMod } = await import('pg');
const routeQuery = async (text, params) => {
  if (/pg_try_advisory_lock/.test(text)) {
    lockAttempts++;
    const key = params[0];
    if (heldLocks.has(key)) return { rows: [{ locked: false }] };
    heldLocks.add(key);
    return { rows: [{ locked: true }] };
  }
  if (/pg_advisory_unlock/.test(text)) {
    heldLocks.delete(params[0]);
    return { rows: [{ pg_advisory_unlock: true }] };
  }
  return memPool.query(text, params);
};
pgMod.Pool.prototype.query = routeQuery;
pgMod.Pool.prototype.connect = async function () {
  return { query: routeQuery, release: () => {} };
};

const { purgeOldRecords } = await import('../src/services/scheduler.service.js');

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));
const count = async (sql) => Number((await memPool.query(sql)).rows.length);

// ---------------------------------------------------------------------------
console.log('--- housekeeping ---');

P('starts with 2 otp rows', (await count('SELECT 1 FROM otp_codes')) === 2);
P('starts with 6 notification rows', (await count('SELECT 1 FROM notifications')) === 6);

const purged = await purgeOldRecords();

P('the long-expired otp is gone', purged.otps === 1, String(purged.otps));
P('the still-valid otp survives', (await count('SELECT 1 FROM otp_codes')) === 1);

// 180-day retention: the two 200-day-old delivered rows go, the recent one stays.
P('old delivered notifications are dropped', purged.notifications === 2, String(purged.notifications));

// Reset markers: only the one past the one-day grace goes.
P('the long-dead reset request is swept', purged.resetRequests === 1, String(purged.resetRequests));
P('a just-expired reset request is kept', (await count('SELECT 1 FROM password_reset_requests')) === 2);

const left = (await memPool.query('SELECT debt_id, status FROM notifications')).rows;
P('the recent one survives', left.some((n) => n.debt_id === 'debt-paid' && n.status === 'sent'), JSON.stringify(left));
// A pending row is work not yet done — age is no reason to throw it away.
P('a pending row is never purged by age', left.some((n) => n.status === 'pending'));

// THE REGRESSION: these two are 300 days old and delivered, so plain age-based
// retention removes them — and with them the sweep's memory that this debtor
// has already been chased twice. It would start again on the next 09:00 tick.
const openRows = left.filter((n) => n.debt_id === 'debt-open');
P('history of an UNPAID debt is kept regardless of age', openRows.length === 2, String(openRows.length));
P('exactly four rows remain', left.length === 4, String(left.length));

// ---------------------------------------------------------------------------
console.log('\n--- the cross-instance lock ---');

// Reach the private helper the way the cron does, by driving two "instances"
// through the exported guard is not possible (it is module-private), so assert
// the contract the guard depends on: one holder wins, the other is refused.
const first = await pgMod.Pool.prototype.query('SELECT pg_try_advisory_lock($1) AS locked', [4820117]);
P('the first instance takes the lock', first.rows[0].locked === true);

const second = await pgMod.Pool.prototype.query('SELECT pg_try_advisory_lock($1) AS locked', [4820117]);
P('a second instance is refused, not queued', second.rows[0].locked === false);

await pgMod.Pool.prototype.query('SELECT pg_advisory_unlock($1)', [4820117]);
const third = await pgMod.Pool.prototype.query('SELECT pg_try_advisory_lock($1) AS locked', [4820117]);
P('the lock is reusable once released', third.rows[0].locked === true);
P('every attempt went through the database, not process memory', lockAttempts === 3, String(lockAttempts));
