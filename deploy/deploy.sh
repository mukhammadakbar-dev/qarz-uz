#!/usr/bin/env bash
# Serverda ishga tushiriladi (deploy foydalanuvchisi): kodni yangilaydi, quradi, migratsiyalarni qo'llaydi,
# PM2 ni qayta yuklaydi va /readyz bilan tekshiradi. Muvaffaqiyatsiz bo'lsa avvalgi kodga qaytadi.
#
#   APP_DIR=/srv/nasiya BRANCH=main deploy/deploy.sh
#
# Eslatma: migratsiyalar faqat oldinga ketadi (ADR-0001). Rollback faqat kodni qaytaradi; sxema o'zgarishlari
# orqaga qaytmaydi, shuning uchun har bir migratsiya avvalgi kod versiyasi bilan mos ishlashi shart (expand/contract).
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/nasiya}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${NASIYA_ENV_FILE:-/etc/nasiya/server.env}"
export NASIYA_ENV_FILE="$ENV_FILE"

log() { printf '[deploy] %s\n' "$*"; }

[ -r "$ENV_FILE" ] || { log "env fayl o'qilmadi: $ENV_FILE"; exit 1; }
PORT="$(grep -E '^PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2 || true)"
PORT="${PORT:-3000}"

cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true

PREVIOUS="$(git rev-parse HEAD)"

migrate() {
  (cd apps/server && node --env-file="$ENV_FILE" dist/migrate.js)
}

reload() {
  pm2 startOrReload ecosystem.config.cjs --update-env
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT}/readyz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

log "yangilanmoqda: $PREVIOUS -> origin/$BRANCH"
git fetch --prune origin
git checkout -q "$BRANCH"
git reset --hard "origin/$BRANCH"
CURRENT="$(git rev-parse HEAD)"

pnpm install --frozen-lockfile
pnpm --filter @nasiya/server build
pnpm --filter @nasiya/miniapp build
log "migratsiyalar"
migrate
log "PM2 qayta yuklanmoqda"
reload

if healthy; then
  pm2 save >/dev/null 2>&1 || true
  log "tayyor: $CURRENT"
  exit 0
fi

log "XATO: /readyz javob bermadi. Avvalgi versiyaga qaytilmoqda: $PREVIOUS"
git reset --hard "$PREVIOUS"
pnpm install --frozen-lockfile
pnpm --filter @nasiya/server build
pnpm --filter @nasiya/miniapp build
reload
if healthy; then log "qaytarildi: $PREVIOUS"; else log "QAYTARISH HAM MUVAFFAQIYATSIZ — qo'lda tekshiring: pm2 logs nasiya"; fi
exit 1
