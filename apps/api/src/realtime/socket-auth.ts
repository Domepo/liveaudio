import bcrypt from "bcryptjs";
import type { PrismaClient, Role } from "@prisma/client";
import type { Server } from "socket.io";

type AdminAuthContext = {
  authType: "legacy" | "user";
  userName: string;
  userRole: Role;
  userId?: string;
  tokenSessionVersion: number;
};

type ListenerSocketAuth = { role: "LISTENER"; sessionId: string };
type BroadcasterSocketAuth = { role: "BROADCASTER"; sessionId: string; userId?: string; userName: string };
type SocketAuthPayload = ListenerSocketAuth | BroadcasterSocketAuth;

type SocketAuthDeps = {
  io: Server;
  prisma: PrismaClient;
  readValidatedAdminFromCookieHeader: (cookieHeader?: string) => Promise<AdminAuthContext | null>;
  decodeAdminWsJwt: (rawToken?: string) => { kind: "ADMIN_WS"; role: Role; sessionId: string; userId?: string; sv: number } | null;
  isSessionVersionCurrent: (admin: Pick<AdminAuthContext, "authType" | "userId" | "tokenSessionVersion">) => Promise<boolean>;
  findActiveSessionByCode: (code: string) => Promise<{ id: string; broadcastCode: string | null; broadcastCodeHash: string | null } | null>;
  hasSessionAccess: (admin: AdminAuthContext, sessionId: string) => Promise<boolean>;
  getBroadcastOwner: (sessionId: string) => { socketId: string; userId?: string; userName: string; connectedAt: number } | null;
};

function isSameBroadcasterUser(
  currentOwner: { userId?: string; userName: string },
  incomingAdmin: { userId?: string; userName: string }
): boolean {
  if (currentOwner.userId && incomingAdmin.userId) return currentOwner.userId === incomingAdmin.userId;
  return currentOwner.userName.trim().toLowerCase() === incomingAdmin.userName.trim().toLowerCase();
}

export function registerSocketAuth(deps: SocketAuthDeps): void {
  const { io, prisma, readValidatedAdminFromCookieHeader, decodeAdminWsJwt, isSessionVersionCurrent, findActiveSessionByCode, hasSessionAccess, getBroadcastOwner } = deps;

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
        if (!session) return next(new Error("Invalid code"));
        socket.data.auth = { role: "LISTENER", sessionId: session.id } satisfies SocketAuthPayload;
        return next();
      }

      if (typeof sessionId !== "string") {
        next(new Error("Missing session"));
        return;
      }

      const adminCookieHeader = typeof socket.handshake.headers.cookie === "string" ? socket.handshake.headers.cookie : undefined;
      const adminCookieAuth = await readValidatedAdminFromCookieHeader(adminCookieHeader);
      const adminWsToken = typeof socket.handshake.auth?.adminWsToken === "string" ? socket.handshake.auth.adminWsToken : undefined;
      const adminWsAuthPayload = decodeAdminWsJwt(adminWsToken);

      let adminAuth: AdminAuthContext | null = adminCookieAuth;
      if (!adminAuth && adminWsAuthPayload) {
        if (adminWsAuthPayload.sessionId !== sessionId) return next(new Error("Session not found"));
        const fromWs = {
          authType: "user",
          userName: "socket",
          userRole: adminWsAuthPayload.role,
          userId: adminWsAuthPayload.userId,
          tokenSessionVersion: adminWsAuthPayload.sv
        } satisfies AdminAuthContext;
        if (!(await isSessionVersionCurrent(fromWs))) return next(new Error("Authentication required"));
        adminAuth = fromWs;
      }

      if (!adminAuth || (adminAuth.userRole !== "ADMIN" && adminAuth.userRole !== "BROADCASTER")) {
        return next(new Error("Authentication required"));
      }
      if (adminAuth.userRole === "BROADCASTER") {
        const allowed = await hasSessionAccess(adminAuth, sessionId);
        if (!allowed) return next(new Error("Session not found"));
      }

      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.status !== "ACTIVE") return next(new Error("Session not found"));

      const validCode =
        (typeof session.broadcastCode === "string" && session.broadcastCode === sessionCode) ||
        (typeof session.broadcastCodeHash === "string" && (await bcrypt.compare(sessionCode, session.broadcastCodeHash)));
      if (!validCode) return next(new Error("Invalid code"));

      const currentOwner = getBroadcastOwner(sessionId);
      if (currentOwner && !isSameBroadcasterUser(currentOwner, adminAuth)) {
        return next(new Error(`TAKEOVER_REQUIRED:${JSON.stringify({ ownerName: currentOwner.userName, startedAt: new Date(currentOwner.connectedAt).toISOString() })}`));
      }

      socket.data.auth = { role: "BROADCASTER", sessionId, userId: adminAuth.userId, userName: adminAuth.userName } satisfies SocketAuthPayload;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });
}
