#!/usr/bin/env bash
# Kissa: kunlik zaxira (pg_dump -Fc) + tiklash tekshiruvi. 14 kun saqlanadi. Cron: /etc/cron.d/kissa-backup
# Har nusxa vaqtinchalik bazaga tiklanadi: jadvallar soni bir xil, ledger yozuvlari nusxadan oldingidan kam emasligi
# tekshiriladi (ledger faqat qo'shiladi). Mos kelmasa — xato kodi va logda XATO.
set -euo pipefail
DIR=/var/backups/kissa
DB=nasiya
KEEP_DAYS=14
TS=$(TZ=Asia/Tashkent date +%Y%m%d-%H%M)
FILE="$DIR/$DB-$TS.dump"
CHECK_DB="${DB}_restore_check"
log() { echo "[$(date -Is)] $*"; }
q() { sudo -u postgres psql -Atqd "$1" -c "$2"; }

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
  log "XATO: tiklash tekshiruvi mos kelmadi (jadvallar $TABLES/$R_TABLES, ledger $LEDGER_BEFORE/$R_LEDGER) — $FILE"
  exit 1
fi

find "$DIR" -name "$DB-*.dump" -mtime +"$KEEP_DAYS" -delete
log "OK $FILE ($(du -h "$FILE" | cut -f1)), jadvallar=$R_TABLES, ledger=$R_LEDGER"
