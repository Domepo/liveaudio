import bcrypt from "bcryptjs";
import type { PrismaClient, Role } from "@prisma/client";
import type { Express, Request, Response } from "express";
import type { ZodSchema } from "zod";

type AdminAuthContext = {
  authType: "legacy" | "user";
  userName: string;
  userRole: Role;
  userId?: string;
};

type AdminRequest = Request & {
  admin?: AdminAuthContext;
};

type AdminSessionsRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  io: { to(room: string): { emit(event: string, payload: unknown): void } };
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  createSessionSchema: ZodSchema<{ name: string; description?: string; imageUrl?: string }>;
  updateSessionSchema: ZodSchema<{ name?: string; description?: string; imageUrl?: string }>;
  generateUniqueSessionCode: (excludeSessionId?: string) => Promise<string>;
  resolveExistingUserId: (userId?: string) => Promise<string | undefined>;
  fetchSessionStats: (sessionId: string) => Promise<{
    channelsTotal: number;
    channelsActive: number;
    listenersConnected: number;
    broadcastersConnected: number;
    joinEvents24h: number;
    activeProducerChannels: number;
  }>;
  fetchLiveChannelIds: (sessionId: string) => Promise<string[]>;
  getBroadcastOwner: (sessionId: string) => { socketId: string; userId?: string; userName: string; connectedAt: number } | null;
  forceBroadcastTakeover: (sessionId: string) => Promise<void>;
};

export function registerAdminSessionsRoutes(deps: AdminSessionsRoutesDeps): void {
  const {
    app,
    prisma,
    io,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    createSessionSchema,
    updateSessionSchema,
    generateUniqueSessionCode,
    resolveExistingUserId,
    fetchSessionStats,
    fetchLiveChannelIds,
    getBroadcastOwner,
    forceBroadcastTakeover
  } = deps;
  const PRE_SHOW_AUTO_SWITCH_KEY_PREFIX = "preshow-auto-switch:";
  const DEFAULT_PRE_SHOW_AUTO_SWITCH_TIME = "10:00";

  function parseStoredPreShowAutoSwitch(value: string | null | undefined): { enabled: boolean; time: string } {
    if (!value) return { enabled: false, time: DEFAULT_PRE_SHOW_AUTO_SWITCH_TIME };
    try {
      const parsed = JSON.parse(value) as { enabled?: unknown; time?: unknown };
      const enabled = Boolean(parsed.enabled);
      const time = typeof parsed.time === "string" && /^\d{2}:\d{2}$/.test(parsed.time) ? parsed.time : DEFAULT_PRE_SHOW_AUTO_SWITCH_TIME;
      return { enabled, time };
    } catch {
      return { enabled: false, time: DEFAULT_PRE_SHOW_AUTO_SWITCH_TIME };
    }
  }

  app.get("/api/admin/sessions", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const admin = (req as AdminRequest).admin!;
    const where =
      admin.userRole === "BROADCASTER"
        ? admin.userId
          ? { userAccesses: { some: { userId: admin.userId } } }
          : { id: "__no-access__" }
        : undefined;
    const sessions = await prisma.session.findMany({ where, orderBy: { createdAt: "desc" }, include: { _count: { select: { channels: true } } } });
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
          endedAt: session.endedAt,
          channelsCount: session._count.channels,
          listenersConnected: stats.listenersConnected,
          activeProducerChannels: stats.activeProducerChannels
        };
      })
    );
    return res.json(withStats);
  });

  app.post("/api/admin/sessions", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
    const broadcastCode = await generateUniqueSessionCode();
    const admin = (req as AdminRequest).admin!;
    const creatorUserId = await resolveExistingUserId(admin.userId);
    if (admin.userRole === "BROADCASTER" && !creatorUserId) return res.status(401).json({ error: "Session invalid" });

    const session = await prisma.session.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        imageUrl: parsed.data.imageUrl,
        broadcastCode,
        broadcastCodeHash: await bcrypt.hash(broadcastCode, 10),
        ...(creatorUserId ? { createdByUserId: creatorUserId } : {}),
        ...(admin.userRole === "BROADCASTER" && creatorUserId ? { userAccesses: { create: { userId: creatorUserId } } } : {})
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

  app.get("/api/admin/sessions/:sessionId", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    let session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.broadcastCode && session.status === "ACTIVE") {
      const broadcastCode = await generateUniqueSessionCode(sessionId);
      session = await prisma.session.update({ where: { id: sessionId }, data: { broadcastCode, broadcastCodeHash: await bcrypt.hash(broadcastCode, 10) } });
    }

    const [channels, stats, liveChannelIds] = await Promise.all([
      prisma.channel.findMany({ where: { sessionId, isActive: true }, orderBy: { createdAt: "asc" } }),
      fetchSessionStats(sessionId),
      fetchLiveChannelIds(sessionId)
    ]);
    const autoSwitchStored = await prisma.appConfig.findUnique({ where: { key: `${PRE_SHOW_AUTO_SWITCH_KEY_PREFIX}${sessionId}` }, select: { value: true } });
    const autoSwitch = parseStoredPreShowAutoSwitch(autoSwitchStored?.value);
    return res.json({
      session: {
        id: session.id,
        name: session.name,
        description: session.description,
        imageUrl: session.imageUrl,
        broadcastCode: session.broadcastCode,
        status: session.status,
        createdAt: session.createdAt,
        preShowAutoSwitchEnabled: autoSwitch.enabled,
        preShowAutoSwitchTime: autoSwitch.time
      },
      channels,
      stats,
      liveChannelIds
    });
  });

  app.put("/api/admin/sessions/:sessionId/preshow-auto-switch", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const body = req.body as { enabled?: unknown; time?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean") return res.status(400).json({ error: "Invalid payload" });
    if (typeof body?.time !== "string" || !/^\d{2}:\d{2}$/.test(body.time)) return res.status(400).json({ error: "Invalid time" });

    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const key = `${PRE_SHOW_AUTO_SWITCH_KEY_PREFIX}${sessionId}`;
    const value = JSON.stringify({ enabled: body.enabled, time: body.time });
    await prisma.appConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value }
    });
    return res.json({ ok: true, enabled: body.enabled, time: body.time });
  });

  app.patch("/api/admin/sessions/:sessionId", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
    try {
      return res.json(await prisma.session.update({ where: { id: sessionId }, data: { name: parsed.data.name, description: parsed.data.description, imageUrl: parsed.data.imageUrl } }));
    } catch {
      return res.status(404).json({ error: "Session not found" });
    }
  });

  app.post("/api/admin/sessions/:sessionId/rotate-code", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") return res.status(404).json({ error: "Session not found" });
    const broadcastCode = await generateUniqueSessionCode(sessionId);
    await prisma.session.update({ where: { id: sessionId }, data: { broadcastCode, broadcastCodeHash: await bcrypt.hash(broadcastCode, 10) } });
    return res.json({ broadcastCode });
  });

  app.get("/api/admin/sessions/:sessionId/broadcast-owner", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const admin = (req as AdminRequest).admin;
    const owner = getBroadcastOwner(sessionId);
    if (!owner) return res.json({ occupied: false });
    const isSameUser =
      (owner.userId && admin?.userId && owner.userId === admin.userId) ||
      owner.userName.trim().toLowerCase() === (admin?.userName ?? "").trim().toLowerCase();
    return res.json({
      occupied: true,
      occupiedByOther: !isSameUser,
      ownerName: owner.userName,
      ownerUserId: owner.userId,
      startedAt: new Date(owner.connectedAt).toISOString()
    });
  });

  app.post("/api/admin/sessions/:sessionId/takeover", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
    if (confirm !== true) return res.status(400).json({ error: "Takeover confirmation required" });
    const actor = (req as AdminRequest).admin;
    const previousOwner = getBroadcastOwner(sessionId);
    if (previousOwner) {
      io.to(`session:${sessionId}`).emit("broadcast:takeoverRequired", {
        sessionId,
        previousOwner: { userName: previousOwner.userName, userId: previousOwner.userId, startedAt: new Date(previousOwner.connectedAt).toISOString() },
        requestedBy: actor ? { userName: actor.userName, userId: actor.userId } : null
      });
    }
    await forceBroadcastTakeover(sessionId);
    io.to(`session:${sessionId}`).emit("broadcast:ownershipChanged", {
      sessionId,
      ownerName: actor?.userName ?? "unknown",
      ownerUserId: actor?.userId,
      startedAt: new Date().toISOString(),
      takeover: true
    });
    return res.json({
      ok: true,
      takenOver: true,
      previousOwner: previousOwner ? { userName: previousOwner.userName, userId: previousOwner.userId, startedAt: new Date(previousOwner.connectedAt).toISOString() } : null,
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/admin/sessions/:sessionId/stats", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    const [stats, liveChannelIds] = await Promise.all([fetchSessionStats(sessionId), fetchLiveChannelIds(sessionId)]);
    return res.json({ ...stats, liveChannelIds });
  });

  app.delete("/api/admin/sessions/:sessionId", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    try {
      await prisma.session.delete({ where: { id: sessionId } });
      io.to(`session:${sessionId}`).emit("session:channelsUpdated", { sessionId });
      return res.json({ ok: true });
    } catch {
      return res.status(404).json({ error: "Session not found" });
    }
  });
}
