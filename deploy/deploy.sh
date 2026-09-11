#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# TemirDaftar Production Deployment Script
# Usage: ./deploy/deploy.sh
#
# Two layouts are supported:
#   pm2    — services run directly under pm2 (qarz-backend, qarz-bot,
#            qarz-web serving qarz-web/dist). Used when pm2 is installed.
#   docker — docker-compose.yml, as described in DEPLOY.md.
# ============================================================

echo "🚀 Starting TemirDaftar Deployment..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

# A non-interactive SSH session does not read the shell rc files, so node/pm2
# installed through nvm are not on PATH until nvm is loaded explicitly.
for NVM_SH in "${NVM_DIR:-}/nvm.sh" /usr/local/nvm/nvm.sh "$HOME/.nvm/nvm.sh"; do
  if [ -s "$NVM_SH" ]; then
    set +u
    # shellcheck disable=SC1090
    . "$NVM_SH"
    set -u
    break
  fi
done

if [ ! -f .env ]; then
  echo "❌ Error: .env file missing in $ROOT_DIR. Please copy .env.production.example to .env and configure secrets."
  exit 1
fi

echo "📥 Pulling latest updates from git repository..."
git config --global --add safe.directory "$ROOT_DIR" 2>/dev/null || true
git pull --ff-only origin main

if command -v pm2 >/dev/null 2>&1; then
  echo "📦 Installing dependencies..."
  (cd qarz-backend && npm ci --omit=dev)
  (cd qarz-bot && npm ci --omit=dev)
  # The web build needs its devDependencies (vite).
  (cd qarz-web && npm ci && npm run build)

  echo "🗄️ Executing database migrations..."
  (cd qarz-backend && node src/db/migrate.js)

  echo "🔄 Restarting PM2 processes..."
  pm2 restart qarz-backend qarz-bot qarz-web --update-env
  pm2 save
  pm2 ls
else
  echo "🐳 Building and starting Docker containers..."
  docker compose up -d --build

  echo "🗄️ Executing database migrations..."
  docker compose run --rm backend node src/db/migrate.js

  docker compose ps
fi

echo "✅ Deployment completed successfully! All services are running."
