#!/usr/bin/env node
/**
 * Browser driver for qarz-web (TemirDaftar).
 *
 * The web app is useless without qarz-backend, and every interesting flow —
 * registration, password recovery — needs a 6-digit code that only the Telegram
 * bot can hand out. So this driver does three things a bare browser cannot:
 *
 *   1. drives the React app through playwright-core + headless Chromium,
 *   2. plays the BOT's part over HTTP (x-bot-secret) to mint accounts and codes,
 *   3. cleans up the rows it created, so the dev database is left as it was.
 *
 * Start the servers first — see SKILL.md. Nothing here launches them.
 *
 *   node .claude/skills/run-qarz-uz/driver.mjs smoke
 *   node .claude/skills/run-qarz-uz/driver.mjs shot /debtors --login 908887766:eskiparol1
 *   node .claude/skills/run-qarz-uz/driver.mjs repl        # commands on stdin
 *
 * Env (all optional, defaults match SKILL.md):
 *   WEB_URL=http://localhost:5173  API_URL=http://localhost:3080
 *   BOT_SECRET=run-smoke-secret    SHOT_DIR=/tmp/qarz-shots
 *   CHROMIUM=/snap/bin/chromium
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';

const WEB = process.env.WEB_URL || 'http://localhost:5173';
const API = process.env.API_URL || 'http://localhost:3080';
const BOT_SECRET = process.env.BOT_SECRET || 'run-smoke-secret';
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/qarz-shots';

// Whatever Chromium this machine has. The snap build works; Playwright's own
// download is not needed and playwright-core never fetches one.
const CHROMIUM =
  process.env.CHROMIUM ||
  ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
    .find((p) => existsSync(p));

// The account the smoke flow creates and then deletes. Deliberately fixed and
// obviously fake: cleanup() removes exactly this phone and nothing else.
const SMOKE = { phone: '908887766', norm: '+998908887766', pass: 'eskiparol1', newPass: 'yangiparol9' };

// --- the bot's side of the handshake -----------------------------------------

const apiCall = async (path, body, botSecret = false) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(botSecret ? { 'x-bot-secret': BOT_SECRET } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json.error || json)}`);
  return json;
};

/** Register a shop owner the way the bot does — a shared contact skips the OTP. */
export const seedOwner = (phone = SMOKE.phone, password = SMOKE.pass) =>
  apiCall('/api/auth/register/shop',
    { phone, password, fullName: 'Smoke Test', shopName: "Smoke Do'kon" }, true);

/** What the bot replies with after the user shares a contact for a reset. */
export const botResetCode = (phone = SMOKE.phone) =>
  apiCall('/api/auth/telegram/web-reset-code', { phone, telegramId: 4242 }, true);

/** What the bot replies with for someone registering on the website. */
export const botRegisterCode = (phone) =>
  apiCall('/api/auth/telegram/web-code', { phone, telegramId: 4242 }, true);

/**
 * Delete the smoke account. Goes through the backend's own pool so no DB
 * password is needed here — qarz-backend/.env is the single source of it.
 * The shop, subscription, sms_balance and reminder_settings go with it (FK
 * ON DELETE CASCADE).
 */
// The pg pool is a module singleton: end it once, at process exit, or a second
// cleanup() in the same run dies with "Cannot use a pool after calling end".
let db = null;
const getDb = async () => {
  if (db) return db;
  // config/index.js calls a bare dotenv.config(), which resolves .env against
  // the CWD — and this driver runs from the repo root, where there is no DB
  // password. Load the backend's own .env first, or the connection is refused.
  const backend = new URL('../../../qarz-backend/', import.meta.url).pathname;
  const dotenv = await import(`${backend}node_modules/dotenv/lib/main.js`);
  dotenv.default.config({ path: `${backend}.env` });
  db = await import(`${backend}src/db/pool.js`);
  return db;
};
const closeDb = async () => { if (db) { await db.pool.end(); db = null; } };

export const cleanup = async (phone = SMOKE.norm) => {
  const { query } = await getDb();
  await query('DELETE FROM otp_codes WHERE phone = $1', [phone]);
  await query('DELETE FROM password_reset_requests WHERE phone = $1', [phone]);
  const { rowCount } = await query('DELETE FROM users WHERE phone = $1', [phone]);
  return rowCount;
};

// --- browser -----------------------------------------------------------------

const open = async () => {
  if (!CHROMIUM) throw new Error('No Chromium found. Set CHROMIUM=/path/to/chromium.');
  mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const shot = async (name) => {
    const path = `${SHOT_DIR}/${name}.png`;
    await page.screenshot({ path });
    console.log(`[shot] ${path}`);
    return path;
  };
  return { browser, page, errors, shot };
};

/** Sign in through the real form. Returns once the app has left /login. */
const signIn = async (page, phone, password) => {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Hisobingizga kiring');
  await page.fill('input[inputmode="tel"]', phone);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Kirish")');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
  await page.waitForTimeout(800); // let the dashboard's first fetch paint
};

// --- flows -------------------------------------------------------------------

/**
 * The forgot-password flow end to end, plus a look at /staff.
 *
 * Touches every layer: React form → backend → OTP table → the bot's code →
 * password write → session cull. If this passes, the stack is wired up.
 */
const smoke = async () => {
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
  };

  await cleanup().catch(() => {});           // in case a previous run died mid-way
  await seedOwner();
  console.log(`[api] seeded ${SMOKE.norm} / ${SMOKE.pass}`);

  const { browser, page, errors, shot } = await open();
  try {
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Hisobingizga kiring');
    await shot('1-login');

    await page.click('text=Parolni unutdingizmi?');
    await page.waitForSelector('text=Parolni tiklash');
    await page.fill('input[inputmode="tel"]', SMOKE.phone);
    await page.click('text=Bot orqali kod olish');
    await page.waitForSelector("text=Yangi parol o'rnatish", { timeout: 15000 });
    await shot('2-awaiting-code');
    check('recovery reaches the code step', true);

    const { code, ttlMinutes } = await botResetCode();
    console.log(`[bot] code=${code} ttl=${ttlMinutes}m`);
    check('bot mints a 6-digit code', /^\d{6}$/.test(code || ''), String(code));

    await page.fill('.otp-input', code);
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(SMOKE.newPass);
    await pw.nth(1).fill(SMOKE.newPass + 'x');
    await shot('3-mismatch');
    check('mismatched passwords block submit',
      await page.locator('button:has-text("Parolni yangilash")').isDisabled());

    await pw.nth(1).fill(SMOKE.newPass);
    await page.click('button:has-text("Parolni yangilash")');
    await page.waitForSelector('text=Hisobingizga kiring', { timeout: 15000 });
    await shot('4-back-to-login');
    check('reset returns the user to the login form', true);

    await page.fill('input[inputmode="tel"]', SMOKE.phone);
    await page.fill('input[type="password"]', SMOKE.pass);
    await page.click('button:has-text("Kirish")');
    await page.waitForTimeout(1500);
    check('the old password is refused',
      await page.locator('text=Hisobingizga kiring').isVisible());

    await page.fill('input[type="password"]', SMOKE.newPass);
    await page.click('button:has-text("Kirish")');
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
    await page.waitForTimeout(1000);
    await shot('5-dashboard');
    check('the new password signs in', !page.url().includes('login'), page.url());

    await page.goto(`${WEB}/staff`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Xodimlar');
    await page.waitForTimeout(600);
    await shot('6-staff');
    check('staff list renders', await page.locator('text=Xodimlar').first().isVisible());

    // Deliberately disabled in the UI right now — see pages/Staff.jsx.
    const addButtons = await page.locator('button:has-text("Xodim qo\'shish")').count();
    console.log(`[info] "Xodim qo'shish" buttons: ${addButtons}`);

    // The 401 from the deliberate wrong-password login is expected.
    const unexpected = errors.filter((e) => !e.includes('401'));
    check('no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
  } finally {
    await browser.close();
    const removed = await cleanup().catch((e) => `cleanup failed: ${e.message}`);
    await closeDb();
    console.log(`[cleanup] removed ${removed} user row(s)`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length} checks — ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

/** Screenshot any route, optionally signing in first. */
const shotRoute = async (route, login) => {
  const { browser, page, errors, shot } = await open();
  try {
    if (login) {
      const [phone, password] = login.split(':');
      await signIn(page, phone, password);
    }
    await page.goto(WEB + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await shot('route' + route.replace(/\//g, '_'));
    console.log('[url]', page.url());
    console.log('[console errors]', errors.length ? errors : 'none');
  } finally {
    await browser.close();
  }
};

/**
 * Line-oriented REPL — the general handle for anything this file does not
 * already script. One command per line on stdin:
 *
 *   nav /debtors            goto a route
 *   login 908887766:parol   sign in through the form
 *   click <selector|text=…> playwright click
 *   fill <selector> <value> playwright fill (React-safe; `eval el.value=` is not)
 *   text <selector>         print innerText
 *   count <selector>        print match count
 *   eval <js>               run in the page, print the result
 *   shot <name>             screenshot to $SHOT_DIR
 *   errors                  print collected console errors
 *   quit
 */
const repl = async () => {
  const { browser, page, errors, shot } = await open();
  console.log(`[ready] ${WEB} — shots in ${SHOT_DIR}`);
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    try {
      switch (cmd) {
        case '': break;
        case 'nav': await page.goto(WEB + (arg || '/'), { waitUntil: 'networkidle' }); console.log('[ok]', page.url()); break;
        case 'login': { const [p, pw] = arg.split(':'); await signIn(page, p, pw); console.log('[ok]', page.url()); break; }
        case 'click': await page.click(arg); console.log('[ok] clicked'); break;
        case 'fill': { const sel = rest[0]; await page.fill(sel, rest.slice(1).join(' ')); console.log('[ok] filled'); break; }
        case 'text': console.log(await page.locator(arg).first().innerText()); break;
        case 'count': console.log(await page.locator(arg).count()); break;
        case 'eval': console.log(await page.evaluate(arg)); break;
        case 'shot': await shot(arg || 'repl'); break;
        case 'errors': console.log(errors.length ? errors : 'none'); break;
        case 'quit': rl.close(); break;
        default: console.log(`[?] unknown: ${cmd}`);
      }
    } catch (err) {
      console.log('[err]', err.message.split('\n')[0]);
    }
  }
  await browser.close();
};

// --- entry -------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

switch (cmd) {
  case 'smoke': await smoke(); break;
  case 'shot': await shotRoute(args[0] || '/', flag('--login')); break;
  case 'repl': await repl(); break;
  case 'seed': console.log(JSON.stringify(await seedOwner(), null, 2).slice(0, 200)); break;
  case 'reset-code': console.log(JSON.stringify(await botResetCode())); break;
  case 'cleanup': console.log(`removed ${await cleanup()} user row(s)`); await closeDb(); break;
  default:
    console.log(`usage: node driver.mjs <smoke|shot <route> [--login phone:pass]|repl|seed|reset-code|cleanup>`);
    process.exit(1);
}
