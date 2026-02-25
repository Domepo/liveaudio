import "dotenv/config";
import http from "node:http";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import {
  adminLoginSchema,
  analyticsV2QuerySchema,
  changeAdminPasswordSchema,
  createAdminUserSchema,
  createChannelSchema,
  createPreShowTrackSchema,
  createJoinLinkSchema,
  createRecordingSchema,
  createSessionSchema,
  updateAdminUserSchema,
  updateAppLogoSchema,
  updateSessionSchema,
  updateSessionUserAccessSchema,
  validateCodeSchema
} from "./http/schemas";
import { buildJoinBaseUrl, detectLanIp } from "./lib/network";
import { RECORDINGS_ROOT, ensureChannelRecordingsDir, listSessionRecordings, pruneChannelRecordings, safeRecordingName, transcodeWebmToMp3 } from "./lib/recordings";
import { createAdminCore } from "./services/admin-core";
import { bootstrapTimescaleIfAvailable as bootstrapTimescaleIfAvailableRaw } from "./services/analytics-record";
import { createDebugTestManager } from "./services/debug-tests";
import { createTestToneWatchdogStore } from "./services/testtone-watchdog";
import { registerRuntime } from "./app/register-runtime";
import {
  addSocketToRoleMap,
  attempts,
  broadcastOwnerBySession,
  broadcasterSocketsBySession,
  changeLiveListenerCount,
  clearBroadcastOwner,
  clearSessionAnalyticsState,
  getBroadcastOwner,
  getSessionLiveMode,
  getLiveListenerChannelCounts,
  getLiveListenerTotal,
  isListenerAuth,
  listenerSocketsBySession,
  listenerStateBySocket,
  liveListenerCountsBySessionChannel,
  recordLiveSnapshot,
  removeSocketFromRoleMap,
  setBroadcastOwner,
  setSessionLiveMode,
  clearSessionLiveMode,
  sessionLiveSeries
} from "./realtime/state";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const API_PORT = Number(process.env.API_PORT ?? 3001);
const API_HOST = process.env.API_HOST ?? "0.0.0.0";
const API_JSON_LIMIT = process.env.API_JSON_LIMIT ?? "25mb";
const IS_TEST_ENV = process.env.NODE_ENV === "test";
const IS_PROD_ENV = process.env.NODE_ENV === "production";
const IS_DOCKER_ENV = process.env.RUNNING_IN_DOCKER === "1" || existsSync("/.dockerenv");
const CAN_ENABLE_DEBUG_MODE = !IS_PROD_ENV && !IS_DOCKER_ENV;
const JWT_SECRET = process.env.JWT_SECRET ?? (IS_PROD_ENV ? "" : "dev-secret");
const JWT_ISSUER = process.env.JWT_ISSUER?.trim() || "liveaudio-api";
const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_TTL_HOURS = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12);
const ADMIN_SESSION_REFRESH_THRESHOLD_MINUTES = Number(process.env.ADMIN_SESSION_REFRESH_THRESHOLD_MINUTES ?? 60);
const ADMIN_WS_TOKEN_TTL_MINUTES = Number(process.env.ADMIN_WS_TOKEN_TTL_MINUTES ?? 24 * 60);
const ADMIN_LOGIN_NAME = process.env.ADMIN_LOGIN_NAME ?? (IS_PROD_ENV ? "" : "admin");
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? (IS_PROD_ENV ? "" : "$2a$12$CBpEnaQBlvvAY/Z.kqa/JOCAawr.Hdn48.x44Vae4DuyEklXWm0ea");
const ADMIN_LOGIN_NAME_CONFIG_KEY = "ADMIN_LOGIN_NAME";
const ADMIN_PASSWORD_CONFIG_KEY = "ADMIN_PASSWORD_HASH";
const APP_LOGO_CONFIG_KEY = "APP_LOGO_DATA_URL";
const DEFAULT_APP_LOGO_URL = "/logo.png";
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL ?? "http://localhost:4000";
const MEDIA_INTERNAL_TOKEN = process.env.MEDIA_INTERNAL_TOKEN?.trim() || "";
const SESSION_STATS_SINCE_PREFIX = "SESSION_STATS_SINCE:";
const ANALYTICS_RAW_RETENTION_DAYS = Number(process.env.ANALYTICS_RAW_RETENTION_DAYS ?? 400);
const ANALYTICS_MAX_COMPARE_SESSIONS = 4;
const DEBUG_MODE_FROM_ENV = CAN_ENABLE_DEBUG_MODE && (process.env.DEBUG_MODE === "1" || process.env.DEBUG_MODE === "true");
const DEBUG_MODE_CONFIG_KEY = "DEBUG_MODE_ENABLED";
let runtimeDebugMode = DEBUG_MODE_FROM_ENV;
const API_ORIGIN = process.env.DEBUG_TEST_API_ORIGIN ?? `http://127.0.0.1:${API_PORT}`;
const debugTestManager = createDebugTestManager();
const testToneWatchdogStore = createTestToneWatchdogStore();

function parseTrustProxy(value: string | undefined): boolean | number | string | string[] {
  if (typeof value !== "string" || !value.trim()) return false;
  const raw = value.trim();
  const lower = raw.toLowerCase();
  if (lower === "false" || lower === "0" || lower === "off") return false;
  if (lower === "true" || lower === "1" || lower === "on") return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length <= 1 ? raw : parts;
}

function assertProductionSecurityConfig(): void {
  if (!IS_PROD_ENV) return;
  const errors: string[] = [];
  if (!JWT_SECRET || JWT_SECRET.length < 32 || ["dev-secret", "change-me"].includes(JWT_SECRET)) {
    errors.push("JWT_SECRET is missing/weak. Set a random secret with at least 32 chars.");
  }
  if (!ADMIN_LOGIN_NAME.trim()) {
    errors.push("ADMIN_LOGIN_NAME is required in production.");
  }
  if (!ADMIN_PASSWORD_HASH.trim()) {
    errors.push("ADMIN_PASSWORD_HASH is required in production.");
  }
  if (!MEDIA_INTERNAL_TOKEN || MEDIA_INTERNAL_TOKEN.length < 24) {
    errors.push("MEDIA_INTERNAL_TOKEN is missing/weak. Set a random token with at least 24 chars.");
  }
  if (errors.length) {
    for (const error of errors) {
      // eslint-disable-next-line no-console
      console.error(`[SECURITY] ${error}`);
    }
    process.exit(1);
  }
}

assertProductionSecurityConfig();

if (IS_DOCKER_ENV && (process.env.DEBUG_MODE === "1" || process.env.DEBUG_MODE === "true")) {
  // eslint-disable-next-line no-console
  console.warn("[DEBUG] DEBUG_MODE env is ignored in Docker. Debug mode is only available for local npm run dev.");
}

app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: API_JSON_LIMIT }));
app.use(morgan("combined"));
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/api" || req.path === "/health") return next();
  const remapRoots = ["/admin", "/login", "/sessions", "/join", "/network", "/public"];
  if (remapRoots.some((root) => req.path === root || req.path.startsWith(`${root}/`))) req.url = `/api${req.url}`;
  next();
});

const joinLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const liveStateLimiter = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false });
const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: Number(process.env.ADMIN_LOGIN_MAX_ATTEMPTS ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Zu viele Login-Versuche. Bitte kurz warten und erneut versuchen." },
  keyGenerator: (req) => {
    const body = req.body as { name?: unknown } | undefined;
    const name = typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
    return `${req.ip}:${name || "anon"}`;
  }
});

const adminCore = createAdminCore({
  prisma,
  JWT_SECRET,
  JWT_ISSUER,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_HOURS,
  ADMIN_SESSION_REFRESH_THRESHOLD_MINUTES,
  ADMIN_LOGIN_NAME,
  ADMIN_PASSWORD_HASH,
  ADMIN_LOGIN_NAME_CONFIG_KEY,
  ADMIN_PASSWORD_CONFIG_KEY,
  APP_LOGO_CONFIG_KEY,
  DEFAULT_APP_LOGO_URL
});

const runtime = registerRuntime({
  app,
  io,
  prisma,
  IS_TEST_ENV,
  JWT_SECRET,
  JWT_ISSUER,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_HOURS,
  ADMIN_WS_TOKEN_TTL_MINUTES,
  ADMIN_PASSWORD_CONFIG_KEY,
  APP_LOGO_CONFIG_KEY,
  DEFAULT_APP_LOGO_URL,
  MEDIA_BASE_URL,
  MEDIA_INTERNAL_TOKEN,
  SESSION_STATS_SINCE_PREFIX,
  ANALYTICS_RAW_RETENTION_DAYS,
  ANALYTICS_MAX_COMPARE_SESSIONS,
  getDebugMode: () => runtimeDebugMode,
  canToggleDebugMode: CAN_ENABLE_DEBUG_MODE,
  setDebugMode: async (enabled: boolean) => {
    if (!CAN_ENABLE_DEBUG_MODE) {
      runtimeDebugMode = false;
      return runtimeDebugMode;
    }
    runtimeDebugMode = enabled;
    await prisma.appConfig.upsert({
      where: { key: DEBUG_MODE_CONFIG_KEY },
      create: { key: DEBUG_MODE_CONFIG_KEY, value: enabled ? "1" : "0" },
      update: { value: enabled ? "1" : "0" }
    });
    return runtimeDebugMode;
  },
  API_ORIGIN,
  debugTestManager,
  testToneWatchdogStore,
  detectLanIp,
  detectLanIpFn: detectLanIp,
  buildJoinBaseUrl,
  validateCodeSchema,
  adminLoginSchema,
  changeAdminPasswordSchema,
  updateAppLogoSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
  updateSessionUserAccessSchema,
  createRecordingSchema,
  createPreShowTrackSchema,
  createSessionSchema,
  updateSessionSchema,
  createChannelSchema,
  createJoinLinkSchema,
  analyticsV2QuerySchema,
  joinLimiter,
  liveStateLimiter,
  adminLoginLimiter,
  attempts,
  broadcastOwnerBySession,
  listenerSocketsBySession,
  broadcasterSocketsBySession,
  listenerStateBySocket,
  liveListenerCountsBySessionChannel,
  sessionLiveSeries,
  getLiveListenerChannelCounts,
  getLiveListenerTotal,
  isListenerAuth,
  addSocketToRoleMap,
  removeSocketFromRoleMap,
  changeLiveListenerCount,
  recordLiveSnapshot,
  getBroadcastOwner,
  getSessionLiveMode,
  setSessionLiveMode,
  clearSessionLiveMode,
  setBroadcastOwner,
  clearBroadcastOwner,
  clearSessionAnalyticsState,
  adminCore,
  RECORDINGS_ROOT,
  ensureChannelRecordingsDir,
  listSessionRecordings,
  pruneChannelRecordings,
  safeRecordingName,
  transcodeWebmToMp3,
  bootstrapTimescaleIfAvailable: bootstrapTimescaleIfAvailableRaw
});

async function startServer(): Promise<void> {
  if (CAN_ENABLE_DEBUG_MODE) {
    const debugConfig = await prisma.appConfig.findUnique({ where: { key: DEBUG_MODE_CONFIG_KEY }, select: { value: true } });
    if (debugConfig?.value === "1" || debugConfig?.value === "true") runtimeDebugMode = true;
    if (debugConfig?.value === "0" || debugConfig?.value === "false") runtimeDebugMode = false;
  } else {
    runtimeDebugMode = false;
  }
  await runtime.bootstrapTimescaleIfAvailable();
  server.listen(API_PORT, API_HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`API listening on ${API_HOST}:${API_PORT}`);
  });
}

if (!IS_TEST_ENV) void startServer();

export { app, server, prisma, startServer };
