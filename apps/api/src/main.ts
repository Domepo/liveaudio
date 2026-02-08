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

function isListenerAuth(auth: SocketAuthPayload): auth is ListenerSocketAuth {
  return auth.role === "LISTENER";
}

function generateSessionCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function generateUniqueSessionCode(excludeSessionId?: string): Promise<string> {
  const sessions = await prisma.session.findMany({
    where: { broadcastCodeHash: { not: null } },
    select: { id: true, broadcastCodeHash: true }
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = generateSessionCode();
    let collision = false;

    for (const session of sessions) {
      if (excludeSessionId && session.id === excludeSessionId) continue;
      if (!session.broadcastCodeHash) continue;
      if (await bcrypt.compare(candidate, session.broadcastCodeHash)) {
        collision = true;
        break;
      }
    }

    if (!collision) return candidate;
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

async function findActiveSessionByCode(code: string) {
  const sessions = await prisma.session.findMany({
    where: { status: "ACTIVE", broadcastCodeHash: { not: null } },
    select: { id: true, name: true, description: true, imageUrl: true, status: true, broadcastCodeHash: true }
  });

  for (const session of sessions) {
    if (!session.broadcastCodeHash) continue;
    const ok = await bcrypt.compare(code, session.broadcastCodeHash);
    if (ok) return session;
  }
  return null;
}

app.get("/health", async (_req, res) => {
  const sessions = await prisma.session.count({ where: { status: "ACTIVE" } });
  const channels = await prisma.channel.count({ where: { isActive: true } });
  res.json({ ok: true, sessions, channels });
});

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

  const ok = await bcrypt.compare(parsed.data.password, ADMIN_PASSWORD_HASH);
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
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
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
    data: { broadcastCodeHash }
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
    if (!session || session.status !== "ACTIVE" || !session.broadcastCodeHash) {
      next(new Error("Session not found"));
      return;
    }

    const validCode = await bcrypt.compare(sessionCode, session.broadcastCodeHash);
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
  } else {
    addSocketToRoleMap(broadcasterSocketsBySession, auth.sessionId, socket.id);
  }

  socket.on("disconnect", () => {
    if (auth.role === "LISTENER") {
      removeSocketFromRoleMap(listenerSocketsBySession, auth.sessionId, socket.id);
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
      const response = await axios.post(`${MEDIA_BASE_URL}/listeners/join`, {
        clientId: socket.id,
        sessionId: auth.sessionId,
        channelId
      });
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
