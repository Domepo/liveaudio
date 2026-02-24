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

sqlite3 "$DB_PATH" 'CREATE TABLE IF NOT EXISTS "SessionUserAccess" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);'
sqlite3 "$DB_PATH" 'CREATE UNIQUE INDEX IF NOT EXISTS "SessionUserAccess_sessionId_userId_key" ON "SessionUserAccess"("sessionId", "userId");'
sqlite3 "$DB_PATH" 'CREATE INDEX IF NOT EXISTS "SessionUserAccess_userId_sessionId_idx" ON "SessionUserAccess"("userId", "sessionId");'

sqlite3 "$DB_PATH" 'CREATE TABLE IF NOT EXISTS "AppConfig" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);'

# Dev seed data (idempotent): 5 users + 10 sessions with images.
sqlite3 "$DB_PATH" '
INSERT OR IGNORE INTO "User" ("id","name","email","passwordHash","role") VALUES
  ("dev-user-admin","admin","admin@local.admin","$2a$12$pPes64LgxM.Rss9WMrTud.g7YD7zUNf3L8avQcjLlPy.WLLHw48iu","ADMIN"),
  ("dev-user-technik","technik","technik@local.admin","$2a$12$yenMgHq0OaeqCPc3JNXKMeArlP/zbGGEnqKu2Db6vAtgAxuWKiMVa","BROADCASTER"),
  ("dev-user-regie","regie","regie@local.admin","$2a$12$Yu2QA9YFgDyXhJNtO6W5B.MI6Xa2RvkFdL7AyYOU7ByrhpPb.BORa","BROADCASTER"),
  ("dev-user-media","media","media@local.admin","$2a$12$wc47hqze/dR9u6DaL0idFuC7AXp9I.l0ch5ZT5/jHjSic0etYNaPO","VIEWER"),
  ("dev-user-gast","gast","gast@local.admin","$2a$12$YSiqGODsStO/UIAfhDX9NudEXiC4pPtdeiIERCER15Y2Z2LKvgq56","VIEWER");
'

sqlite3 "$DB_PATH" '
INSERT OR IGNORE INTO "Session" ("id","name","description","imageUrl","broadcastCode","status","createdByUserId") VALUES
  ("dev-session-01","Sonntag 09:30","Hauptgottesdienst - Vormittag","https://picsum.photos/seed/liveaudio-01/1200/600","100001","ACTIVE","dev-user-admin"),
  ("dev-session-02","Sonntag 11:00","Predigt + Lobpreis","https://picsum.photos/seed/liveaudio-02/1200/600","100002","ACTIVE","dev-user-admin"),
  ("dev-session-03","Jugendabend","Jugendtreff mit Worship","https://picsum.photos/seed/liveaudio-03/1200/600","100003","ACTIVE","dev-user-admin"),
  ("dev-session-04","Bibelstunde","Mittwoch Bibelstunde","https://picsum.photos/seed/liveaudio-04/1200/600","100004","ACTIVE","dev-user-admin"),
  ("dev-session-05","Gebetsabend","Gemeinsames Gebet","https://picsum.photos/seed/liveaudio-05/1200/600","100005","ACTIVE","dev-user-admin"),
  ("dev-session-06","Taufgottesdienst","Sondergottesdienst mit Taufe","https://picsum.photos/seed/liveaudio-06/1200/600","100006","ACTIVE","dev-user-admin"),
  ("dev-session-07","Lobpreisnacht","Abendveranstaltung","https://picsum.photos/seed/liveaudio-07/1200/600","100007","ACTIVE","dev-user-admin"),
  ("dev-session-08","Hauskreis","Kleingruppe Nord","https://picsum.photos/seed/liveaudio-08/1200/600","100008","ACTIVE","dev-user-admin"),
  ("dev-session-09","Seminar","Lehrabend","https://picsum.photos/seed/liveaudio-09/1200/600","100009","ACTIVE","dev-user-admin"),
  ("dev-session-10","Weihnachtsprobe","Musikteam Probe","https://picsum.photos/seed/liveaudio-10/1200/600","100010","ACTIVE","dev-user-admin");
'

sqlite3 "$DB_PATH" '
INSERT OR IGNORE INTO "SessionUserAccess" ("id","sessionId","userId") VALUES
  ("dev-access-01","dev-session-01","dev-user-technik"),
  ("dev-access-02","dev-session-02","dev-user-technik"),
  ("dev-access-03","dev-session-03","dev-user-technik"),
  ("dev-access-04","dev-session-04","dev-user-technik"),
  ("dev-access-05","dev-session-05","dev-user-technik"),
  ("dev-access-06","dev-session-06","dev-user-regie"),
  ("dev-access-07","dev-session-07","dev-user-regie"),
  ("dev-access-08","dev-session-08","dev-user-regie"),
  ("dev-access-09","dev-session-09","dev-user-regie"),
  ("dev-access-10","dev-session-10","dev-user-regie"),
  ("dev-access-11","dev-session-01","dev-user-admin"),
  ("dev-access-12","dev-session-02","dev-user-admin"),
  ("dev-access-13","dev-session-03","dev-user-admin"),
  ("dev-access-14","dev-session-04","dev-user-admin"),
  ("dev-access-15","dev-session-05","dev-user-admin"),
  ("dev-access-16","dev-session-06","dev-user-admin"),
  ("dev-access-17","dev-session-07","dev-user-admin"),
  ("dev-access-18","dev-session-08","dev-user-admin"),
  ("dev-access-19","dev-session-09","dev-user-admin"),
  ("dev-access-20","dev-session-10","dev-user-admin");
'
