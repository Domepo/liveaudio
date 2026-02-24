import axios from "axios";
import type { PrismaClient, Role } from "@prisma/client";
import type { Server } from "socket.io";
import { registerSocketAuth } from "./socket-auth";
import type { TestToneWatchdogStore } from "../services/testtone-watchdog";

type ListenerSocketAuth = { role: "LISTENER"; sessionId: string };
type BroadcasterSocketAuth = { role: "BROADCASTER"; sessionId: string; userId?: string; userName: string };
type SocketAuthPayload = ListenerSocketAuth | BroadcasterSocketAuth;
type SessionLiveMode = "none" | "mic" | "preshow" | "testtone";

type SocketDeps = {
  io: Server;
  prisma: PrismaClient;
  MEDIA_BASE_URL: string;
  MEDIA_INTERNAL_TOKEN: string;
  decodeAdminWsJwt: (rawToken?: string) => { kind: "ADMIN_WS"; role: Role; sessionId: string; userId?: string; sv: number } | null;
  readValidatedAdminFromCookieHeader: (cookieHeader?: string) => Promise<{
    authType: "legacy" | "user";
    userName: string;
    userRole: Role;
    userId?: string;
    tokenSessionVersion: number;
  } | null>;
  isSessionVersionCurrent: (admin: { authType: "legacy" | "user"; userId?: string; tokenSessionVersion: number }) => Promise<boolean>;
  findActiveSessionByCode: (code: string) => Promise<{ id: string; broadcastCode: string | null; broadcastCodeHash: string | null } | null>;
  hasSessionAccess: (admin: { authType: "legacy" | "user"; userName: string; userRole: Role; userId?: string }, sessionId: string) => Promise<boolean>;
  isListenerAuth: (auth: SocketAuthPayload) => auth is ListenerSocketAuth;
  addSocketToRoleMap: (map: Map<string, Set<string>>, sessionId: string, socketId: string) => void;
  removeSocketFromRoleMap: (map: Map<string, Set<string>>, sessionId: string, socketId: string) => void;
  changeLiveListenerCount: (sessionId: string, channelId: string, delta: number) => void;
  recordLiveSnapshot: (sessionId: string) => void;
  clearSessionAnalyticsState: (sessionId: string) => void;
  markSessionStatsSinceNow: (sessionId: string) => Promise<void>;
  recordAnalyticsPoint: (input: { sessionId: string; metric: string; value: number; channelId?: string }) => Promise<void>;
  getBroadcastOwner: (sessionId: string) => { socketId: string; userId?: string; userName: string; connectedAt: number } | null;
  getSessionLiveMode: (sessionId: string) => SessionLiveMode;
  setSessionLiveMode: (sessionId: string, mode: SessionLiveMode) => void;
  clearSessionLiveMode: (sessionId: string) => void;
  setBroadcastOwner: (sessionId: string, owner: { socketId: string; userId?: string; userName: string; connectedAt: number }) => void;
  clearBroadcastOwner: (sessionId: string) => void;
  getDebugMode: () => boolean;
  testToneWatchdogStore: TestToneWatchdogStore;
  listenerSocketsBySession: Map<string, Set<string>>;
  broadcasterSocketsBySession: Map<string, Set<string>>;
  listenerStateBySocket: Map<string, { sessionId: string; channelId?: string; joinedAt?: number }>;
};

export function registerSocketRealtime(deps: SocketDeps): void {
  const {
    io,
    prisma,
    MEDIA_BASE_URL,
    MEDIA_INTERNAL_TOKEN,
    decodeAdminWsJwt,
    readValidatedAdminFromCookieHeader,
    isSessionVersionCurrent,
    findActiveSessionByCode,
    hasSessionAccess,
    isListenerAuth,
    addSocketToRoleMap,
    removeSocketFromRoleMap,
    changeLiveListenerCount,
    recordLiveSnapshot,
    clearSessionAnalyticsState,
    markSessionStatsSinceNow,
    recordAnalyticsPoint,
    getBroadcastOwner,
    getSessionLiveMode,
    setSessionLiveMode,
    clearSessionLiveMode,
    setBroadcastOwner,
    clearBroadcastOwner,
    getDebugMode,
    testToneWatchdogStore,
    listenerSocketsBySession,
    broadcasterSocketsBySession,
    listenerStateBySocket
  } = deps;

  const mediaPost = async <T = unknown>(path: string, body: unknown): Promise<T> => {
    const headers = MEDIA_INTERNAL_TOKEN ? { Authorization: `Bearer ${MEDIA_INTERNAL_TOKEN}` } : undefined;
    const response = await axios.post<T>(`${MEDIA_BASE_URL}${path}`, body, { headers });
    return response.data;
  };

  registerSocketAuth({
    io,
    prisma,
    readValidatedAdminFromCookieHeader,
    decodeAdminWsJwt,
    isSessionVersionCurrent,
    findActiveSessionByCode,
    hasSessionAccess,
    getBroadcastOwner
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth as SocketAuthPayload;
    const socketIp = socket.handshake.address || null;
    const socketUserAgentHeader = socket.handshake.headers["user-agent"];
    const socketUserAgent = typeof socketUserAgentHeader === "string" ? socketUserAgentHeader : null;
    socket.join(`session:${auth.sessionId}`);

    if (auth.role === "LISTENER") {
      addSocketToRoleMap(listenerSocketsBySession, auth.sessionId, socket.id);
      listenerStateBySocket.set(socket.id, { sessionId: auth.sessionId });
      recordLiveSnapshot(auth.sessionId);
      socket.emit("broadcast:liveModeChanged", { sessionId: auth.sessionId, mode: getSessionLiveMode(auth.sessionId) });
    } else {
      setBroadcastOwner(auth.sessionId, { socketId: socket.id, userId: auth.userId, userName: auth.userName, connectedAt: Date.now() });
      io.to(`session:${auth.sessionId}`).emit("broadcast:ownershipChanged", {
        sessionId: auth.sessionId,
        ownerName: auth.userName,
        ownerUserId: auth.userId,
        startedAt: new Date().toISOString()
      });
      const hadBroadcaster = (broadcasterSocketsBySession.get(auth.sessionId)?.size ?? 0) > 0;
      addSocketToRoleMap(broadcasterSocketsBySession, auth.sessionId, socket.id);
      if (!hadBroadcaster) {
        void (async () => {
          await markSessionStatsSinceNow(auth.sessionId);
          await prisma.accessLog.deleteMany({ where: { sessionId: auth.sessionId } });
          clearSessionAnalyticsState(auth.sessionId);
          await recordAnalyticsPoint({ sessionId: auth.sessionId, metric: "events_broadcast_start", value: 1 });
        })().catch(() => undefined);
      }
    }

    socket.on("disconnect", () => {
      if (auth.role === "LISTENER") {
        void mediaPost("/clients/disconnect", { clientId: socket.id }).catch(() => undefined);
      }

      if (auth.role === "LISTENER") {
        const state = listenerStateBySocket.get(socket.id);
        if (state?.channelId) {
          changeLiveListenerCount(auth.sessionId, state.channelId, -1);
          const durationMs = state.joinedAt ? Math.max(0, Date.now() - state.joinedAt) : 0;
          void prisma.accessLog
            .create({
              data: { sessionId: auth.sessionId, channelId: state.channelId, eventType: "LISTENER_LEAVE", success: true, reason: `durationMs=${durationMs}`, ip: socketIp, userAgent: socketUserAgent }
            })
            .catch(() => {});
          void recordAnalyticsPoint({ sessionId: auth.sessionId, channelId: state.channelId, metric: "events_listener_leave", value: 1 });
        }
        listenerStateBySocket.delete(socket.id);
        testToneWatchdogStore.removeClient(auth.sessionId, socket.id);
        removeSocketFromRoleMap(listenerSocketsBySession, auth.sessionId, socket.id);
        recordLiveSnapshot(auth.sessionId);
      } else {
        removeSocketFromRoleMap(broadcasterSocketsBySession, auth.sessionId, socket.id);
        const currentOwner = getBroadcastOwner(auth.sessionId);
        if (currentOwner?.socketId === socket.id) {
          clearBroadcastOwner(auth.sessionId);
          io.to(`session:${auth.sessionId}`).emit("broadcast:ownerDisconnected", { sessionId: auth.sessionId });
        }
        if ((broadcasterSocketsBySession.get(auth.sessionId)?.size ?? 0) === 0) {
          clearSessionLiveMode(auth.sessionId);
          testToneWatchdogStore.clearSession(auth.sessionId);
          io.to(`session:${auth.sessionId}`).emit("broadcast:liveModeChanged", { sessionId: auth.sessionId, mode: "none" });
          void recordAnalyticsPoint({ sessionId: auth.sessionId, metric: "events_broadcast_stop", value: 1 });
        }
      }
    });

    socket.on("session:getRtpCapabilities", async (_payload, cb) => {
      try {
        cb((await mediaPost("/listeners/join", { clientId: socket.id, sessionId: auth.sessionId })));
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        cb({ error: status ? `Failed to get RTP capabilities (${status})` : "Failed to get RTP capabilities" });
      }
    });

    socket.on("listener:joinSession", async ({ channelId }, cb) => {
      if (!isListenerAuth(auth)) return cb({ error: "Forbidden" });
      try {
        const state = listenerStateBySocket.get(socket.id) ?? { sessionId: auth.sessionId };
        if (state.channelId && state.channelId !== channelId) {
          changeLiveListenerCount(auth.sessionId, state.channelId, -1);
          const durationMs = state.joinedAt ? Math.max(0, Date.now() - state.joinedAt) : 0;
          void prisma.accessLog
            .create({ data: { sessionId: auth.sessionId, channelId: state.channelId, eventType: "LISTENER_LEAVE", success: true, reason: `durationMs=${durationMs}`, ip: socketIp, userAgent: socketUserAgent } })
            .catch(() => {});
        }
        if (state.channelId !== channelId) changeLiveListenerCount(auth.sessionId, channelId, 1);
        state.channelId = channelId;
        state.joinedAt = Date.now();
        listenerStateBySocket.set(socket.id, state);
        recordLiveSnapshot(auth.sessionId);
        const response = await mediaPost("/listeners/join", { clientId: socket.id, sessionId: auth.sessionId, channelId });
        void prisma.accessLog.create({ data: { sessionId: auth.sessionId, channelId, eventType: "LISTENER_JOIN", success: true, ip: socketIp, userAgent: socketUserAgent } }).catch(() => {});
        void recordAnalyticsPoint({ sessionId: auth.sessionId, channelId, metric: "events_listener_join", value: 1 });
        cb(response);
      } catch {
        cb({ error: "Media join failed" });
      }
    });

    socket.on("broadcaster:createTransport", async ({ sessionId, channelId }, cb) => {
      if (auth.role !== "BROADCASTER") return cb({ error: "Forbidden" });
      if (auth.sessionId !== sessionId) return cb({ error: "Invalid session" });
      const owner = getBroadcastOwner(sessionId);
      if (!owner || owner.socketId !== socket.id) return cb({ error: "Takeover required" });
      try {
        cb(await mediaPost("/broadcasters/transport", { clientId: socket.id, sessionId, channelId }));
      } catch {
        cb({ error: "Transport create failed" });
      }
    });

    socket.on("listener:createTransport", async ({ channelId }, cb) => {
      if (!isListenerAuth(auth)) return cb({ error: "Forbidden" });
      try {
        cb(await mediaPost("/listeners/transport", { clientId: socket.id, sessionId: auth.sessionId, channelId }));
      } catch {
        cb({ error: "Transport create failed" });
      }
    });

    socket.on("transport:connect", async ({ transportId, dtlsParameters }, cb) => {
      try {
        cb(await mediaPost("/transports/connect", { clientId: socket.id, transportId, dtlsParameters }));
      } catch {
        cb({ error: "Transport connect failed" });
      }
    });

    socket.on("broadcaster:produce", async ({ transportId, sessionId, channelId, rtpParameters }, cb) => {
      if (auth.role !== "BROADCASTER") return cb({ error: "Forbidden" });
      if (auth.sessionId !== sessionId) return cb({ error: "Invalid session" });
      const owner = getBroadcastOwner(sessionId);
      if (!owner || owner.socketId !== socket.id) return cb({ error: "Takeover required" });
      try {
        const response = await mediaPost<{ producerId: string }>("/broadcasters/produce", { clientId: socket.id, transportId, sessionId, channelId, kind: "audio", rtpParameters });
        io.to(`session:${sessionId}`).emit("channel:producerAvailable", { channelId });
        cb(response);
      } catch {
        cb({ error: "Produce failed" });
      }
    });

    socket.on("broadcast:setLiveMode", ({ sessionId, mode }, cb) => {
      if (auth.role !== "BROADCASTER") return cb({ error: "Forbidden" });
      if (auth.sessionId !== sessionId) return cb({ error: "Invalid session" });
      const owner = getBroadcastOwner(sessionId);
      if (!owner || owner.socketId !== socket.id) return cb({ error: "Takeover required" });
      const normalizedMode: SessionLiveMode = mode === "mic" || mode === "preshow" || mode === "testtone" ? mode : "none";
      setSessionLiveMode(sessionId, normalizedMode);
      io.to(`session:${sessionId}`).emit("broadcast:liveModeChanged", { sessionId, mode: normalizedMode });
      cb({ ok: true });
    });

    socket.on("listener:testToneState", ({ channelId, state }, cb) => {
      if (!isListenerAuth(auth)) return cb?.({ error: "Forbidden" });
      if (!getDebugMode()) return cb?.({ ok: true });
      const normalizedState = state === "lost" ? "lost" : "hearing";
      const normalizedChannelId = typeof channelId === "string" ? channelId : "";
      testToneWatchdogStore.reportState(auth.sessionId, socket.id, normalizedChannelId, normalizedState);
      io.to(`session:${auth.sessionId}`).emit("debug:testToneState", {
        sessionId: auth.sessionId,
        clientId: socket.id,
        channelId: normalizedChannelId,
        state: normalizedState,
        at: new Date().toISOString()
      });
      cb?.({ ok: true });
    });

    socket.on("listener:consume", async ({ transportId, sessionId, channelId, rtpCapabilities }, cb) => {
      if (!isListenerAuth(auth)) return cb({ error: "Forbidden" });
      if (sessionId !== auth.sessionId) return cb({ error: "Forbidden" });
      const listenerState = listenerStateBySocket.get(socket.id);
      if (!listenerState?.channelId || listenerState.channelId !== channelId) return cb({ error: "Forbidden" });
      try {
        const response = await mediaPost<{ consumerId: string; producerId: string; kind: string; rtpParameters: unknown; type: string }>("/listeners/consume", {
          clientId: socket.id,
          transportId,
          sessionId,
          channelId,
          rtpCapabilities
        });
        void prisma.accessLog.create({ data: { sessionId: auth.sessionId, channelId, eventType: "LISTENER_CONSUME", success: true, ip: socketIp, userAgent: socketUserAgent } }).catch(() => {});
        void recordAnalyticsPoint({ sessionId: auth.sessionId, channelId, metric: "events_listener_consume", value: 1 });
        cb(response);
      } catch {
        cb({ error: "Consume failed" });
      }
    });

    socket.on("consumer:resume", async ({ consumerId }, cb) => {
      try {
        cb(await mediaPost("/consumers/resume", { clientId: socket.id, consumerId }));
      } catch {
        cb({ error: "Resume failed" });
      }
    });
  });
}
