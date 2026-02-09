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

HAS_BROADCAST_CODE_PLAIN=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='broadcastCode';")
if [ "$HAS_BROADCAST_CODE_PLAIN" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "Session" ADD COLUMN "broadcastCode" TEXT;'
fi

HAS_SESSION_DESCRIPTION=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='description';")
if [ "$HAS_SESSION_DESCRIPTION" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "Session" ADD COLUMN "description" TEXT;'
fi

HAS_SESSION_IMAGE_URL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='imageUrl';")
if [ "$HAS_SESSION_IMAGE_URL" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "Session" ADD COLUMN "imageUrl" TEXT;'
fi

HAS_USER_NAME=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('User') WHERE name='name';")
if [ "$HAS_USER_NAME" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT "";'
fi

HAS_USER_PASSWORD_HASH=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('User') WHERE name='passwordHash';")
if [ "$HAS_USER_PASSWORD_HASH" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT "";'
fi

sqlite3 "$DB_PATH" 'UPDATE "User" SET "name" = "email" WHERE ("name" IS NULL OR "name" = "") AND "email" IS NOT NULL;'
sqlite3 "$DB_PATH" 'CREATE UNIQUE INDEX IF NOT EXISTS "User_name_key" ON "User"("name");'

USER_ROLE_CONSTRAINT_HAS_VIEWER=$(sqlite3 "$DB_PATH" "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='User' AND sql LIKE '%VIEWER%') THEN 1 ELSE 0 END;")
if [ "$USER_ROLE_CONSTRAINT_HAS_VIEWER" = "0" ]; then
  sqlite3 "$DB_PATH" 'ALTER TABLE "User" RENAME TO "User_old";'
  sqlite3 "$DB_PATH" 'CREATE TABLE "User" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL UNIQUE,
    "email" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("role" IN ('\''BROADCASTER'\'','\''VIEWER'\'','\''ADMIN'\''))
  );'
  sqlite3 "$DB_PATH" 'INSERT INTO "User" ("id","name","email","passwordHash","role","createdAt")
    SELECT
      "id",
      CASE WHEN "name" IS NULL OR "name" = "" THEN "email" ELSE "name" END,
      "email",
      CASE WHEN "passwordHash" IS NULL THEN "" ELSE "passwordHash" END,
      CASE WHEN "role" = "LISTENER" THEN "VIEWER" ELSE "role" END,
      "createdAt"
    FROM "User_old";'
  sqlite3 "$DB_PATH" 'DROP TABLE "User_old";'
  sqlite3 "$DB_PATH" 'CREATE UNIQUE INDEX IF NOT EXISTS "User_name_key" ON "User"("name");'
fi

sqlite3 "$DB_PATH" 'CREATE UNIQUE INDEX IF NOT EXISTS "Session_broadcastCode_key" ON "Session"("broadcastCode");'
sqlite3 "$DB_PATH" 'REINDEX "Session_broadcastCode_key";'

sqlite3 "$DB_PATH" 'CREATE TABLE IF NOT EXISTS "AppConfig" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);'
