/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function scalar(db, sql) {
  const row = db.prepare(sql).get();
  const keys = row ? Object.keys(row) : [];
  return keys.length ? row[keys[0]] : undefined;
}

function hasColumn(db, tableName, columnName) {
  const count = scalar(db, `SELECT COUNT(*) AS c FROM pragma_table_info('${tableName}') WHERE name='${columnName}';`);
  return Number(count) > 0;
}

function execFile(db, filePath) {
  db.exec(readText(filePath));
}

const DEV_TEST_PASSWORD_HASH = "$2a$12$CBpEnaQBlvvAY/Z.kqa/JOCAawr.Hdn48.x44Vae4DuyEklXWm0ea";

function resolveUniqueUserName(db, preferredName) {
  const existingByName = db.prepare('SELECT id FROM "User" WHERE lower("name") = lower(?) LIMIT 1;').get(preferredName);
  if (!existingByName) return preferredName;

  let suffix = 1;
  while (suffix < 10_000) {
    const candidate = `${preferredName}-seed${suffix}`;
    const collision = db.prepare('SELECT id FROM "User" WHERE lower("name") = lower(?) LIMIT 1;').get(candidate);
    if (!collision) return candidate;
    suffix += 1;
  }
  throw new Error(`Could not find unique seed name for ${preferredName}`);
}

function ensureSeedUser(db, { id, preferredName, role }) {
  const existingById = db.prepare('SELECT id FROM "User" WHERE "id" = ? LIMIT 1;').get(id);
  if (existingById) return;

  const name = resolveUniqueUserName(db, preferredName);
  const email = `${name.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}@local.admin`;
  db.prepare('INSERT INTO "User" ("id","name","email","passwordHash","mustChangePassword","role") VALUES (?,?,?,?,?,?)').run(
    id,
    name,
    email,
    DEV_TEST_PASSWORD_HASH,
    0,
    role
  );
}

function initDb(db) {
  // Base schema (idempotent).
  execFile(db, path.join("scripts", "init-sqlite.sql"));

  // Lightweight migrations previously handled in `scripts/init-sqlite.sh`.
  if (!hasColumn(db, "Session", "broadcastCodeHash")) {
    db.exec('ALTER TABLE "Session" ADD COLUMN "broadcastCodeHash" TEXT;');
  }
  if (!hasColumn(db, "Session", "broadcastCode")) {
    db.exec('ALTER TABLE "Session" ADD COLUMN "broadcastCode" TEXT;');
  }
  if (!hasColumn(db, "Session", "description")) {
    db.exec('ALTER TABLE "Session" ADD COLUMN "description" TEXT;');
  }
  if (!hasColumn(db, "Session", "imageUrl")) {
    db.exec('ALTER TABLE "Session" ADD COLUMN "imageUrl" TEXT;');
  }
  if (!hasColumn(db, "User", "name")) {
    db.exec('ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT \'\';');
  }
  if (!hasColumn(db, "User", "passwordHash")) {
    db.exec('ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT \'\';');
  }
  if (!hasColumn(db, "User", "mustChangePassword")) {
    db.exec('ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT 0;');
  }

  db.exec('UPDATE "User" SET "name" = "email" WHERE ("name" IS NULL OR "name" = \'\') AND "email" IS NOT NULL;');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS "User_name_key" ON "User"("name");');

  // If `User` table constraint doesn't include VIEWER (older schema), rebuild it.
  const userRoleConstraintHasViewer = scalar(
    db,
    "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='User' AND sql LIKE '%VIEWER%') THEN 1 ELSE 0 END AS ok;"
  );
  if (Number(userRoleConstraintHasViewer) === 0) {
    db.exec('ALTER TABLE "User" RENAME TO "User_old";');
    db.exec(`CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL UNIQUE,
      "email" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "mustChangePassword" BOOLEAN NOT NULL DEFAULT 0,
      "role" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ("role" IN ('BROADCASTER','VIEWER','ADMIN'))
    );`);
    db.exec(`INSERT INTO "User" ("id","name","email","passwordHash","mustChangePassword","role","createdAt")
      SELECT
        "id",
        CASE WHEN "name" IS NULL OR "name" = '' THEN "email" ELSE "name" END,
        "email",
        CASE WHEN "passwordHash" IS NULL THEN '' ELSE "passwordHash" END,
        0,
        CASE WHEN "role" = "LISTENER" THEN "VIEWER" ELSE "role" END,
        "createdAt"
      FROM "User_old";`);
    db.exec('DROP TABLE "User_old";');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS "User_name_key" ON "User"("name");');
  }

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS "Session_broadcastCode_key" ON "Session"("broadcastCode");');
  db.exec('REINDEX "Session_broadcastCode_key";');

  // Ensure extra tables exist (idempotent).
  db.exec(`CREATE TABLE IF NOT EXISTS "SessionUserAccess" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS "SessionUserAccess_sessionId_userId_key" ON "SessionUserAccess"("sessionId", "userId");');
  db.exec('CREATE INDEX IF NOT EXISTS "SessionUserAccess_userId_sessionId_idx" ON "SessionUserAccess"("userId", "sessionId");');
  db.exec('CREATE TABLE IF NOT EXISTS "AppConfig" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);');
}

function seedDb(db) {
  // Keep fixed seed user IDs available even if a same-name user already exists.
  ensureSeedUser(db, { id: "dev-user-admin", preferredName: "admin", role: "ADMIN" });
  ensureSeedUser(db, { id: "dev-user-technik", preferredName: "technik", role: "BROADCASTER" });
  ensureSeedUser(db, { id: "dev-user-regie", preferredName: "regie", role: "BROADCASTER" });
  ensureSeedUser(db, { id: "dev-user-media", preferredName: "media", role: "VIEWER" });
  ensureSeedUser(db, { id: "dev-user-gast", preferredName: "gast", role: "VIEWER" });
  execFile(db, path.join("scripts", "seed-dev.sql"));
}

function main() {
  const dbPath = path.join("prisma", "dev.db");
  ensureDir(path.dirname(dbPath));

  const db = new DatabaseSync(dbPath);
  try {
    // Best-effort safety.
    db.exec("PRAGMA foreign_keys = ON;");
    initDb(db);
    seedDb(db);
  } finally {
    db.close();
  }

  console.log(`SQLite dev DB initialized: ${dbPath}`);
}

main();
