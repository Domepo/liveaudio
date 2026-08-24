import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BROADCASTER_DISCONNECT_GRACE_MS, registerSocketRealtime } from "../realtime/socket";

vi.mock("axios", () => ({
  default: {
    post: vi.fn()
  }
}));

describe("broadcaster media cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps broadcaster transports during the reconnect grace period, then closes them", async () => {
    const socketHandlers = new Map<string, (...args: any[]) => unknown>();
    const socket = {
      id: "broadcaster-socket-1",
      data: {
        auth: {
          role: "BROADCASTER",
          sessionId: "session-1",
          userId: "user-1",
          userName: "Admin"
        }
      },
      handshake: { address: "127.0.0.1", headers: {}, auth: {} },
      join: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        socketHandlers.set(event, handler);
      })
    };

    let connectionHandler: ((connectedSocket: typeof socket) => void) | undefined;
    const roomEmit = vi.fn();
    const io = {
      use: vi.fn(),
      on: vi.fn((event: string, handler: (connectedSocket: typeof socket) => void) => {
        if (event === "connection") connectionHandler = handler;
      }),
      to: vi.fn(() => ({ emit: roomEmit }))
    };

    const broadcasterSocketsBySession = new Map<string, Set<string>>();
    let broadcastOwner: { socketId: string; userId?: string; userName: string; connectedAt: number } | null = null;

    vi.mocked(axios.post).mockResolvedValue({ data: { closedTransports: 1 } });

    registerSocketRealtime({
      io: io as any,
      prisma: { accessLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } } as any,
      MEDIA_BASE_URL: "http://media:4000",
      MEDIA_INTERNAL_TOKEN: "internal-token",
      decodeAdminWsJwt: vi.fn(),
      readValidatedAdminFromCookieHeader: vi.fn(),
      isSessionVersionCurrent: vi.fn(),
      findActiveSessionByCode: vi.fn(),
      hasSessionAccess: vi.fn(),
      isListenerAuth: (auth): auth is { role: "LISTENER"; sessionId: string } => auth.role === "LISTENER",
      addSocketToRoleMap: (map, sessionId, socketId) => {
        const sockets = map.get(sessionId) ?? new Set<string>();
        sockets.add(socketId);
        map.set(sessionId, sockets);
      },
      removeSocketFromRoleMap: (map, sessionId, socketId) => {
        const sockets = map.get(sessionId);
        sockets?.delete(socketId);
        if (sockets?.size === 0) map.delete(sessionId);
      },
      changeLiveListenerCount: vi.fn(),
      recordLiveSnapshot: vi.fn(),
      clearSessionAnalyticsState: vi.fn(),
      markSessionStatsSinceNow: vi.fn().mockResolvedValue(undefined),
      recordAnalyticsPoint: vi.fn().mockResolvedValue(undefined),
      getBroadcastOwner: () => broadcastOwner,
      getSessionLiveMode: vi.fn((_sessionId: string): "none" => "none"),
      setSessionLiveMode: vi.fn(),
      clearSessionLiveMode: vi.fn(),
      setBroadcastOwner: (_sessionId, owner) => {
        broadcastOwner = owner;
      },
      clearBroadcastOwner: () => {
        broadcastOwner = null;
      },
      getDebugMode: vi.fn(() => false),
      testToneWatchdogStore: { clearSession: vi.fn() } as any,
      listenerSocketsBySession: new Map(),
      broadcasterSocketsBySession,
      listenerStateBySocket: new Map()
    });

    expect(connectionHandler).toBeTypeOf("function");
    connectionHandler!(socket);
    expect(socketHandlers.get("disconnect")).toBeTypeOf("function");

    socketHandlers.get("disconnect")!();

    expect(axios.post).not.toHaveBeenCalledWith(
      "http://media:4000/clients/disconnect",
      { clientId: "broadcaster-socket-1" },
      { headers: { Authorization: "Bearer internal-token" } }
    );

    await vi.advanceTimersByTimeAsync(BROADCASTER_DISCONNECT_GRACE_MS);

    expect(axios.post).toHaveBeenCalledWith(
      "http://media:4000/clients/disconnect",
      { clientId: "broadcaster-socket-1" },
      { headers: { Authorization: "Bearer internal-token" } }
    );
  });
});
