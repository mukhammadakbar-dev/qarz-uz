#!/usr/bin/env bash
#
# Nightly Postgres dump for the qarz stack.
#
# Install (as the user that owns the compose project):
#   chmod +x deploy/backup.sh
#   crontab -e
#   15 3 * * * /home/acer/projects/qarz-uz/deploy/backup.sh >> /var/log/qarz-backup.log 2>&1
#
# A backup nobody has restored is a guess, not a backup. Verify with:
#   gunzip -c backups/qarz-YYYY-MM-DD-HHMM.sql.gz | docker compose exec -T db psql -U "$DB_USER" -d restore_test

set -euo pipefail

# Resolve paths relative to this script, so cron's bare environment (no cwd,
# minimal PATH) does not silently write dumps into /.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"

# How many daily dumps to keep. 14 days of a small database costs very little
# and covers a corruption noticed a week late.
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

cd "$PROJECT_DIR"

# shellcheck disable=SC1091
set -a; source .env; set +a

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F-%H%M)"
TARGET="$BACKUP_DIR/qarz-$STAMP.sql.gz"
# Write to a temp name and rename at the end: a dump interrupted halfway would
# otherwise sit in the directory looking like a valid backup.
TMP="$TARGET.partial"

echo "[backup] $(date -Is) dumping $DB_NAME -> $TARGET"

# --clean --if-exists so the dump can be replayed over an existing database.
# -T (no TTY) because cron has no terminal attached.
docker compose exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists \
  | gzip -9 > "$TMP"

# pg_dump's exit status, not gzip's — a pipeline reports only the last command.
# `set -o pipefail` above makes the whole pipeline fail, and this catches the
# other classic failure: a "successful" run that produced an empty file.
if [ ! -s "$TMP" ]; then
  echo "[backup] FAILED: dump is empty" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$TARGET"
chmod 600 "$TARGET"   # contains every user's data, including password hashes

echo "[backup] wrote $(du -h "$TARGET" | cut -f1)"

# Prune old dumps only after a successful new one, so a run of failures never
# leaves the directory empty.
find "$BACKUP_DIR" -name 'qarz-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete

echo "[backup] done"

# NOTE: these dumps sit on the same machine as the database. A disk failure or
# a compromised host takes both. Copy them off-box — rclone to object storage,
# scp to another server, anything that is not this disk.
