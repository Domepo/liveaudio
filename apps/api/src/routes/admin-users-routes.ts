import bcrypt from "bcryptjs";
import { Role, type PrismaClient } from "@prisma/client";
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

type AdminUsersRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  createAdminUserSchema: ZodSchema<{ name: string; password: string; role: Role }>;
  updateAdminUserSchema: ZodSchema<{ name?: string; password?: string; role?: Role }>;
  updateSessionUserAccessSchema: ZodSchema<{ assigned: boolean }>;
  normalizeForLookup: (value: string) => string;
  buildPseudoEmailFromName: (name: string) => string;
};

export function registerAdminUsersRoutes(deps: AdminUsersRoutesDeps): void {
  const {
    app,
    prisma,
    requireAuthenticated,
    requireRoles,
    createAdminUserSchema,
    updateAdminUserSchema,
    updateSessionUserAccessSchema,
    normalizeForLookup,
    buildPseudoEmailFromName
  } = deps;

  app.get("/api/admin/roles", requireAuthenticated, requireRoles(["ADMIN"]), (_req, res) => {
    return res.json({ roles: Object.values(Role) });
  });

  app.get("/api/admin/users", requireAuthenticated, requireRoles(["ADMIN"]), async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        role: true,
        createdAt: true,
        sessionAccesses: {
          select: { session: { select: { id: true, name: true } } }
        }
      }
    });
    return res.json(
      users.map((user) => ({
        id: user.id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        sessions: user.sessionAccesses.map((access) => access.session)
      }))
    );
  });

  app.post("/api/admin/users", requireAuthenticated, requireRoles(["ADMIN"]), async (req, res) => {
    const parsed = createAdminUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

    const existingUsers = await prisma.user.findMany({ select: { id: true, name: true } });
    const existing = existingUsers.find((user) => normalizeForLookup(user.name) === normalizeForLookup(parsed.data.name));
    if (existing) return res.status(409).json({ error: "Ein Benutzer mit diesem Namen existiert bereits" });

    const created = await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email: buildPseudoEmailFromName(parsed.data.name),
        role: parsed.data.role,
        passwordHash: await bcrypt.hash(parsed.data.password, 12)
      },
      select: { id: true, name: true, role: true, createdAt: true }
    });

    return res.status(201).json(created);
  });

  app.patch("/api/admin/users/:userId", requireAuthenticated, requireRoles(["ADMIN"]), async (req, res) => {
    const parsed = updateAdminUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

    const userId = String(req.params.userId);
    const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!targetUser) return res.status(404).json({ error: "Benutzer nicht gefunden" });

    if (parsed.data.name) {
      const existingUsers = await prisma.user.findMany({ select: { id: true, name: true } });
      const nameCollision = existingUsers.find((user) => user.id !== userId && normalizeForLookup(user.name) === normalizeForLookup(parsed.data.name ?? ""));
      if (nameCollision) return res.status(409).json({ error: "Ein Benutzer mit diesem Namen existiert bereits" });
    }

    const updateData: { name?: string; role?: Role; passwordHash?: string } = {};
    if (parsed.data.name) updateData.name = parsed.data.name.trim();
    if (parsed.data.role) updateData.role = parsed.data.role;
    if (parsed.data.password) updateData.passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, role: true, createdAt: true }
    });

    return res.json(updated);
  });

  app.delete("/api/admin/users/:userId", requireAuthenticated, requireRoles(["ADMIN"]), async (req, res) => {
    const admin = (req as AdminRequest).admin;
    const userId = String(req.params.userId);
    if (!admin?.userId) return res.status(401).json({ error: "Authentication required" });
    if (admin.userId === userId) return res.status(400).json({ error: "Du kannst deinen eigenen Benutzer nicht loeschen" });
    const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!targetUser) return res.status(404).json({ error: "Benutzer nicht gefunden" });
    await prisma.user.delete({ where: { id: userId } });
    return res.json({ ok: true });
  });

  app.get("/api/admin/sessions/:sessionId/users", requireAuthenticated, requireRoles(["ADMIN"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const [broadcasters, accessRows] = await Promise.all([
      prisma.user.findMany({ where: { role: "BROADCASTER" }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, createdAt: true } }),
      prisma.sessionUserAccess.findMany({ where: { sessionId }, select: { userId: true } })
    ]);
    const assignedUserIds = new Set(accessRows.map((entry) => entry.userId));
    return res.json({ users: broadcasters.map((user) => ({ ...user, assigned: assignedUserIds.has(user.id) })) });
  });

  app.put("/api/admin/sessions/:sessionId/users/:userId", requireAuthenticated, requireRoles(["ADMIN"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const userId = String(req.params.userId);
    const parsed = updateSessionUserAccessSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

    const [session, user] = await Promise.all([
      prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
    ]);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden" });
    if (user.role !== "BROADCASTER") return res.status(400).json({ error: "Nur BROADCASTER koennen Sessions zugewiesen werden" });

    if (parsed.data.assigned) {
      await prisma.sessionUserAccess.upsert({ where: { sessionId_userId: { sessionId, userId } }, create: { sessionId, userId }, update: {} });
    } else {
      await prisma.sessionUserAccess.deleteMany({ where: { sessionId, userId } });
    }

    return res.json({ ok: true, assigned: parsed.data.assigned });
  });
}
