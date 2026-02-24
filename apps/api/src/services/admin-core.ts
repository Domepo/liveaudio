import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient, Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";

export type AdminAuthContext = {
  authType: "legacy" | "user";
  userName: string;
  userRole: Role;
  userId?: string;
  mustChangePassword?: boolean;
  tokenSessionVersion: number;
  tokenIssuedAtMs?: number;
  tokenExpiresAtMs?: number;
};

type AdminJwtPayload = {
  role: Role;
  authType: "legacy" | "user";
  userName: string;
  userId?: string;
  sv: number;
};

export type AdminWsJwtPayload = {
  kind: "ADMIN_WS";
  role: Role;
  sessionId: string;
  userId?: string;
  sv: number;
};

type AdminCoreDeps = {
  prisma: PrismaClient;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  ADMIN_SESSION_COOKIE: string;
  ADMIN_SESSION_TTL_HOURS: number;
  ADMIN_SESSION_REFRESH_THRESHOLD_MINUTES: number;
  ADMIN_LOGIN_NAME: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_LOGIN_NAME_CONFIG_KEY: string;
  ADMIN_PASSWORD_CONFIG_KEY: string;
  APP_LOGO_CONFIG_KEY: string;
  DEFAULT_APP_LOGO_URL: string;
};

export function createAdminCore(deps: AdminCoreDeps) {
  const {
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
  } = deps;

  const SESSION_VERSION_KEY_PREFIX = "AUTH_SESSION_VERSION:";
  const LEGACY_SESSION_VERSION_KEY = "AUTH_SESSION_VERSION:LEGACY";

  function getSessionVersionConfigKey(input: { authType: "legacy" | "user"; userId?: string }): string {
    if (input.authType === "legacy") return LEGACY_SESSION_VERSION_KEY;
    if (!input.userId) return LEGACY_SESSION_VERSION_KEY;
    return `${SESSION_VERSION_KEY_PREFIX}${input.userId}`;
  }

  async function getSessionVersion(input: { authType: "legacy" | "user"; userId?: string }): Promise<number> {
    const key = getSessionVersionConfigKey(input);
    const config = await prisma.appConfig.findUnique({ where: { key }, select: { value: true } });
    const value = Number(config?.value ?? "0");
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  async function bumpSessionVersion(input: { authType: "legacy" | "user"; userId?: string }): Promise<number> {
    const key = getSessionVersionConfigKey(input);
    const current = await getSessionVersion(input);
    const next = current + 1;
    await prisma.appConfig.upsert({
      where: { key },
      create: { key, value: String(next) },
      update: { value: String(next) }
    });
    return next;
  }

  function setAdminCookie(res: Response, token: string): void {
    res.cookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000
    });
  }

  function clearAdminCookie(res: Response): void {
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }

  function parseCookies(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) return {};
    const out: Record<string, string> = {};
    for (const pair of cookieHeader.split(";")) {
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
    return out;
  }

  function decodeAdminJwt(rawToken?: string): AdminAuthContext | null {
    if (!rawToken || typeof rawToken !== "string") return null;
    try {
      const payload = jwt.verify(rawToken, JWT_SECRET, { issuer: JWT_ISSUER, algorithms: ["HS256"] }) as AdminJwtPayload & jwt.JwtPayload;
      if (!["ADMIN", "BROADCASTER", "VIEWER"].includes(payload.role)) return null;
      return {
        authType: payload.authType,
        userName: payload.userName,
        userRole: payload.role,
        userId: payload.userId,
        tokenSessionVersion: typeof payload.sv === "number" && Number.isFinite(payload.sv) ? payload.sv : 0,
        tokenIssuedAtMs: typeof payload.iat === "number" ? payload.iat * 1000 : undefined,
        tokenExpiresAtMs: typeof payload.exp === "number" ? payload.exp * 1000 : undefined
      };
    } catch {
      return null;
    }
  }

  function decodeAdminWsJwt(rawToken?: string): AdminWsJwtPayload | null {
    if (!rawToken || typeof rawToken !== "string") return null;
    try {
      const payload = jwt.verify(rawToken, JWT_SECRET, { issuer: JWT_ISSUER, algorithms: ["HS256"] }) as AdminWsJwtPayload;
      if (payload.kind !== "ADMIN_WS" || !["ADMIN", "BROADCASTER"].includes(payload.role)) return null;
      if (typeof payload.sessionId !== "string" || !payload.sessionId) return null;
      if (typeof payload.sv !== "number" || !Number.isFinite(payload.sv) || payload.sv < 0) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function readAdminFromRequestCookie(req: Request): AdminAuthContext | null {
    return decodeAdminJwt(parseCookies(req.headers.cookie)[ADMIN_SESSION_COOKIE]);
  }

  async function isSessionVersionCurrent(admin: Pick<AdminAuthContext, "authType" | "userId" | "tokenSessionVersion">): Promise<boolean> {
    const currentVersion = await getSessionVersion({ authType: admin.authType, userId: admin.userId });
    return admin.tokenSessionVersion === currentVersion;
  }

  async function readValidatedAdminFromCookieHeader(cookieHeader?: string): Promise<AdminAuthContext | null> {
    const admin = decodeAdminJwt(parseCookies(cookieHeader)[ADMIN_SESSION_COOKIE]);
    if (!admin) return null;
    if (!(await isSessionVersionCurrent(admin))) return null;
    return admin;
  }

  async function hasSessionAccess(admin: AdminAuthContext, sessionId: string): Promise<boolean> {
    if (admin.userRole === "ADMIN") return true;
    if (admin.userRole !== "BROADCASTER") return true;
    if (!admin.userId) return false;
    return Boolean(
      await prisma.sessionUserAccess.findUnique({ where: { sessionId_userId: { sessionId, userId: admin.userId } }, select: { id: true } })
    );
  }

  async function ensureSessionAccessOr404(req: Request, res: Response, sessionId: string): Promise<boolean> {
    const admin = (req as Request & { admin?: AdminAuthContext }).admin;
    if (!admin) return (res.status(401).json({ error: "Authentication required" }), false);
    if (!(await hasSessionAccess(admin, sessionId))) return (res.status(404).json({ error: "Session not found" }), false);
    return true;
  }

  async function getAccessibleSessionIds(admin: AdminAuthContext): Promise<string[]> {
    if (admin.userRole === "ADMIN" || admin.userRole === "VIEWER") {
      return (await prisma.session.findMany({ where: { status: "ACTIVE" }, select: { id: true } })).map((session) => session.id);
    }
    if (!admin.userId) return [];
    return (await prisma.sessionUserAccess.findMany({ where: { userId: admin.userId, session: { status: "ACTIVE" } }, select: { sessionId: true } })).map(
      (entry) => entry.sessionId
    );
  }

  async function resolveExistingUserId(userId?: string): Promise<string | undefined> {
    if (!userId) return undefined;
    return (await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))?.id;
  }

  function requireAuthenticated(req: Request, res: Response, next: NextFunction): void {
    void (async () => {
      const admin = await readValidatedAdminFromCookieHeader(req.headers.cookie);
      if (!admin) return void res.status(401).json({ error: "Authentication required" });
      if (admin.authType === "user" && admin.userId) {
        const user = await prisma.user.findUnique({ where: { id: admin.userId }, select: { mustChangePassword: true } });
        if (!user) return void res.status(401).json({ error: "Authentication required" });
        admin.mustChangePassword = Boolean(user.mustChangePassword);
        const passwordChangeExemptPaths = new Set(["/api/admin/me", "/api/admin/logout", "/api/admin/change-password"]);
        if (admin.mustChangePassword && !passwordChangeExemptPaths.has(req.path)) {
          return void res.status(403).json({ error: "Password change required", code: "PASSWORD_CHANGE_REQUIRED" });
        }
      }
      if (typeof admin.tokenExpiresAtMs === "number" && Number.isFinite(admin.tokenExpiresAtMs)) {
        const timeLeftMs = admin.tokenExpiresAtMs - Date.now();
        if (timeLeftMs > 0 && timeLeftMs < ADMIN_SESSION_REFRESH_THRESHOLD_MINUTES * 60 * 1000) {
          const refreshedToken = jwt.sign(
            {
              role: admin.userRole,
              authType: admin.authType,
              userName: admin.userName,
              userId: admin.userId,
              sv: admin.tokenSessionVersion
            } satisfies AdminJwtPayload,
            JWT_SECRET,
            {
              expiresIn: ADMIN_SESSION_TTL_HOURS * 60 * 60,
              algorithm: "HS256",
              issuer: JWT_ISSUER,
              subject: admin.userId ?? `legacy:${normalizeForLookup(admin.userName)}`
            }
          );
          setAdminCookie(res, refreshedToken);
        }
      }
      (req as Request & { admin?: AdminAuthContext }).admin = admin;
      next();
    })().catch(() => {
      res.status(401).json({ error: "Authentication required" });
    });
  }

  function requireRoles(allowed: Role[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const auth = (req as Request & { admin?: AdminAuthContext }).admin;
      if (!auth) return void res.status(401).json({ error: "Authentication required" });
      if (!allowed.includes(auth.userRole)) return void res.status(403).json({ error: "Insufficient permissions" });
      next();
    };
  }

  function normalizeForLookup(value: string): string {
    return value.trim().toLowerCase();
  }

  function buildPseudoEmailFromName(name: string): string {
    const base = name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 40) || "user";
    return `${base}-${Math.random().toString(36).slice(2, 8)}@local.admin`;
  }

  async function getEffectiveAdminPasswordHash(): Promise<string> {
    const config = await prisma.appConfig.findUnique({ where: { key: ADMIN_PASSWORD_CONFIG_KEY }, select: { value: true } });
    return config?.value ?? ADMIN_PASSWORD_HASH;
  }

  async function getEffectiveAdminLoginName(): Promise<string> {
    const config = await prisma.appConfig.findUnique({ where: { key: ADMIN_LOGIN_NAME_CONFIG_KEY }, select: { value: true } });
    return (config?.value ?? ADMIN_LOGIN_NAME).trim();
  }

  async function getAppLogoBranding(): Promise<{ logoUrl: string; version: string }> {
    const config = await prisma.appConfig.findUnique({ where: { key: APP_LOGO_CONFIG_KEY }, select: { value: true, updatedAt: true } });
    if (!config?.value) return { logoUrl: DEFAULT_APP_LOGO_URL, version: "default" };
    return { logoUrl: config.value, version: String(config.updatedAt.getTime()) };
  }

  async function generateUniqueSessionCode(excludeSessionId?: string): Promise<string> {
    const legacyHashSessions = await prisma.session.findMany({ where: { broadcastCode: null, broadcastCodeHash: { not: null } }, select: { id: true, broadcastCodeHash: true } });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await prisma.session.findFirst({ where: { broadcastCode: candidate, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) }, select: { id: true } });
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

  return {
    setAdminCookie,
    clearAdminCookie,
    parseCookies,
    decodeAdminJwt,
    decodeAdminWsJwt,
    readAdminFromRequestCookie,
    readValidatedAdminFromCookieHeader,
    isSessionVersionCurrent,
    getSessionVersion,
    bumpSessionVersion,
    hasSessionAccess,
    ensureSessionAccessOr404,
    getAccessibleSessionIds,
    resolveExistingUserId,
    requireAuthenticated,
    requireRoles,
    normalizeForLookup,
    buildPseudoEmailFromName,
    getEffectiveAdminPasswordHash,
    getEffectiveAdminLoginName,
    getAppLogoBranding,
    generateUniqueSessionCode
  };
}
