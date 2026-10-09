#!/usr/bin/env bash
# Kissa watchdog (T6.3): ilova Node jarayoni o'lsa yoki baza uzilsa ham operator biladi.
# Serverda: /usr/local/bin/kissa-watchdog, cron deploy/watchdog.cron (har 5 daqiqa, root).
#
#  - /readyz ketma-ket 2 marta yiqilsa → bitta "to'xtadi" xabari; tiklanganda → "tiklandi";
#  - Telegram webhook'da yaqinda (10 daqiqa) xato bo'lsa yoki navbat to'planib qolsa → xabar (soatiga bir).
# Server butunlay o'chsa bu skript ham ishlamaydi — buni tashqi UptimeRobot qoplaydi (docs/RUNBOOK.md).
set -uo pipefail
ENV_FILE="${NASIYA_ENV_FILE:-/etc/nasiya/server.env}"
STATE_DIR=/var/lib/kissa
NOTIFY=/usr/local/bin/kissa-notify
mkdir -p "$STATE_DIR"
val() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-; }
PORT="$(val PORT)"; PORT="${PORT:-3000}"

# ───────── Ilova holati ─────────
fails_file="$STATE_DIR/watchdog.fails"
down_file="$STATE_DIR/watchdog.down"
fails=$(cat "$fails_file" 2>/dev/null || echo 0)
if curl -fsS -m 10 "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1; then
  echo 0 > "$fails_file"
  if [ -f "$down_file" ]; then
    since=$(cat "$down_file")
    rm -f "$down_file"
    "$NOTIFY" "✅ Kissa tiklandi (to'xtagan: $since)."
  fi
else
  fails=$((fails + 1))
  echo "$fails" > "$fails_file"
  if [ "$fails" -ge 2 ] && [ ! -f "$down_file" ]; then
    TZ=Asia/Tashkent date '+%d.%m %H:%M' > "$down_file"
    pm2_state=$(sudo -iu kissa pm2 jlist 2>/dev/null | grep -o '"status":"[a-z]*"' | head -n1 | cut -d'"' -f4)
    "$NOTIFY" "🚨 Kissa javob bermayapti (/readyz ${fails} marta). PM2: ${pm2_state:-noma'lum}.
Tekshiring: ssh root@server 'sudo -iu kissa pm2 logs nasiya --lines 50'"
  fi
fi

# ───────── Telegram webhook ─────────
hook_file="$STATE_DIR/watchdog.webhook"
TOKEN="$(val TELEGRAM_BOT_TOKEN)"
info=$(printf 'url = "https://api.telegram.org/bot%s/getWebhookInfo"\n' "$TOKEN" | curl -sS -m 20 -K - 2>/dev/null || true)
pending=$(printf '%s' "$info" | grep -o '"pending_update_count":[0-9]*' | cut -d: -f2)
last_err=$(printf '%s' "$info" | grep -o '"last_error_date":[0-9]*' | cut -d: -f2)
now=$(date +%s)
problem=""
if [ -n "${last_err:-}" ] && [ $((now - last_err)) -lt 600 ]; then problem="oxirgi 10 daqiqada webhook xatosi"; fi
if [ "${pending:-0}" -gt 50 ]; then problem="${problem:+$problem, }navbatda ${pending} ta yangilanish"; fi
if [ -n "$problem" ]; then
  last_sent=$(cat "$hook_file" 2>/dev/null || echo 0)
  if [ $((now - last_sent)) -ge 3600 ]; then
    echo "$now" > "$hook_file"
    "$NOTIFY" "⚠️ Kissa Telegram webhook: ${problem}. Runbook: «Webhook tiklash»."
  fi
fi
exit 0
