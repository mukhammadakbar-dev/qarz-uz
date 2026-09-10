---
name: run-qarz-uz
description: Build, run, and drive TemirDaftar.uz (qarz-uz) — start the backend API and web app locally, take screenshots of pages, sign in, drive UI flows in a real browser, or run the test suites. Use when asked to run/start/launch the app, screenshot a page, reproduce a bug in the running app, or verify a change end-to-end.
---

Qarz-uz is three deployables — `qarz-backend` (Express + Postgres), `qarz-web`
(React/Vite) and `qarz-bot` (grammY/Telegram). The web app is useless without
the backend, so "running the app" means both. Drive them with
`.claude/skills/run-qarz-uz/driver.mjs`, a playwright-core harness that also
plays the **bot's** part over HTTP — registration and password recovery both
need a 6-digit code that only the Telegram bot can hand out, and no flow gets
past the first screen without it.

All paths below are relative to the repo root.

## Prerequisites

Postgres must be running locally and `qarz-backend/.env` must exist with real
`DB_*` values (that file is the only place the DB password lives — the driver
reads it, you never need to see it). Verify:

```bash
pg_isready                       # → /var/run/postgresql:5432 - accepting connections
```

Chromium — the snap build on this machine works, no Playwright download needed:

```bash
ls /snap/bin/chromium            # or /usr/bin/chromium; override with CHROMIUM=
```

## Setup

Deps per package, plus `playwright-core` for the driver (it is not a project
dependency — it lives in the skill directory):

```bash
npm --prefix qarz-backend install
npm --prefix qarz-web install
npm i --prefix .claude/skills/run-qarz-uz playwright-core
npm --prefix qarz-backend run migrate     # idempotent; applies any new migration
```

## Run (agent path)

**1. Start the backend on :3080.** Set `BOT_SHARED_SECRET` explicitly — the
driver uses that same value to act as the bot. A shell env var wins over
`.env`, so this needs no file edits:

```bash
(lsof -ti:3080 -sTCP:LISTEN | xargs -r kill); sleep 1
cd qarz-backend && BOT_SHARED_SECRET=run-smoke-secret npm start > /tmp/qarz-backend.log 2>&1 &
timeout 30 bash -c 'until curl -s -o /dev/null http://localhost:3080/api/health; do sleep 0.5; done'
```

Readiness is *any* HTTP response. `/api/health` is authenticated and answers
**401** when the server is up — `curl -sf` would loop until it times out.

**2. Start the web app on :5173.** The `VITE_API_BASE_URL` override is
required, not optional — see Gotchas:

```bash
(lsof -ti:5173 -sTCP:LISTEN | xargs -r kill); sleep 1
cd qarz-web && VITE_API_BASE_URL=http://localhost:3080 npm run dev > /tmp/qarz-web.log 2>&1 &
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 0.5; done'
```

**3. Drive it.** From the repo root:

```bash
node .claude/skills/run-qarz-uz/driver.mjs smoke
```

`smoke` runs the forgot-password flow end to end in a real browser — seeds a
shop owner, clicks through "Parolni unutdingizmi?", plays the bot to mint the
code, sets a new password, proves the old one stops working, then opens
`/staff` — and deletes the account it created. Expect `8 checks — 8 passed`.

| command | what it does |
|---|---|
| `driver.mjs smoke` | full recovery + staff flow, 8 assertions, self-cleaning |
| `driver.mjs shot /debtors --login 908887766:eskiparol1` | screenshot any route, signing in first |
| `driver.mjs repl` | line-oriented REPL on stdin — the general handle |
| `driver.mjs seed` | create the smoke shop owner (`908887766` / `eskiparol1`) |
| `driver.mjs reset-code` | what the bot replies after a contact share |
| `driver.mjs cleanup` | delete the smoke account (`+998908887766` only) |

Screenshots land in `/tmp/qarz-shots/` (override with `SHOT_DIR`). **Look at
them** — a login page where you expected a dashboard means the API base is wrong.

REPL commands, one per line: `nav /route`, `login phone:pass`, `click <sel>`,
`fill <sel> <value>`, `text <sel>`, `count <sel>`, `eval <js>`, `shot <name>`,
`errors`, `quit`. Verified:

```bash
node .claude/skills/run-qarz-uz/driver.mjs seed
printf 'login 908887766:eskiparol1\nnav /debtors\ntext h1\nshot debtors\nerrors\nquit\n' \
  | node .claude/skills/run-qarz-uz/driver.mjs repl
node .claude/skills/run-qarz-uz/driver.mjs cleanup
```

**4. Stop.**

```bash
lsof -ti:3080 -sTCP:LISTEN | xargs -r kill
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
```

## Run (human path)

Same two servers, then open `http://localhost:5173` in a browser. Useless
headless — there is nothing to see without a window. `qarz-bot` is not covered
here: it needs a real `TELEGRAM_BOT_TOKEN` and long-polls Telegram. The driver
substitutes for it on every flow the web app needs.

## Test

No database needed — the backend suites run against `pg-mem` / a pg stub.

```bash
npm --prefix qarz-backend test      # → 27 suites — 411 passed, 0 failed
node qarz-bot/tests/run-all.mjs     # → 4 suites — 48 passed, 0 failed
npm --prefix qarz-web test          # → 3 files, 32 tests
npm --prefix qarz-web run build     # → vite build, ~300ms
```

## Gotchas

- **`qarz-web/.env` points `VITE_API_BASE_URL` at a dead Cloudflare tunnel.**
  Without the shell override the app builds and renders fine, then every
  request fails and the login form just sits there. Never edit the file —
  process env wins over `.env` in Vite, so pass the override on the command
  line. The `.env.example` default (`:4000`) is also wrong; the backend's own
  `.env` puts it on **3080**.
- **`/api/health` requires auth.** It returns 401, not 200. Poll for any
  response, not a successful one.
- **No flow gets anywhere without the bot.** Registration and recovery both
  gate on a 6-digit OTP that is stored hashed, so it cannot be read back out of
  the database — only `POST /api/auth/telegram/web-code` and
  `/telegram/web-reset-code` (both `x-bot-secret`) can mint one, and reset codes
  are refused unless the website asked for one first. That is why the backend
  must be started with a known `BOT_SHARED_SECRET`.
- **The reset OTP lives 5 minutes.** Fetch it right before typing it; a code
  minted at the start of a long debugging session is dead by the end.
- **Snap Chromium cannot write outside `$HOME`.** `chromium --headless
  --screenshot=/tmp/x.png` fails with "Permission denied". The driver has no
  such problem — Node receives the bytes over CDP and writes the file itself.
- **React controlled inputs:** `eval el.value = '…'` does not fire `onChange`
  and the app never sees the value. The REPL's `fill` goes through Playwright.
- **The driver writes to the real dev database.** `smoke` and `seed` create
  `+998908887766`; `smoke` deletes it in a `finally` block, and `cleanup`
  removes it by hand if a run is interrupted. It touches no other row.

## Troubleshooting

- **`cleanup failed: password authentication failed for user "postgres"`**:
  `qarz-backend/src/config/index.js` calls a bare `dotenv.config()`, which
  resolves against the CWD. The driver loads `qarz-backend/.env` explicitly
  before importing the pool — if you write your own script from the repo root,
  do the same.
- **`Cannot use a pool after calling end on the pool`**: `db/pool.js` is a
  module singleton. Call `pool.end()` once, at process exit.
- **`RESET_NOT_REQUESTED` (409) from `reset-code`**: nobody asked for a reset.
  Click "Parolni unutdingizmi?" and submit the phone in the browser first — the
  15-minute pending marker is what unlocks the code.
- **`PHONE_TAKEN` (409) from `seed`**: a previous run did not clean up. Run
  `driver.mjs cleanup`.
- **Blank/login screenshot where a dashboard was expected**: the API base
  override was missing, or the backend died. Check `/tmp/qarz-backend.log`.
