import "dotenv/config";
import http from "node:http";
import os from "node:os";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_HOST = process.env.API_HOST ?? "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? "$2a$12$CBpEnaQBlvvAY/Z.kqa/JOCAawr.Hdn48.x44Vae4DuyEklXWm0ea"; // "test"
const ADMIN_PASSWORD_CONFIG_KEY = "ADMIN_PASSWORD_HASH";
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL ?? "http://localhost:4000";

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(helmet());
app.use(express.json());
app.use(morgan("combined"));
app.set("trust proxy", true);

// Proxy-compat layer:
// Some reverse proxies forward "/api/foo" as "/foo".
// Remap known API roots so both variants work.
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/api" || req.path === "/health") {
    next();
    return;
  }

  const remapRoots = ["/admin", "/sessions", "/join", "/network", "/public"];
  const shouldRemap = remapRoots.some((root) => req.path === root || req.path.startsWith(`${root}/`));
  if (shouldRemap) {
    req.url = `/api${req.url}`;
  }

  next();
});

const joinLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

type AdminJwtPayload = {
  role: "ADMIN";
};

type ListenerSocketAuth = { role: "LISTENER"; sessionId: string };
type BroadcasterSocketAuth = { role: "BROADCASTER"; sessionId: string };
type SocketAuthPayload = ListenerSocketAuth | BroadcasterSocketAuth;

const attempts = new Map<string, { count: number; until: number }>();
const listenerSocketsBySession = new Map<string, Set<string>>();
const broadcasterSocketsBySession = new Map<string, Set<string>>();
const listenerStateBySocket = new Map<string, { sessionId: string; channelId?: string; joinedAt?: number }>();
const liveListenerCountsBySessionChannel = new Map<string, Map<string, number>>();
const sessionLiveSeries = new Map<string, Array<{ ts: number; total: number; channels: Record<string, number> }>>();
const MAX_LIVE_POINTS = 180;

function isListenerAuth(auth: SocketAuthPayload): auth is ListenerSocketAuth {
  return auth.role === "LISTENER";
}

function generateSessionCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function generateUniqueSessionCode(excludeSessionId?: string): Promise<string> {
  const legacyHashSessions = await prisma.session.findMany({
    where: { broadcastCode: null, broadcastCodeHash: { not: null } },
    select: { id: true, broadcastCodeHash: true }
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = generateSessionCode();
    const existing = await prisma.session.findFirst({
      where: {
        broadcastCode: candidate,
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {})
      },
      select: { id: true }
    });
    if (existing) continue;

    let collidesWithLegacyHash = false;
    for (const legacy of legacyHashSessions) {
      if (excludeSessionId && legacy.id === excludeSessionId) continue;
      if (!legacy.broadcastCodeHash) continue;
      if (await bcrypt.compare(candidate, legacy.broadcastCodeHash)) {
        collidesWithLegacyHash = true;
        break;
      }
    }
    if (!collidesWithLegacyHash) return candidate;
  }

  throw new Error("Could not generate a unique 6-digit token");
}

function detectLanIp(): string {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

function buildJoinBaseUrl(req: Request, override?: string): string {
  if (override) return override;
  if (process.env.PUBLIC_JOIN_URL) return process.env.PUBLIC_JOIN_URL;

  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = typeof protoHeader === "string" ? protoHeader.split(",")[0] : req.protocol || "http";
  const hostHeader = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost:3000";
  const hostname = hostHeader.split(",")[0].split(":")[0].trim() || "localhost";
  const webPort = process.env.PUBLIC_WEB_PORT ?? "5173";
  return `${proto}://${hostname}:${webPort}`;
}

function setAdminCookie(res: Response, token: string): void {
  res.cookie(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000
  });
}

function clearAdminCookie(res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const pairs = cookieHeader.split(";");
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const raw = parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE];
  if (!raw || typeof raw !== "string") {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(raw, JWT_SECRET) as AdminJwtPayload;
    if (payload.role !== "ADMIN") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Admin session invalid" });
  }
}

const createSessionSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(1_000_000).optional()
});
const createChannelSchema = z.object({ name: z.string().min(2).max(50), languageCode: z.string().max(8).optional() });
const adminLoginSchema = z.object({ password: z.string().min(1).max(200) });
const changeAdminPasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(6).max(200),
    confirmPassword: z.string().min(6).max(200)
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"]
  });
const createJoinLinkSchema = z.object({
  joinBaseUrl: z.string().url().optional(),
  token: z.string().regex(/^\d{6}$/)
});
const validateCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const updateSessionSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(2000).optional(),
  imageUrl: z.string().max(1_000_000).optional()
});

function addSocketToRoleMap(map: Map<string, Set<string>>, sessionId: string, socketId: string): void {
  const set = map.get(sessionId) ?? new Set<string>();
  set.add(socketId);
  map.set(sessionId, set);
}

function removeSocketFromRoleMap(map: Map<string, Set<string>>, sessionId: string, socketId: string): void {
  const set = map.get(sessionId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) map.delete(sessionId);
}

function changeLiveListenerCount(sessionId: string, channelId: string, delta: number): void {
  const channelMap = liveListenerCountsBySessionChannel.get(sessionId) ?? new Map<string, number>();
  const prev = channelMap.get(channelId) ?? 0;
  const next = Math.max(0, prev + delta);
  if (next <= 0) {
    channelMap.delete(channelId);
  } else {
    channelMap.set(channelId, next);
  }
  if (channelMap.size === 0) {
    liveListenerCountsBySessionChannel.delete(sessionId);
  } else {
    liveListenerCountsBySessionChannel.set(sessionId, channelMap);
  }
}

function getLiveListenerChannelCounts(sessionId: string): Record<string, number> {
  const channelMap = liveListenerCountsBySessionChannel.get(sessionId);
  if (!channelMap) return {};
  const out: Record<string, number> = {};
  for (const [channelId, count] of channelMap.entries()) {
    out[channelId] = count;
  }
  return out;
}

function getLiveListenerTotal(sessionId: string): number {
  const channelMap = liveListenerCountsBySessionChannel.get(sessionId);
  if (!channelMap) return 0;
  let total = 0;
  for (const count of channelMap.values()) total += count;
  return total;
}

function recordLiveSnapshot(sessionId: string): void {
  const history = sessionLiveSeries.get(sessionId) ?? [];
  const channels = getLiveListenerChannelCounts(sessionId);
  history.push({
    ts: Date.now(),
    total: Object.values(channels).reduce((sum, value) => sum + value, 0),
    channels
  });
  while (history.length > MAX_LIVE_POINTS) history.shift();
  sessionLiveSeries.set(sessionId, history);
}

function clearSessionAnalyticsState(sessionId: string): void {
  sessionLiveSeries.delete(sessionId);
  recordLiveSnapshot(sessionId);
}

async function getEffectiveAdminPasswordHash(): Promise<string> {
  const config = await prisma.appConfig.findUnique({
    where: { key: ADMIN_PASSWORD_CONFIG_KEY },
    select: { value: true }
  });
  return config?.value ?? ADMIN_PASSWORD_HASH;
}

async function fetchSessionStats(sessionId: string): Promise<{
  channelsTotal: number;
  channelsActive: number;
  listenersConnected: number;
  broadcastersConnected: number;
  joinEvents24h: number;
  activeProducerChannels: number;
}> {
  const [channelsTotal, channelsActive, joinEvents24h] = await Promise.all([
    prisma.channel.count({ where: { sessionId } }),
    prisma.channel.count({ where: { sessionId, isActive: true } }),
    prisma.accessLog.count({
      where: {
        sessionId,
        eventType: "LISTENER_CONSUME",
        success: true,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }
    })
  ]);

  let activeProducerChannels = 0;
  try {
    const response = await axios.get<{ activeProducerChannels: number }>(`${MEDIA_BASE_URL}/stats/session/${sessionId}`);
    activeProducerChannels = Number(response.data.activeProducerChannels ?? 0);
  } catch {
    activeProducerChannels = 0;
  }

  return {
    channelsTotal,
    channelsActive,
    listenersConnected: listenerSocketsBySession.get(sessionId)?.size ?? 0,
    broadcastersConnected: broadcasterSocketsBySession.get(sessionId)?.size ?? 0,
    joinEvents24h,
    activeProducerChannels
  };
}

async function fetchLiveChannelIds(sessionId: string): Promise<string[]> {
  try {
    const response = await axios.get<{ activeChannelIds?: string[] }>(`${MEDIA_BASE_URL}/stats/session/${sessionId}`);
    return Array.isArray(response.data.activeChannelIds) ? response.data.activeChannelIds : [];
  } catch {
    return [];
  }
}

function toCsvValue(value: string | number): string {
  if (typeof value === "number") return String(value);
  const escaped = value.replaceAll("\"", "\"\"");
  return `"${escaped}"`;
}

async function buildSessionAnalytics(sessionId: string): Promise<{
  live: {
    listenersPerChannel: Array<{ channelId: string; name: string; listeners: number }>;
    totalListeners: number;
    peakListeners: number;
    joinRatePerMin: number;
    leaveRatePerMin: number;
  };
  realtimeGraph: {
    points: Array<{ ts: number; total: number }>;
    perChannel: Array<{ channelId: string; name: string; points: Array<{ ts: number; listeners: number }> }>;
  };
  postSession: {
    averageListeningDurationSec: number;
    heatmap: Array<{ hour: number; joins: number }>;
    channelComparison: Array<{
      channelId: string;
      name: string;
      joins: number;
      leaves: number;
      averageListeningDurationSec: number;
      peakListeners: number;
    }>;
  };
}> {
  const channels = await prisma.channel.findMany({
    where: { sessionId, isActive: true },
    select: { id: true, name: true }
  });
  const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));

  const now = Date.now();
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const logs = await prisma.accessLog.findMany({
    where: {
      sessionId,
      createdAt: { gte: last24h },
      eventType: { in: ["LISTENER_JOIN", "LISTENER_LEAVE"] }
    },
    select: { channelId: true, eventType: true, createdAt: true, reason: true },
    orderBy: { createdAt: "asc" }
  });

  const liveCounts = getLiveListenerChannelCounts(sessionId);
  const listenersPerChannel = channels.map((channel) => ({
    channelId: channel.id,
    name: channel.name,
    listeners: liveCounts[channel.id] ?? 0
  }));
  const totalListeners = getLiveListenerTotal(sessionId);

  const history = (sessionLiveSeries.get(sessionId) ?? []).slice(-120);
  const peakListeners = history.reduce((max, point) => Math.max(max, point.total), totalListeners);

  const last10min = logs.filter((log) => log.createdAt.getTime() >= now - 10 * 60 * 1000);
  const joins10 = last10min.filter((log) => log.eventType === "LISTENER_JOIN").length;
  const leaves10 = last10min.filter((log) => log.eventType === "LISTENER_LEAVE").length;
  const joinRatePerMin = joins10 / 10;
  const leaveRatePerMin = leaves10 / 10;

  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour, joins: 0 }));
  for (const log of logs) {
    if (log.eventType !== "LISTENER_JOIN") continue;
    hourBuckets[log.createdAt.getHours()].joins += 1;
  }

  const durationsByChannel = new Map<string, number[]>();
  for (const log of logs) {
    if (log.eventType !== "LISTENER_LEAVE" || !log.channelId || !log.reason) continue;
    const match = /durationMs=(\d+)/.exec(log.reason);
    if (!match) continue;
    const durationSec = Number(match[1]) / 1000;
    const list = durationsByChannel.get(log.channelId) ?? [];
    list.push(durationSec);
    durationsByChannel.set(log.channelId, list);
  }

  const allDurations = Array.from(durationsByChannel.values()).flat();
  const averageListeningDurationSec =
    allDurations.length > 0 ? allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length : 0;

  const joinsByChannel = new Map<string, number>();
  const leavesByChannel = new Map<string, number>();
  for (const log of logs) {
    if (!log.channelId) continue;
    if (log.eventType === "LISTENER_JOIN") {
      joinsByChannel.set(log.channelId, (joinsByChannel.get(log.channelId) ?? 0) + 1);
    } else if (log.eventType === "LISTENER_LEAVE") {
      leavesByChannel.set(log.channelId, (leavesByChannel.get(log.channelId) ?? 0) + 1);
    }
  }

  const peakByChannel = new Map<string, number>();
  for (const point of history) {
    for (const [channelId, value] of Object.entries(point.channels)) {
      peakByChannel.set(channelId, Math.max(peakByChannel.get(channelId) ?? 0, value));
    }
  }

  const channelComparison = channels.map((channel) => {
    const durations = durationsByChannel.get(channel.id) ?? [];
    const average = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    return {
      channelId: channel.id,
      name: channel.name,
      joins: joinsByChannel.get(channel.id) ?? 0,
      leaves: leavesByChannel.get(channel.id) ?? 0,
      averageListeningDurationSec: average,
      peakListeners: peakByChannel.get(channel.id) ?? 0
    };
  });

  const perChannelSeries = channels.map((channel) => ({
    channelId: channel.id,
    name: channel.name,
    points: history.map((point) => ({ ts: point.ts, listeners: point.channels[channel.id] ?? 0 }))
  }));

  return {
    live: {
      listenersPerChannel,
      totalListeners,
      peakListeners,
      joinRatePerMin,
      leaveRatePerMin
    },
    realtimeGraph: {
      points: history.map((point) => ({ ts: point.ts, total: point.total })),
      perChannel: perChannelSeries
    },
    postSession: {
      averageListeningDurationSec,
      heatmap: hourBuckets,
      channelComparison
    }
  };
}

async function findActiveSessionByCode(code: string) {
  const direct = await prisma.session.findFirst({
    where: { status: "ACTIVE", broadcastCode: code },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      status: true,
      broadcastCode: true,
      broadcastCodeHash: true
    }
  });
  if (direct) return direct;

  const legacy = await prisma.session.findMany({
    where: { status: "ACTIVE", broadcastCode: null, broadcastCodeHash: { not: null } },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      status: true,
      broadcastCode: true,
      broadcastCodeHash: true
    }
  });
  for (const session of legacy) {
    if (!session.broadcastCodeHash) continue;
    if (await bcrypt.compare(code, session.broadcastCodeHash)) {
      return session;
    }
  }
  return null;
}

app.get("/health", async (_req, res) => {
  const sessions = await prisma.session.count({ where: { status: "ACTIVE" } });
  const channels = await prisma.channel.count({ where: { isActive: true } });
  res.json({ ok: true, sessions, channels });
});

setInterval(() => {
  const sessionIds = new Set<string>([
    ...Array.from(listenerSocketsBySession.keys()),
    ...Array.from(liveListenerCountsBySessionChannel.keys())
  ]);
  for (const sessionId of sessionIds) {
    recordLiveSnapshot(sessionId);
  }
}, 5000);

app.get("/api/network", (req, res) => {
  const reqHost = req.get("host") ?? "";
  const reqHostname = reqHost.split(":")[0] || "localhost";
  const lanIp = detectLanIp();
  const suggestedJoinBaseUrl = `http://${lanIp}:${process.env.PUBLIC_WEB_PORT ?? "5173"}`;
  const currentHostJoinBaseUrl = `http://${reqHostname}:${process.env.PUBLIC_WEB_PORT ?? "5173"}`;
  res.json({ lanIp, suggestedJoinBaseUrl, currentHostJoinBaseUrl });
});

app.get("/api/public/sessions/:sessionId", async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  const channels = await prisma.channel.findMany({
    where: { sessionId, isActive: true },
    orderBy: { createdAt: "asc" }
  });

  return res.json({
    session: { id: session.id, name: session.name, description: session.description, imageUrl: session.imageUrl },
    channels
  });
});

app.post("/api/admin/login", adminLoginLimiter, async (req, res) => {
  const parsed = adminLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const effectiveHash = await getEffectiveAdminPasswordHash();
  const ok = await bcrypt.compare(parsed.data.password, effectiveHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid admin password" });
  }

  const token = jwt.sign({ role: "ADMIN" } satisfies AdminJwtPayload, JWT_SECRET, { expiresIn: "12h" });
  setAdminCookie(res, token);
  return res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  clearAdminCookie(res);
  return res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (_req, res) => {
  return res.json({ authenticated: true });
});

app.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  const parsed = changeAdminPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const effectiveHash = await getEffectiveAdminPasswordHash();
  const currentOk = await bcrypt.compare(parsed.data.currentPassword, effectiveHash);
  if (!currentOk) {
    return res.status(401).json({ error: "Current password is invalid" });
  }

  const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.appConfig.upsert({
    where: { key: ADMIN_PASSWORD_CONFIG_KEY },
    create: { key: ADMIN_PASSWORD_CONFIG_KEY, value: newHash },
    update: { value: newHash }
  });

  return res.json({ ok: true });
});

app.get("/api/admin/sessions", requireAdmin, async (_req, res) => {
  const sessions = await prisma.session.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { channels: true }
      }
    }
  });

  const withStats = await Promise.all(
    sessions.map(async (session) => {
      const stats = await fetchSessionStats(session.id);
      return {
        id: session.id,
        name: session.name,
        description: session.description,
        imageUrl: session.imageUrl,
        broadcastCode: session.broadcastCode,
        status: session.status,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        channelsCount: session._count.channels,
        listenersConnected: stats.listenersConnected,
        activeProducerChannels: stats.activeProducerChannels
      };
    })
  );

  return res.json(withStats);
});

app.post("/api/admin/sessions", requireAdmin, async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const broadcastCode = await generateUniqueSessionCode();
  const broadcastCodeHash = await bcrypt.hash(broadcastCode, 10);

  const session = await prisma.session.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      imageUrl: parsed.data.imageUrl,
      broadcastCode,
      broadcastCodeHash
    }
  });

  return res.status(201).json({
    id: session.id,
    name: session.name,
    description: session.description,
    imageUrl: session.imageUrl,
    status: session.status,
    createdAt: session.createdAt,
    broadcastCode
  });
});

app.get("/api/admin/sessions/:sessionId", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  let session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (!session.broadcastCode && session.status === "ACTIVE") {
    const broadcastCode = await generateUniqueSessionCode(sessionId);
    const broadcastCodeHash = await bcrypt.hash(broadcastCode, 10);
    session = await prisma.session.update({
      where: { id: sessionId },
      data: { broadcastCode, broadcastCodeHash }
    });
  }

  const [channels, stats, liveChannelIds] = await Promise.all([
    prisma.channel.findMany({
      where: { sessionId, isActive: true },
      orderBy: { createdAt: "asc" }
    }),
    fetchSessionStats(sessionId),
    fetchLiveChannelIds(sessionId)
  ]);

  return res.json({
    session: {
      id: session.id,
      name: session.name,
      description: session.description,
      imageUrl: session.imageUrl,
      broadcastCode: session.broadcastCode,
      status: session.status,
      createdAt: session.createdAt
    },
    channels,
    stats,
    liveChannelIds
  });
});

app.patch("/api/admin/sessions/:sessionId", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const parsed = updateSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        imageUrl: parsed.data.imageUrl
      }
    });
    return res.json(session);
  } catch {
    return res.status(404).json({ error: "Session not found" });
  }
});

app.post("/api/admin/sessions/:sessionId/rotate-code", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  const broadcastCode = await generateUniqueSessionCode(sessionId);
  const broadcastCodeHash = await bcrypt.hash(broadcastCode, 10);
  await prisma.session.update({
    where: { id: sessionId },
    data: { broadcastCode, broadcastCodeHash }
  });

  return res.json({ broadcastCode });
});

app.get("/api/admin/sessions/:sessionId/stats", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const [stats, liveChannelIds] = await Promise.all([fetchSessionStats(sessionId), fetchLiveChannelIds(sessionId)]);
  return res.json({ ...stats, liveChannelIds });
});

app.get("/api/admin/sessions/:sessionId/analytics", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const analytics = await buildSessionAnalytics(sessionId);
  return res.json(analytics);
});

app.get("/api/admin/sessions/:sessionId/analytics/export", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const format = String(req.query.format ?? "json").toLowerCase();
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, name: true } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const analytics = await buildSessionAnalytics(sessionId);

  if (format === "csv") {
    const rows: string[] = [];
    rows.push("section,metric,value");
    rows.push(`live,totalListeners,${toCsvValue(analytics.live.totalListeners)}`);
    rows.push(`live,peakListeners,${toCsvValue(analytics.live.peakListeners)}`);
    rows.push(`live,joinRatePerMin,${toCsvValue(analytics.live.joinRatePerMin.toFixed(2))}`);
    rows.push(`live,leaveRatePerMin,${toCsvValue(analytics.live.leaveRatePerMin.toFixed(2))}`);
    rows.push(`post,averageListeningDurationSec,${toCsvValue(analytics.postSession.averageListeningDurationSec.toFixed(2))}`);
    for (const channel of analytics.postSession.channelComparison) {
      rows.push(`channel,${toCsvValue(channel.name)} joins,${toCsvValue(channel.joins)}`);
      rows.push(`channel,${toCsvValue(channel.name)} leaves,${toCsvValue(channel.leaves)}`);
      rows.push(`channel,${toCsvValue(channel.name)} avgDurationSec,${toCsvValue(channel.averageListeningDurationSec.toFixed(2))}`);
      rows.push(`channel,${toCsvValue(channel.name)} peakListeners,${toCsvValue(channel.peakListeners)}`);
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${session.name}-analytics.csv\"`);
    return res.send(rows.join("\n"));
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${session.name}-analytics.json\"`);
  return res.send(JSON.stringify(analytics, null, 2));
});

app.post("/api/admin/sessions/:sessionId/analytics/clear", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  await prisma.accessLog.deleteMany({ where: { sessionId } });
  clearSessionAnalyticsState(sessionId);
  return res.json({ ok: true });
});

app.delete("/api/admin/sessions/:sessionId", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  try {
    await prisma.session.delete({ where: { id: sessionId } });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ error: "Session not found" });
  }
});

app.post("/api/sessions", requireAdmin, async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const broadcastCode = await generateUniqueSessionCode();
  const broadcastCodeHash = await bcrypt.hash(broadcastCode, 10);

  const session = await prisma.session.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      imageUrl: parsed.data.imageUrl,
      broadcastCode,
      broadcastCodeHash
    }
  });

  return res.status(201).json({ ...session, broadcastCode });
});

app.post("/api/sessions/:sessionId/channels", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  const channel = await prisma.channel.create({
    data: {
      sessionId,
      name: parsed.data.name,
      languageCode: parsed.data.languageCode
    }
  });

  io.to(`session:${session.id}`).emit("session:channelsUpdated", { sessionId: session.id });
  return res.status(201).json(channel);
});

app.get("/api/sessions/:sessionId/channels", async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const channels = await prisma.channel.findMany({
    where: { sessionId, isActive: true },
    orderBy: { createdAt: "asc" }
  });
  return res.json(channels);
});

app.delete("/api/sessions/:sessionId/channels/:channelId", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const channelId = String(req.params.channelId);

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.sessionId !== sessionId) {
    return res.status(404).json({ error: "Channel not found" });
  }

  await prisma.channel.delete({ where: { id: channelId } });
  io.to(`session:${sessionId}`).emit("session:channelsUpdated", { sessionId });
  return res.json({ ok: true });
});

app.post("/api/sessions/:sessionId/join-link", requireAdmin, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const parsed = createJoinLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  const base = buildJoinBaseUrl(req, parsed.data.joinBaseUrl);
  const joinUrl = `${base}?token=${encodeURIComponent(parsed.data.token)}`;
  return res.status(201).json({ joinUrl, qrPayload: joinUrl });
});

app.post("/api/join/validate-code", joinLimiter, async (req, res) => {
  const parsed = validateCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const ip = req.ip ?? "unknown";
  const attemptsKey = `${ip}:${parsed.data.code}`;
  const attemptState = attempts.get(attemptsKey);
  if (attemptState && attemptState.until > Date.now() && attemptState.count >= 10) {
    return res.status(429).json({ error: "Too many attempts" });
  }

  const session = await findActiveSessionByCode(parsed.data.code);
  if (!session) {
    const count = (attemptState?.count ?? 0) + 1;
    attempts.set(attemptsKey, { count, until: Date.now() + 5 * 60_000 });
    return res.status(401).json({ error: "Session invalid" });
  }

  attempts.delete(attemptsKey);

  const channels = await prisma.channel.findMany({
    where: { sessionId: session.id, isActive: true },
    orderBy: { name: "asc" }
  });
  const liveChannelIds = await fetchLiveChannelIds(session.id);

  return res.json({
    session: { id: session.id, name: session.name, description: session.description, imageUrl: session.imageUrl },
    channels,
    liveChannelIds
  });
});

app.post("/api/join/live-state", joinLimiter, async (req, res) => {
  const parsed = validateCodeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = await findActiveSessionByCode(parsed.data.code);
  if (!session) {
    return res.status(401).json({ error: "Session invalid" });
  }

  const liveChannelIds = await fetchLiveChannelIds(session.id);
  return res.json({ sessionId: session.id, liveChannelIds });
});

io.use(async (socket, next) => {
  const role = socket.handshake.auth?.role;
  const sessionId = socket.handshake.auth?.sessionId;
  const sessionCode = socket.handshake.auth?.sessionCode;
  if (typeof sessionCode !== "string") {
    next(new Error("Missing credentials"));
    return;
  }

  try {
    if (role === "LISTENER") {
      const session = await findActiveSessionByCode(sessionCode);
      if (!session) {
        next(new Error("Invalid code"));
        return;
      }
      socket.data.auth = { role: "LISTENER", sessionId: session.id } satisfies SocketAuthPayload;
      next();
      return;
    }

    if (typeof sessionId !== "string") {
      next(new Error("Missing session"));
      return;
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") {
      next(new Error("Session not found"));
      return;
    }

    const validCode =
      (typeof session.broadcastCode === "string" && session.broadcastCode === sessionCode) ||
      (typeof session.broadcastCodeHash === "string" && (await bcrypt.compare(sessionCode, session.broadcastCodeHash)));
    if (!validCode) {
      next(new Error("Invalid code"));
      return;
    }

    socket.data.auth = { role: "BROADCASTER", sessionId } satisfies SocketAuthPayload;
    next();
  } catch {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const auth = socket.data.auth as SocketAuthPayload;
  socket.join(`session:${auth.sessionId}`);
  if (auth.role === "LISTENER") {
    addSocketToRoleMap(listenerSocketsBySession, auth.sessionId, socket.id);
    listenerStateBySocket.set(socket.id, { sessionId: auth.sessionId });
    recordLiveSnapshot(auth.sessionId);
  } else {
    addSocketToRoleMap(broadcasterSocketsBySession, auth.sessionId, socket.id);
  }

  socket.on("disconnect", () => {
    if (auth.role === "LISTENER") {
      const state = listenerStateBySocket.get(socket.id);
      if (state?.channelId) {
        changeLiveListenerCount(auth.sessionId, state.channelId, -1);
        const durationMs = state.joinedAt ? Math.max(0, Date.now() - state.joinedAt) : 0;
        void prisma.accessLog
          .create({
            data: {
              sessionId: auth.sessionId,
              channelId: state.channelId,
              eventType: "LISTENER_LEAVE",
              success: true,
              reason: `durationMs=${durationMs}`
            }
          })
          .catch(() => {});
      }
      listenerStateBySocket.delete(socket.id);
      removeSocketFromRoleMap(listenerSocketsBySession, auth.sessionId, socket.id);
      recordLiveSnapshot(auth.sessionId);
    } else {
      removeSocketFromRoleMap(broadcasterSocketsBySession, auth.sessionId, socket.id);
    }
  });

  socket.on("session:getRtpCapabilities", async (_payload, cb) => {
    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/listeners/join`, {
        clientId: socket.id,
        sessionId: auth.sessionId
      });
      cb(response.data);
    } catch {
      cb({ error: "Failed to get RTP capabilities" });
    }
  });

  socket.on("listener:joinSession", async ({ channelId }, cb) => {
    if (!isListenerAuth(auth)) {
      cb({ error: "Forbidden" });
      return;
    }

    try {
      const state = listenerStateBySocket.get(socket.id) ?? { sessionId: auth.sessionId };
      if (state.channelId && state.channelId !== channelId) {
        changeLiveListenerCount(auth.sessionId, state.channelId, -1);
        const durationMs = state.joinedAt ? Math.max(0, Date.now() - state.joinedAt) : 0;
        void prisma.accessLog
          .create({
            data: {
              sessionId: auth.sessionId,
              channelId: state.channelId,
              eventType: "LISTENER_LEAVE",
              success: true,
              reason: `durationMs=${durationMs}`
            }
          })
          .catch(() => {});
      }
      if (state.channelId !== channelId) {
        changeLiveListenerCount(auth.sessionId, channelId, 1);
      }
      state.channelId = channelId;
      state.joinedAt = Date.now();
      listenerStateBySocket.set(socket.id, state);
      recordLiveSnapshot(auth.sessionId);

      const response = await axios.post(`${MEDIA_BASE_URL}/listeners/join`, {
        clientId: socket.id,
        sessionId: auth.sessionId,
        channelId
      });
      void prisma.accessLog
        .create({
          data: {
            sessionId: auth.sessionId,
            channelId,
            eventType: "LISTENER_JOIN",
            success: true
          }
        })
        .catch(() => {});
      cb(response.data);
    } catch {
      cb({ error: "Media join failed" });
    }
  });

  socket.on("broadcaster:createTransport", async ({ sessionId, channelId }, cb) => {
    if (auth.role !== "BROADCASTER") {
      cb({ error: "Forbidden" });
      return;
    }
    if (auth.sessionId !== sessionId) {
      cb({ error: "Invalid session" });
      return;
    }

    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/broadcasters/transport`, {
        clientId: socket.id,
        sessionId,
        channelId
      });
      cb(response.data);
    } catch {
      cb({ error: "Transport create failed" });
    }
  });

  socket.on("listener:createTransport", async ({ channelId }, cb) => {
    if (!isListenerAuth(auth)) {
      cb({ error: "Forbidden" });
      return;
    }

    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/listeners/transport`, {
        clientId: socket.id,
        sessionId: auth.sessionId,
        channelId
      });
      cb(response.data);
    } catch {
      cb({ error: "Transport create failed" });
    }
  });

  socket.on("transport:connect", async ({ transportId, dtlsParameters }, cb) => {
    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/transports/connect`, {
        transportId,
        dtlsParameters
      });
      cb(response.data);
    } catch {
      cb({ error: "Transport connect failed" });
    }
  });

  socket.on("broadcaster:produce", async ({ transportId, sessionId, channelId, rtpParameters }, cb) => {
    if (auth.role !== "BROADCASTER") {
      cb({ error: "Forbidden" });
      return;
    }
    if (auth.sessionId !== sessionId) {
      cb({ error: "Invalid session" });
      return;
    }

    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/broadcasters/produce`, {
        clientId: socket.id,
        transportId,
        sessionId,
        channelId,
        kind: "audio",
        rtpParameters
      });
      io.to(`session:${sessionId}`).emit("channel:producerAvailable", { channelId });
      cb(response.data);
    } catch {
      cb({ error: "Produce failed" });
    }
  });

  socket.on("listener:consume", async ({ transportId, sessionId, channelId, rtpCapabilities }, cb) => {
    if (!isListenerAuth(auth)) {
      cb({ error: "Forbidden" });
      return;
    }

    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/listeners/consume`, {
        clientId: socket.id,
        transportId,
        sessionId,
        channelId,
        rtpCapabilities
      });
      void prisma.accessLog
        .create({
          data: {
            sessionId: auth.sessionId,
            channelId,
            eventType: "LISTENER_CONSUME",
            success: true
          }
        })
        .catch(() => {});
      cb(response.data);
    } catch {
      cb({ error: "Consume failed" });
    }
  });

  socket.on("consumer:resume", async ({ consumerId }, cb) => {
    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/consumers/resume`, { consumerId });
      cb(response.data);
    } catch {
      cb({ error: "Resume failed" });
    }
  });
});

server.listen(API_PORT, API_HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on ${API_HOST}:${API_PORT}`);
});
