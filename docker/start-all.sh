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
exec npx concurrently -n MEDIA,API,WEB -c blue,green,magenta \
  "npm run dev:media" \
  "npm run dev:api" \
  "npm run dev:web"
