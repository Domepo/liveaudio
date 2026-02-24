import fs from "node:fs";
import path from "node:path";

type TestToneState = "hearing" | "lost";

type ClientState = {
  clientId: string;
  channelId: string;
  state: TestToneState;
  updatedAt: number;
};

type TestToneEvent = {
  at: string;
  sessionId: string;
  clientId: string;
  channelId: string;
  state: TestToneState;
};

const MAX_EVENTS = 200;

type WatchdogLogEvent =
  | {
      at: string;
      type: "watchdog_report";
      sessionId: string;
      clientId: string;
      channelId: string;
      state: TestToneState;
      changed: boolean;
      previousState: TestToneState | null;
      previousUpdatedAt: string | null;
      sincePreviousMs: number | null;
    }
  | {
      at: string;
      type: "watchdog_client_removed";
      sessionId: string;
      clientId: string;
      previousState: TestToneState | null;
      previousChannelId: string | null;
      previousUpdatedAt: string | null;
      reason: "socket_disconnect_or_cleanup";
    }
  | {
      at: string;
      type: "watchdog_session_cleared";
      sessionId: string;
      removedClients: number;
      removedEvents: number;
      reason: "broadcast_stopped_or_cleanup";
    };

function createWatchdogFileLogger(): (event: WatchdogLogEvent) => void {
  const configuredPath = process.env.TESTTONE_WATCHDOG_LOG_FILE?.trim();
  const logPath = path.resolve(process.cwd(), configuredPath || "logs/testtone-watchdog.log");
  const logDir = path.dirname(logPath);
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    return () => {};
  }
  return (event: WatchdogLogEvent): void => {
    try {
      fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // ignore file system logging errors
    }
  };
}

export function createTestToneWatchdogStore() {
  const clientStateBySession = new Map<string, Map<string, ClientState>>();
  const eventsBySession = new Map<string, TestToneEvent[]>();
  const logEvent = createWatchdogFileLogger();

  function reportState(sessionId: string, clientId: string, channelId: string, state: TestToneState): void {
    const byClient = clientStateBySession.get(sessionId) ?? new Map<string, ClientState>();
    const prev = byClient.get(clientId);
    const nowMs = Date.now();
    const next: ClientState = { clientId, channelId, state, updatedAt: nowMs };
    byClient.set(clientId, next);
    clientStateBySession.set(sessionId, byClient);

    if (!prev || prev.state !== state) {
      const events = eventsBySession.get(sessionId) ?? [];
      events.push({ at: new Date().toISOString(), sessionId, clientId, channelId, state });
      while (events.length > MAX_EVENTS) events.shift();
      eventsBySession.set(sessionId, events);
    }

    logEvent({
      at: new Date(nowMs).toISOString(),
      type: "watchdog_report",
      sessionId,
      clientId,
      channelId,
      state,
      changed: !prev || prev.state !== state,
      previousState: prev?.state ?? null,
      previousUpdatedAt: typeof prev?.updatedAt === "number" ? new Date(prev.updatedAt).toISOString() : null,
      sincePreviousMs: typeof prev?.updatedAt === "number" ? Math.max(0, nowMs - prev.updatedAt) : null
    });
  }

  function removeClient(sessionId: string, clientId: string): void {
    const byClient = clientStateBySession.get(sessionId);
    if (!byClient) return;
    const prev = byClient.get(clientId);
    byClient.delete(clientId);
    if (byClient.size === 0) clientStateBySession.delete(sessionId);
    logEvent({
      at: new Date().toISOString(),
      type: "watchdog_client_removed",
      sessionId,
      clientId,
      previousState: prev?.state ?? null,
      previousChannelId: prev?.channelId ?? null,
      previousUpdatedAt: typeof prev?.updatedAt === "number" ? new Date(prev.updatedAt).toISOString() : null,
      reason: "socket_disconnect_or_cleanup"
    });
  }

  function clearSession(sessionId: string): void {
    const removedClients = clientStateBySession.get(sessionId)?.size ?? 0;
    const removedEvents = eventsBySession.get(sessionId)?.length ?? 0;
    clientStateBySession.delete(sessionId);
    eventsBySession.delete(sessionId);
    logEvent({
      at: new Date().toISOString(),
      type: "watchdog_session_cleared",
      sessionId,
      removedClients,
      removedEvents,
      reason: "broadcast_stopped_or_cleanup"
    });
  }

  function getSummary(sessionId: string): {
    totalClients: number;
    hearing: number;
    lost: number;
    events: TestToneEvent[];
  } {
    const byClient = clientStateBySession.get(sessionId);
    let hearing = 0;
    let lost = 0;
    if (byClient) {
      for (const state of byClient.values()) {
        if (state.state === "hearing") hearing += 1;
        if (state.state === "lost") lost += 1;
      }
    }
    return {
      totalClients: byClient?.size ?? 0,
      hearing,
      lost,
      events: [...(eventsBySession.get(sessionId) ?? [])].slice(-30).reverse()
    };
  }

  return { reportState, removeClient, clearSession, getSummary };
}

export type TestToneWatchdogStore = ReturnType<typeof createTestToneWatchdogStore>;
