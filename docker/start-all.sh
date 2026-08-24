#!/usr/bin/env sh
set -eu

echo "[app] Waiting for postgres at ${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}..."
until PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" pg_isready \
  -h "${POSTGRES_HOST:-postgres}" \
  -p "${POSTGRES_PORT:-5432}" \
  -U "${POSTGRES_USER:-postgres}" \
  -d "${POSTGRES_DB:-livevoice}" \
  >/dev/null 2>&1; do
  sleep 2
done

echo "[app] Postgres is ready"
echo "[app] Applying prisma schema (db push)..."
npx prisma db push --schema=/app/prisma/schema.postgres.prisma

echo "[app] Starting MEDIA/API/WEB..."
exec npx concurrently --kill-others -n MEDIA,API,WEB,WATCHDOG -c blue,green,magenta,yellow \
  "npm run start -w @livevoice/media" \
  "npm run start -w @livevoice/api" \
  "node /app/docker/serve-web.cjs" \
  "node /app/docker/watchdog.cjs"
