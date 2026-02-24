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

type SessionChannelRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  io: { to(room: string): { emit(event: string, payload: unknown): void } };
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  createSessionSchema: ZodSchema<{ name: string; description?: string; imageUrl?: string }>;
  createChannelSchema: ZodSchema<{ name: string; languageCode?: string }>;
  createJoinLinkSchema: ZodSchema<{ joinBaseUrl?: string; token: string }>;
  generateUniqueSessionCode: (excludeSessionId?: string) => Promise<string>;
  resolveExistingUserId: (userId?: string) => Promise<string | undefined>;
  buildJoinBaseUrl: (req: Request, override?: string) => string;
};

export function registerSessionChannelsRoutes(deps: SessionChannelRoutesDeps): void {
  const {
    app,
    prisma,
    io,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    createSessionSchema,
    createChannelSchema,
    createJoinLinkSchema,
    generateUniqueSessionCode,
    resolveExistingUserId,
    buildJoinBaseUrl
  } = deps;

  app.post("/api/sessions", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
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
    return res.status(201).json({ ...session, broadcastCode });
  });

  app.post("/api/sessions/:sessionId/channels", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const parsed = createChannelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") return res.status(404).json({ error: "Session not found" });

    const channel = await prisma.channel.create({ data: { sessionId, name: parsed.data.name, languageCode: parsed.data.languageCode } });
    io.to(`session:${session.id}`).emit("session:channelsUpdated", { sessionId: session.id });
    return res.status(201).json(channel);
  });

  app.get("/api/sessions/:sessionId/channels", async (req, res) => {
    const sessionId = String(req.params.sessionId);
    return res.json(await prisma.channel.findMany({ where: { sessionId, isActive: true }, orderBy: { createdAt: "asc" } }));
  });

  app.delete("/api/sessions/:sessionId/channels/:channelId", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const channelId = String(req.params.channelId);
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || channel.sessionId !== sessionId) return res.status(404).json({ error: "Channel not found" });
    await prisma.channel.delete({ where: { id: channelId } });
    io.to(`session:${sessionId}`).emit("session:channelsUpdated", { sessionId });
    return res.json({ ok: true });
  });

  app.post("/api/sessions/:sessionId/join-link", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const parsed = createJoinLinkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") return res.status(404).json({ error: "Session not found" });
    const base = buildJoinBaseUrl(req, parsed.data.joinBaseUrl);
    const joinUrl = `${base}?token=${encodeURIComponent(parsed.data.token)}`;
    return res.status(201).json({ joinUrl, qrPayload: joinUrl });
  });
}

