#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# TemirDaftar Production Deployment Script
# Usage: ./deploy/deploy.sh
# ============================================================

echo "🚀 Starting TemirDaftar Deployment..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo "❌ Error: .env file missing in $ROOT_DIR. Please copy .env.production.example to .env and configure secrets."
  exit 1
fi

echo "📥 Pulling latest updates from git repository..."
git config --global --add safe.directory "$ROOT_DIR" 2>/dev/null || true
git pull origin main

echo "🐳 Building and starting Docker containers..."
docker compose up -d --build

echo "🗄️ Executing database migrations..."
docker compose run --rm backend node src/db/migrate.js

echo "📊 Checking service statuses..."
docker compose ps 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  echo "🔄 Restarting PM2 processes..."
  pm2 restart all 2>/dev/null || true
fi

echo "✅ Deployment completed successfully! All services are running."
