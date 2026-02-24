import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient, Role } from "@prisma/client";
import type { Express, Request, Response } from "express";
import type { RateLimitRequestHandler } from "express-rate-limit";
import type { ZodSchema } from "zod";

type AdminAuthContext = {
  authType: "legacy" | "user";
  userName: string;
  userRole: Role;
  userId?: string;
  mustChangePassword?: boolean;
  tokenSessionVersion: number;
};

type AdminRequest = Request & {
  admin?: AdminAuthContext;
};

type AdminJwtPayload = {
  role: Role;
  authType: "legacy" | "user";
  userName: string;
  userId?: string;
  sv: number;
};

type AdminWsJwtPayload = {
  kind: "ADMIN_WS";
  role: Role;
  sessionId: string;
  userId?: string;
  sv: number;
};

type AdminAuthRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  adminLoginLimiter: RateLimitRequestHandler;
  adminLoginSchema: ZodSchema<{ name: string; password: string }>;
  changeAdminPasswordSchema: ZodSchema<{ currentPassword: string; newPassword: string; confirmPassword: string }>;
  updateAppLogoSchema: ZodSchema<{ logoDataUrl: string | null }>;
  normalizeForLookup: (value: string) => string;
  getEffectiveAdminLoginName: () => Promise<string>;
  getEffectiveAdminPasswordHash: () => Promise<string>;
  buildPseudoEmailFromName: (name: string) => string;
  setAdminCookie: (res: Response, token: string) => void;
  clearAdminCookie: (res: Response) => void;
  readAdminFromRequestCookie: (req: Request) => AdminAuthContext | null;
  getSessionVersion: (input: { authType: "legacy" | "user"; userId?: string }) => Promise<number>;
  bumpSessionVersion: (input: { authType: "legacy" | "user"; userId?: string }) => Promise<number>;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  ADMIN_SESSION_TTL_HOURS: number;
  ADMIN_WS_TOKEN_TTL_MINUTES: number;
  getDebugMode: () => boolean;
  canToggleDebugMode: boolean;
  setDebugMode: (enabled: boolean) => Promise<boolean>;
  APP_LOGO_CONFIG_KEY: string;
  DEFAULT_APP_LOGO_URL: string;
  ADMIN_PASSWORD_CONFIG_KEY: string;
};

export function registerAdminAuthRoutes(deps: AdminAuthRoutesDeps): void {
  const {
    app,
    prisma,
    requireAuthenticated,
    requireRoles,
    adminLoginLimiter,
    adminLoginSchema,
    changeAdminPasswordSchema,
    updateAppLogoSchema,
    normalizeForLookup,
    getEffectiveAdminLoginName,
    getEffectiveAdminPasswordHash,
    buildPseudoEmailFromName,
    setAdminCookie,
    clearAdminCookie,
    readAdminFromRequestCookie,
    getSessionVersion,
    bumpSessionVersion,
    ensureSessionAccessOr404,
    JWT_SECRET,
    JWT_ISSUER,
    ADMIN_SESSION_TTL_HOURS,
    ADMIN_WS_TOKEN_TTL_MINUTES,
    getDebugMode,
    canToggleDebugMode,
    setDebugMode,
    APP_LOGO_CONFIG_KEY,
    DEFAULT_APP_LOGO_URL,
    ADMIN_PASSWORD_CONFIG_KEY
  } = deps;

  app.post("/api/admin/login", adminLoginLimiter, async (req, res) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const loginName = parsed.data.name.trim();
    const lookupName = normalizeForLookup(loginName);
    const users = await prisma.user.findMany({ select: { id: true, name: true, passwordHash: true } });
    const matchedUser = users.find((user) => normalizeForLookup(user.name) === lookupName);

    if (matchedUser?.passwordHash) {
      const fullUser = await prisma.user.findUnique({
        where: { id: matchedUser.id },
        select: { id: true, name: true, role: true, passwordHash: true, mustChangePassword: true }
      });
      if (!fullUser) return res.status(401).json({ error: "Ungültiger Name oder Passwort" });
      if (!(await bcrypt.compare(parsed.data.password, fullUser.passwordHash))) return res.status(401).json({ error: "Ungültiger Name oder Passwort" });

      const sessionVersion = await getSessionVersion({ authType: "user", userId: fullUser.id });
      const token = jwt.sign(
        { role: fullUser.role, authType: "user", userName: fullUser.name, userId: fullUser.id, sv: sessionVersion } satisfies AdminJwtPayload,
        JWT_SECRET,
        { expiresIn: ADMIN_SESSION_TTL_HOURS * 60 * 60, algorithm: "HS256", issuer: JWT_ISSUER, subject: fullUser.id }
      );
      setAdminCookie(res, token);
      return res.json({ ok: true, mustChangePassword: Boolean(fullUser.mustChangePassword) });
    }

    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (adminUser) return res.status(401).json({ error: "Ungültiger Name oder Passwort" });

    const effectiveName = normalizeForLookup(await getEffectiveAdminLoginName());
    const effectiveHash = await getEffectiveAdminPasswordHash();
    if (!(await bcrypt.compare(parsed.data.password, effectiveHash)) || lookupName !== effectiveName) {
      return res.status(401).json({ error: "Ungültiger Name oder Passwort" });
    }

    const existingUsers = await prisma.user.findMany({ select: { name: true } });
    let bootstrapName = parsed.data.name.trim();
    let suffix = 1;
    while (existingUsers.some((user) => normalizeForLookup(user.name) === normalizeForLookup(bootstrapName))) {
      bootstrapName = `${parsed.data.name.trim()}-${suffix}`;
      suffix += 1;
    }

    const bootstrapAdmin = await prisma.user.create({
      data: { name: bootstrapName, email: buildPseudoEmailFromName(bootstrapName), role: "ADMIN", passwordHash: effectiveHash, mustChangePassword: true },
      select: { id: true, name: true }
    });

    const sessionVersion = await getSessionVersion({ authType: "user", userId: bootstrapAdmin.id });
    const token = jwt.sign(
      { role: "ADMIN", authType: "user", userName: bootstrapAdmin.name, userId: bootstrapAdmin.id, sv: sessionVersion } satisfies AdminJwtPayload,
      JWT_SECRET,
      { expiresIn: ADMIN_SESSION_TTL_HOURS * 60 * 60, algorithm: "HS256", issuer: JWT_ISSUER, subject: bootstrapAdmin.id }
    );
    setAdminCookie(res, token);
    return res.json({ ok: true, mustChangePassword: true });
  });

  app.post("/api/admin/logout", async (req, res) => {
    const admin = readAdminFromRequestCookie(req);
    if (admin) {
      await bumpSessionVersion({ authType: admin.authType, userId: admin.userId });
    }
    clearAdminCookie(res);
    return res.json({ ok: true });
  });

  app.put("/api/admin/settings/logo", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const parsed = updateAppLogoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });
    if (!parsed.data.logoDataUrl) {
      await prisma.appConfig.deleteMany({ where: { key: APP_LOGO_CONFIG_KEY } });
      return res.json({ ok: true, logoUrl: DEFAULT_APP_LOGO_URL, version: "default" });
    }
    const stored = await prisma.appConfig.upsert({
      where: { key: APP_LOGO_CONFIG_KEY },
      create: { key: APP_LOGO_CONFIG_KEY, value: parsed.data.logoDataUrl },
      update: { value: parsed.data.logoDataUrl },
      select: { updatedAt: true }
    });
    return res.json({ ok: true, logoUrl: parsed.data.logoDataUrl, version: String(stored.updatedAt.getTime()) });
  });

  app.get("/api/admin/me", requireAuthenticated, (req, res) => {
    const admin = (req as AdminRequest).admin;
    return res.json({
      authenticated: true,
      userName: admin?.userName ?? "user",
      role: admin?.userRole ?? "VIEWER",
      mustChangePassword: Boolean(admin?.mustChangePassword),
      debugMode: getDebugMode(),
      debugModeMutable: canToggleDebugMode
    });
  });

  app.get("/api/admin/settings/debug", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (_req, res) => {
    return res.json({ debugMode: getDebugMode(), canToggle: canToggleDebugMode });
  });

  app.put("/api/admin/settings/debug", requireAuthenticated, requireRoles(["ADMIN"]), async (req, res) => {
    if (!canToggleDebugMode) return res.status(403).json({ error: "Debug mode cannot be changed in this environment" });
    const enabledRaw = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabledRaw !== "boolean") return res.status(400).json({ error: "Invalid payload" });
    const next = await setDebugMode(enabledRaw);
    return res.json({ ok: true, debugMode: next, canToggle: canToggleDebugMode });
  });

  app.get("/api/admin/ws-auth", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const admin = (req as AdminRequest).admin;
    if (!admin || (admin.userRole !== "ADMIN" && admin.userRole !== "BROADCASTER")) return res.status(401).json({ error: "Authentication required" });
    const token = jwt.sign(
      { kind: "ADMIN_WS", role: admin.userRole, sessionId, userId: admin.userId, sv: admin.tokenSessionVersion } satisfies AdminWsJwtPayload,
      JWT_SECRET,
      { expiresIn: ADMIN_WS_TOKEN_TTL_MINUTES * 60, algorithm: "HS256", issuer: JWT_ISSUER, subject: admin.userId ?? `legacy:${admin.userName}` }
    );
    return res.json({ token });
  });

  app.post("/api/admin/change-password", requireAuthenticated, async (req, res) => {
    const parsed = changeAdminPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

    const admin = (req as AdminRequest).admin;
    if (!admin) return res.status(401).json({ error: "Authentication required" });

    if (admin.authType === "user" && admin.userId) {
      const user = await prisma.user.findUnique({ where: { id: admin.userId } });
      if (!user) return res.status(401).json({ error: "Session invalid" });
      if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) return res.status(401).json({ error: "Current password is invalid" });
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12), mustChangePassword: false } });
      await bumpSessionVersion({ authType: "user", userId: user.id });
      clearAdminCookie(res);
      return res.json({ ok: true });
    }

    const effectiveHash = await getEffectiveAdminPasswordHash();
    if (!(await bcrypt.compare(parsed.data.currentPassword, effectiveHash))) return res.status(401).json({ error: "Current password is invalid" });
    await prisma.appConfig.upsert({
      where: { key: ADMIN_PASSWORD_CONFIG_KEY },
      create: { key: ADMIN_PASSWORD_CONFIG_KEY, value: await bcrypt.hash(parsed.data.newPassword, 12) },
      update: { value: await bcrypt.hash(parsed.data.newPassword, 12) }
    });
    await bumpSessionVersion({ authType: "legacy" });
    clearAdminCookie(res);
    return res.json({ ok: true });
  });
}
