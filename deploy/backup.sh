#!/usr/bin/env bash
# Kissa: kunlik zaxira (pg_dump -Fc) + tiklash tekshiruvi. 14 kun saqlanadi. Cron: /etc/cron.d/kissa-backup
# Har nusxa vaqtinchalik bazaga tiklanadi: jadvallar soni bir xil, ledger yozuvlari nusxadan oldingidan kam emasligi
# tekshiriladi (ledger faqat qo'shiladi). Mos kelmasa — xato kodi va logda XATO.
# Har qanday xato operatorga (kissa-notify) yuboriladi.
#
# Offsite nusxa (T6.5): /etc/nasiya/server.env da BACKUP_PASSPHRASE va BACKUP_TELEGRAM_CHAT_ID bo'lsa, nusxa
# gpg (AES256) bilan shifrlanib shu chatga hujjat sifatida yuboriladi (Telegram bot chegarasi — 50 MB).
# Parolsiz nusxa serverdan tashqariga hech qachon chiqmaydi. Parol parol menejerida ham saqlansin: busiz tiklab bo'lmaydi.
set -euo pipefail
ENV_FILE="${NASIYA_ENV_FILE:-/etc/nasiya/server.env}"
NOTIFY=/usr/local/bin/kissa-notify
DIR=/var/backups/kissa
DB=nasiya
KEEP_DAYS=14
TS=$(TZ=Asia/Tashkent date +%Y%m%d-%H%M)
FILE="$DIR/$DB-$TS.dump"
CHECK_DB="${DB}_restore_check"
log() { echo "[$(date -Is)] $*"; }
q() { sudo -u postgres psql -Atqd "$1" -c "$2"; }
val() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
fail() {
  log "XATO: $*"
  [ -x "$NOTIFY" ] && "$NOTIFY" "🚨 Kissa zaxira: $*. Log: /var/log/kissa-backup.log" || true
  exit 1
}
trap 'fail "kutilmagan xato (qator $LINENO)"' ERR

umask 077
mkdir -p "$DIR"
cd /tmp
LEDGER_BEFORE=$(q "$DB" "SELECT count(*) FROM ledger_entries")
TABLES=$(q "$DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
sudo -u postgres pg_dump -Fc -d "$DB" > "$FILE.part"
mv "$FILE.part" "$FILE"

# Tiklash tekshiruvi (fayl root'niki: postgres'ga stdin orqali beriladi)
sudo -u postgres dropdb --if-exists "$CHECK_DB" 2>/dev/null
sudo -u postgres createdb "$CHECK_DB"
sudo -u postgres pg_restore -d "$CHECK_DB" --no-owner --no-privileges --exit-on-error < "$FILE"
R_TABLES=$(q "$CHECK_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
R_LEDGER=$(q "$CHECK_DB" "SELECT count(*) FROM ledger_entries")
sudo -u postgres dropdb "$CHECK_DB"
if [ "$R_TABLES" != "$TABLES" ] || [ "$R_LEDGER" -lt "$LEDGER_BEFORE" ]; then
  fail "tiklash tekshiruvi mos kelmadi (jadvallar $TABLES/$R_TABLES, ledger $LEDGER_BEFORE/$R_LEDGER) — $FILE"
fi

find "$DIR" -name "$DB-*.dump" -mtime +"$KEEP_DAYS" -delete

# Offsite: shifrlangan nusxa Telegram chatiga
PASS="$(val BACKUP_PASSPHRASE)"
CHAT="$(val BACKUP_TELEGRAM_CHAT_ID)"
OFFSITE="yo'q"
if [ -n "$PASS" ] && [ -n "$CHAT" ]; then
  ENC="$FILE.gpg"
  printf '%s' "$PASS" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 -o "$ENC" "$FILE"
  if [ "$(stat -c %s "$ENC")" -gt $((49 * 1024 * 1024)) ]; then
    rm -f "$ENC"
    fail "shifrlangan nusxa 49 MB dan katta — Telegram'ga sig'maydi, boshqa offsite kerak (RUNBOOK)"
  fi
  "$NOTIFY" --file "$ENC" "$CHAT" "Kissa zaxira $TS (ledger=$R_LEDGER)" || { rm -f "$ENC"; fail "offsite yuborilmadi"; }
  rm -f "$ENC"
  OFFSITE="telegram"
fi

log "OK $FILE ($(du -h "$FILE" | cut -f1)), jadvallar=$R_TABLES, ledger=$R_LEDGER, offsite=$OFFSITE"
