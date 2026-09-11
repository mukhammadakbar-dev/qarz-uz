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

if command -v pm2 >/dev/null 2>&1; then
  # pm2 layout: each service reads its own .env (dotenv, from its cwd).
  for f in qarz-backend/.env qarz-bot/.env; do
    if [ ! -f "$f" ]; then
      echo "❌ Error: $ROOT_DIR/$f missing. Copy it from ${f}.example and fill in secrets."
      exit 1
    fi
  done
elif [ ! -f .env ]; then
  echo "❌ Error: .env file missing in $ROOT_DIR. Please copy .env.production.example to .env and configure secrets."
  exit 1
fi

echo "📥 Pulling latest updates from git repository..."
git config --global --add safe.directory "$ROOT_DIR" 2>/dev/null || true
# Never prompt: a credential prompt would hang the CI run until it times out.
GIT_TERMINAL_PROMPT=0 git pull --ff-only origin main

if command -v pm2 >/dev/null 2>&1; then
  echo "📦 Installing dependencies..."
  (cd qarz-backend && npm ci --omit=dev)
  (cd qarz-bot && npm ci --omit=dev)
  # The web build needs its devDependencies (vite).
  (cd qarz-web && npm ci && npm run build)

  echo "🗄️ Executing database migrations..."
  (cd qarz-backend && node src/db/migrate.js)

  echo "🔄 Reloading PM2 processes..."
  # Starts anything in the ecosystem file that is not running yet (first
  # deploy) and reloads the rest.
  pm2 startOrReload ecosystem.config.cjs --update-env
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
