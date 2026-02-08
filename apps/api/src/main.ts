import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import express from "express";
import type { Request } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { PrismaClient, Role } from "@prisma/client";
import { Server } from "socket.io";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const API_PORT = Number(process.env.API_PORT ?? 3000);
const API_HOST = process.env.API_HOST ?? "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const JOIN_TOKEN_TTL_MINUTES = Number(process.env.JOIN_TOKEN_TTL_MINUTES ?? 15);
const PIN_MAX_ATTEMPTS = Number(process.env.PIN_MAX_ATTEMPTS ?? 6);
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL ?? "http://localhost:4000";

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan("combined"));

app.set("trust proxy", true);

const joinLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

type JoinJwtPayload = {
  role: Role;
  sessionId: string;
  allowedChannelId?: string;
  joinTokenId: string;
};

const attempts = new Map<string, { count: number; until: number }>();

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generatePin(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildJoinBaseUrl(req: Request, override?: string): string {
  if (override) {
    return override;
  }
  if (process.env.PUBLIC_JOIN_URL) {
    return process.env.PUBLIC_JOIN_URL;
  }

  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = typeof protoHeader === "string" ? protoHeader.split(",")[0] : req.protocol || "http";
  const hostHeader = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost:3000";
  const hostname = hostHeader.split(",")[0].split(":")[0].trim() || "localhost";
  const webPort = process.env.PUBLIC_WEB_PORT ?? "5173";
  return `${proto}://${hostname}:${webPort}`;
}

function buildJoinUrl(req: Request, token: string, includePinInUrl: boolean, pin: string, joinBaseUrl?: string): string {
  const base = buildJoinBaseUrl(req, joinBaseUrl);
  if (includePinInUrl) {
    return `${base}?token=${encodeURIComponent(token)}&pin=${pin}`;
  }
  return `${base}?token=${encodeURIComponent(token)}`;
}

const createSessionSchema = z.object({ name: z.string().min(2).max(100) });
const createChannelSchema = z.object({ name: z.string().min(2).max(50), languageCode: z.string().max(8).optional() });
const createJoinTokenSchema = z.object({
  channelId: z.string().optional(),
  expiresInSec: z.number().int().min(60).max(24 * 3600).optional(),
  includePinInUrl: z.boolean().default(false),
  rotates: z.boolean().default(false),
  joinBaseUrl: z.string().url().optional()
});
const validateJoinSchema = z.object({ token: z.string().min(16), pin: z.string().length(6) });

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

app.post("/api/sessions", async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = await prisma.session.create({ data: { name: parsed.data.name } });
  return res.status(201).json(session);
});

app.post("/api/sessions/:sessionId/channels", async (req, res) => {
  const parsed = createChannelSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = await prisma.session.findUnique({ where: { id: req.params.sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  const channel = await prisma.channel.create({
    data: {
      sessionId: req.params.sessionId,
      name: parsed.data.name,
      languageCode: parsed.data.languageCode
    }
  });

  io.to(`session:${session.id}`).emit("session:channelsUpdated", { sessionId: session.id });
  return res.status(201).json(channel);
});

app.post("/api/sessions/:sessionId/broadcaster-token", async (req, res) => {
  const session = await prisma.session.findUnique({ where: { id: req.params.sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  const token = jwt.sign(
    {
      role: Role.BROADCASTER,
      sessionId: session.id,
      joinTokenId: `broadcaster-${session.id}`
    } satisfies JoinJwtPayload,
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  return res.json({ token });
});

app.get("/api/sessions/:sessionId/channels", async (req, res) => {
  const channels = await prisma.channel.findMany({
    where: { sessionId: req.params.sessionId, isActive: true },
    orderBy: { createdAt: "asc" }
  });
  return res.json(channels);
});

app.post("/api/sessions/:sessionId/join-tokens", async (req, res) => {
  const parsed = createJoinTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = await prisma.session.findUnique({ where: { id: req.params.sessionId } });
  if (!session || session.status !== "ACTIVE") {
    return res.status(404).json({ error: "Session not found" });
  }

  if (parsed.data.channelId) {
    const ch = await prisma.channel.findUnique({ where: { id: parsed.data.channelId } });
    if (!ch || ch.sessionId !== session.id) {
      return res.status(400).json({ error: "Invalid channelId" });
    }
  }

  const rawToken = crypto.randomBytes(24).toString("base64url");
  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);
  const ttlSec = parsed.data.expiresInSec ?? JOIN_TOKEN_TTL_MINUTES * 60;
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  const joinToken = await prisma.joinToken.create({
    data: {
      sessionId: session.id,
      channelId: parsed.data.channelId,
      tokenHash: hashToken(rawToken),
      pinHash,
      pinLast4: pin.slice(2),
      expiresAt,
      rotates: parsed.data.rotates
    }
  });

  const joinUrl = buildJoinUrl(req, rawToken, parsed.data.includePinInUrl, pin, parsed.data.joinBaseUrl);
  return res.status(201).json({
    joinTokenId: joinToken.id,
    joinUrl,
    token: rawToken,
    pin,
    pinMasked: `**${pin.slice(-4)}`,
    expiresAt: joinToken.expiresAt,
    qrPayload: joinUrl
  });
});

app.post("/api/join/validate", joinLimiter, async (req, res) => {
  const parsed = validateJoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const ip = req.ip ?? "unknown";
  const attemptsKey = `${ip}:${parsed.data.token}`;
  const attemptState = attempts.get(attemptsKey);
  if (attemptState && attemptState.until > Date.now() && attemptState.count >= PIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many attempts" });
  }

  const tokenHash = hashToken(parsed.data.token);
  const joinToken = await prisma.joinToken.findUnique({
    where: { tokenHash },
    include: { session: true }
  });

  if (!joinToken || joinToken.revokedAt || joinToken.expiresAt < new Date()) {
    return res.status(401).json({ error: "Token invalid or expired" });
  }

  const pinOk = await bcrypt.compare(parsed.data.pin, joinToken.pinHash);
  if (!pinOk) {
    const count = (attemptState?.count ?? 0) + 1;
    attempts.set(attemptsKey, { count, until: Date.now() + 5 * 60_000 });
    await prisma.accessLog.create({
      data: {
        sessionId: joinToken.sessionId,
        channelId: joinToken.channelId,
        joinTokenId: joinToken.id,
        ip,
        userAgent: req.headers["user-agent"] ?? null,
        eventType: "join_validate",
        success: false,
        reason: "invalid_pin"
      }
    });
    return res.status(401).json({ error: "Invalid PIN" });
  }

  attempts.delete(attemptsKey);

  await prisma.joinToken.update({
    where: { id: joinToken.id },
    data: { usedCount: { increment: 1 } }
  });

  await prisma.accessLog.create({
    data: {
      sessionId: joinToken.sessionId,
      channelId: joinToken.channelId,
      joinTokenId: joinToken.id,
      ip,
      userAgent: req.headers["user-agent"] ?? null,
      eventType: "join_validate",
      success: true
    }
  });

  const jwtPayload: JoinJwtPayload = {
    role: Role.LISTENER,
    sessionId: joinToken.sessionId,
    allowedChannelId: joinToken.channelId ?? undefined,
    joinTokenId: joinToken.id
  };

  const joinJwt = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: "10m" });
  const channels = await prisma.channel.findMany({
    where: {
      sessionId: joinToken.sessionId,
      isActive: true,
      ...(joinToken.channelId ? { id: joinToken.channelId } : {})
    },
    orderBy: { name: "asc" }
  });

  return res.json({
    joinJwt,
    session: { id: joinToken.session.id, name: joinToken.session.name },
    channels
  });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token || typeof token !== "string") {
    next(new Error("Missing auth token"));
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JoinJwtPayload;
    socket.data.auth = payload;
    next();
  } catch {
    next(new Error("Invalid auth token"));
  }
});

io.on("connection", (socket) => {
  const auth = socket.data.auth as JoinJwtPayload;
  socket.join(`session:${auth.sessionId}`);

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
    if (auth.role !== Role.LISTENER) {
      cb({ error: "Forbidden" });
      return;
    }
    if (auth.allowedChannelId && auth.allowedChannelId !== channelId) {
      cb({ error: "Channel not allowed" });
      return;
    }

    try {
      const response = await axios.post(`${MEDIA_BASE_URL}/listeners/join`, {
        clientId: socket.id,
        sessionId: auth.sessionId,
        channelId
      });
      cb(response.data);
    } catch (error) {
      cb({ error: "Media join failed" });
    }
  });

  socket.on("broadcaster:createTransport", async ({ sessionId, channelId }, cb) => {
    if (auth.role !== Role.BROADCASTER) {
      cb({ error: "Forbidden" });
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
    if (auth.role !== Role.LISTENER) {
      cb({ error: "Forbidden" });
      return;
    }
    if (auth.allowedChannelId && auth.allowedChannelId !== channelId) {
      cb({ error: "Channel not allowed" });
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
    if (auth.role !== Role.BROADCASTER) {
      cb({ error: "Forbidden" });
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
    if (auth.role !== Role.LISTENER) {
      cb({ error: "Forbidden" });
      return;
    }
    if (auth.allowedChannelId && auth.allowedChannelId !== channelId) {
      cb({ error: "Channel not allowed" });
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
