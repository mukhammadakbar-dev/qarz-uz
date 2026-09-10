// Retiring subscriptions whose period has ended.
//
// THE BUG: nothing ever wrote 'expired' to subscriptions.status. enforceSubscription
// worked expiry out from ends_at on every request and left the row untouched, so
// a shop that stopped paying kept a row saying 'active' forever — and every
// reader that trusted the column instead of recomputing was wrong. The Super
// Admin shop list shows that status directly, and the daily sweep now makes it
// true.
import { newDb } from 'pg-mem';
import { randomUUID } from 'crypto';

const mem = newDb();
mem.public.registerFunction({ name: 'now', returns: 'timestamptz', implementation: () => new Date() });
mem.public.registerFunction({
  name: 'gen_random_uuid', returns: 'text', implementation: () => randomUUID(), impure: true,
});

mem.public.none(`
  CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- runReminderSweep joins these before it gets to the subscription update.
  CREATE TABLE debtors (
    id TEXT PRIMARY KEY, shop_id TEXT, full_name TEXT, phone TEXT, telegram_id BIGINT
  );
  CREATE TABLE debts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), debtor_id TEXT, shop_id TEXT,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0, paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    due_date DATE, status TEXT NOT NULL DEFAULT 'open',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE reminder_settings (
    shop_id TEXT PRIMARY KEY, days_before INTEGER NOT NULL DEFAULT 1,
    repeat_count INTEGER NOT NULL DEFAULT 2, repeat_interval_days INTEGER NOT NULL DEFAULT 3,
    template TEXT, prefer_channel TEXT
  );
  CREATE TABLE sms_balance (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), shop_id TEXT NOT NULL,
    monthly_limit INTEGER NOT NULL DEFAULT 30, remaining INTEGER NOT NULL DEFAULT 30,
    extra_package INTEGER NOT NULL DEFAULT 0,
    period_start DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE otp_codes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), phone TEXT NOT NULL,
    code_hash TEXT NOT NULL, purpose TEXT NOT NULL, consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), debt_id TEXT,
    channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Paying, still within its period.
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-live', 'pro', 'active', now() + interval '20 days');
  -- Paid once, ran out a month ago, never retired: the ghost.
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-ghost', 'business', 'active', now() - interval '30 days');
  -- Ran out four minutes ago — after today's sweep, before tomorrow's.
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-justnow', 'pro', 'active', now() - interval '4 minutes');
  -- On trial, still running: worth nothing yet, and must not be retired.
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-trial', 'start', 'trial', now() + interval '10 days');
  -- Trial that ran out: also needs retiring.
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-deadtrial', 'start', 'trial', now() - interval '2 days');
  -- Blocked by moderation. Not the sweep's business.
  INSERT INTO subscriptions (shop_id, plan, status, ends_at)
    VALUES ('shop-blocked', 'pro', 'blocked', now() + interval '5 days');
`);

const { Pool } = mem.adapters.createPg();
const memPool = new Pool();
const { default: pgMod } = await import('pg');
pgMod.Pool.prototype.query = function (text, params) { return memPool.query(text, params); };
pgMod.Pool.prototype.connect = async function () {
  return { query: (t, p) => memPool.query(t, p), release: () => {} };
};

const P = (n, c, extra) => console.log((c ? 'PASS' : 'FAIL') + ' ' + n + (extra ? ' :: ' + extra : ''));

const activeCount = async () => {
  const { rows } = await memPool.query(
    `SELECT COUNT(*) AS c FROM subscriptions WHERE status IN ('active','trial') AND ends_at > now()`
  );
  return Number(rows[0].c);
};
const statusOf = async (shopId) => {
  const { rows } = await memPool.query('SELECT status FROM subscriptions WHERE shop_id = $1', [shopId]);
  return rows[0].status;
};

// ---------------------------------------------------------------------------
console.log('--- before the sweep ---');

// Three rows still SAY 'active' — the live one and two that have lapsed. The
// shop list renders that word straight from the column.
const stillActive = await memPool.query("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active'");
P('three rows claim to be active', Number(stillActive.rows[0].c) === 3, String(stillActive.rows[0].c));
P('but only two are genuinely live', (await activeCount()) === 2, String(await activeCount()));

// ---------------------------------------------------------------------------
console.log('\n--- the sweep retires them ---');

const { retireLapsedSubscriptions } = await import('../src/services/scheduler.service.js');
const retired = await retireLapsedSubscriptions();
P('three lapsed rows were retired', retired === 3, String(retired));

P('a long-lapsed subscription is retired', (await statusOf('shop-ghost')) === 'expired', await statusOf('shop-ghost'));
P('one that ran out minutes ago is retired too', (await statusOf('shop-justnow')) === 'expired', await statusOf('shop-justnow'));
P('an expired trial is retired', (await statusOf('shop-deadtrial')) === 'expired', await statusOf('shop-deadtrial'));

P('a paying subscription is left alone', (await statusOf('shop-live')) === 'active', await statusOf('shop-live'));
P('a running trial is left alone', (await statusOf('shop-trial')) === 'trial', await statusOf('shop-trial'));
// 'blocked' is a moderation decision with its own meaning; overwriting it with
// 'expired' would quietly unblock the shop the moment someone extended it.
P('a blocked subscription keeps its status', (await statusOf('shop-blocked')) === 'blocked', await statusOf('shop-blocked'));

// ---------------------------------------------------------------------------
console.log('\n--- after the sweep ---');

// The column now says what ends_at always meant, so the two agree.
const nowActive = await memPool.query("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active'");
P('the column now matches reality', Number(nowActive.rows[0].c) === 1, String(nowActive.rows[0].c));
P('the live count is unchanged by the sweep', (await activeCount()) === 2, String(await activeCount()));

// Running twice must be a no-op — the cron fires every day.
const again = await retireLapsedSubscriptions();
P('a second run retires nothing', again === 0, String(again));
P('and leaves the live subscription alone', (await statusOf('shop-live')) === 'active');
