#!/usr/bin/env bash
# Kissa: operatorga Telegram xabari/fayli — Node'siz (ilova to'xtagan bo'lsa ham ishlaydi).
# Serverda: /usr/local/bin/kissa-notify. Token va superadmin ID'lari /etc/nasiya/server.env dan.
# Token buyruq argumentiga emas, curl'ga stdin (-K -) orqali beriladi: `ps` ro'yxatida ko'rinmaydi.
#
#   kissa-notify "matn"                 — barcha SUPERADMIN_TELEGRAM_IDS ga
#   kissa-notify --file FAYL CHAT "izoh" — bitta chatga hujjat (offsite zaxira)
set -uo pipefail
ENV_FILE="${NASIYA_ENV_FILE:-/etc/nasiya/server.env}"
val() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-; }
TOKEN="$(val TELEGRAM_BOT_TOKEN)"
[ -n "$TOKEN" ] || { echo "kissa-notify: TELEGRAM_BOT_TOKEN topilmadi" >&2; exit 1; }

api() { # api METHOD [curl argumentlari...]
  local method="$1"; shift
  printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$TOKEN" "$method" |
    curl -sS -m 60 -K - -o /dev/null -w '%{http_code}' "$@"
}

if [ "${1:-}" = "--file" ]; then
  file="$2"; chat="$3"; caption="${4:-}"
  code=$(api sendDocument -F "chat_id=$chat" -F "caption=$caption" -F "document=@$file")
  [ "$code" = "200" ] || { echo "kissa-notify: sendDocument HTTP $code" >&2; exit 1; }
  exit 0
fi

text="$1"
status=0
IFS=',' read -ra ids <<< "$(val SUPERADMIN_TELEGRAM_IDS)"
for id in "${ids[@]}"; do
  id="${id// /}"; [ -n "$id" ] || continue
  code=$(api sendMessage --data-urlencode "chat_id=$id" --data-urlencode "text=$text")
  [ "$code" = "200" ] || { echo "kissa-notify: $id ga HTTP $code" >&2; status=1; }
done
exit $status
