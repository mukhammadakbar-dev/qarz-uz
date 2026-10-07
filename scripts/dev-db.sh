#!/usr/bin/env bash
# Lokal dev Postgres 16 (FAQAT dev, ADR-0001). Ishlatish: scripts/dev-db.sh [up|down|reset|psql]
set -euo pipefail

NAME=nasiya-postgres
PORT=${NASIYA_DB_PORT:-55432}
VOLUME=nasiya-pgdata
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

up() {
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    docker start "$NAME" >/dev/null
  else
    docker run -d --name "$NAME" --restart unless-stopped \
      -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
      -p "127.0.0.1:${PORT}:5432" \
      -v "${VOLUME}:/var/lib/postgresql/data" \
      -v "${HERE}/deploy/db/dev-init.sql:/docker-entrypoint-initdb.d/01-dev-init.sql:ro" \
      postgres:16-alpine >/dev/null
  fi
  for _ in $(seq 1 40); do
    if docker exec "$NAME" pg_isready -U postgres -d nasiya_test >/dev/null 2>&1; then
      echo "Postgres tayyor: postgres://nasiya_app:nasiya_app@localhost:${PORT}/nasiya"
      return 0
    fi
    sleep 1
  done
  echo "Postgres ishga tushmadi" >&2
  exit 1
}

case "${1:-up}" in
  up) up ;;
  down) docker stop "$NAME" >/dev/null && echo "to'xtatildi" ;;
  reset)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true
    up
    ;;
  psql) shift; docker exec -it "$NAME" psql -U postgres "${@:-nasiya}" ;;
  *) echo "Foydalanish: $0 [up|down|reset|psql]" >&2; exit 2 ;;
esac
