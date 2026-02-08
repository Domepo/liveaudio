#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="$ROOT_DIR/prisma/dev.db"
SQL_PATH="$ROOT_DIR/scripts/init-sqlite.sql"

sqlite3 "$DB_PATH" < "$SQL_PATH"

HAS_BROADCAST_CODE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='broadcastCodeHash';")
if [ "$HAS_BROADCAST_CODE" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "Session" ADD COLUMN "broadcastCodeHash" TEXT;'
fi

HAS_SESSION_DESCRIPTION=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='description';")
if [ "$HAS_SESSION_DESCRIPTION" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "Session" ADD COLUMN "description" TEXT;'
fi

HAS_SESSION_IMAGE_URL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='imageUrl';")
if [ "$HAS_SESSION_IMAGE_URL" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "Session" ADD COLUMN "imageUrl" TEXT;'
fi
