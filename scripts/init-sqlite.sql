PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT 0,
  "role" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("role" IN ('BROADCASTER','VIEWER','ADMIN'))
);

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "broadcastCode" TEXT,
  "broadcastCodeHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("status" IN ('ACTIVE','ENDED')),
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Session_status_createdAt_idx" ON "Session"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_broadcastCode_key" ON "Session"("broadcastCode");

CREATE TABLE IF NOT EXISTS "Channel" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "languageCode" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Channel_sessionId_name_key" ON "Channel"("sessionId", "name");
CREATE INDEX IF NOT EXISTS "Channel_sessionId_isActive_idx" ON "Channel"("sessionId", "isActive");

CREATE TABLE IF NOT EXISTS "SessionUserAccess" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionUserAccess_sessionId_userId_key" ON "SessionUserAccess"("sessionId", "userId");
CREATE INDEX IF NOT EXISTS "SessionUserAccess_userId_sessionId_idx" ON "SessionUserAccess"("userId", "sessionId");

CREATE TABLE IF NOT EXISTS "JoinToken" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL,
  "channelId" TEXT,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "pinHash" TEXT NOT NULL,
  "pinLast4" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "rotates" BOOLEAN NOT NULL DEFAULT 0,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "JoinToken_sessionId_expiresAt_idx" ON "JoinToken"("sessionId", "expiresAt");
CREATE INDEX IF NOT EXISTS "JoinToken_channelId_expiresAt_idx" ON "JoinToken"("channelId", "expiresAt");
CREATE INDEX IF NOT EXISTS "JoinToken_revokedAt_idx" ON "JoinToken"("revokedAt");

CREATE TABLE IF NOT EXISTS "AccessLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL,
  "channelId" TEXT,
  "joinTokenId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "eventType" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("joinTokenId") REFERENCES "JoinToken"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AccessLog_sessionId_createdAt_idx" ON "AccessLog"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AccessLog_ip_createdAt_idx" ON "AccessLog"("ip", "createdAt");

CREATE TABLE IF NOT EXISTS "AnalyticsPoint" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "sessionId" TEXT NOT NULL,
  "channelId" TEXT,
  "metric" TEXT NOT NULL,
  "value" REAL NOT NULL,
  "ts" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AnalyticsPoint_sessionId_ts_idx" ON "AnalyticsPoint"("sessionId", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsPoint_metric_ts_idx" ON "AnalyticsPoint"("metric", "ts");
CREATE INDEX IF NOT EXISTS "AnalyticsPoint_channelId_ts_idx" ON "AnalyticsPoint"("channelId", "ts");

CREATE TABLE IF NOT EXISTS "AppConfig" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "SessionTemplate" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "imageUrl" TEXT,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SessionTemplate_createdAt_idx" ON "SessionTemplate"("createdAt");

CREATE TABLE IF NOT EXISTS "TemplateChannel" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "templateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "languageCode" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("templateId") REFERENCES "SessionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TemplateChannel_templateId_orderIndex_idx" ON "TemplateChannel"("templateId","orderIndex");
