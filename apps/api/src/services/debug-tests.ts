import { io as ioClient, type Socket } from "socket.io-client";

type DebugTestType = "load" | "webrtc";
type DebugTestStatus = "queued" | "running" | "stopping" | "finished" | "failed";
type EventLevel = "info" | "warn" | "error";

type DebugTestEvent = {
  at: string;
  message: string;
  level?: EventLevel;
  category?: string;
  clientId?: string;
  code?: string;
  data?: Record<string, unknown>;
};

type LoadTestConfig = {
  targetUrl: string;
  vus: number;
  durationSec: number;
  rampUpSec: number;
  requestIntervalMs: number;
};

type WebRtcChurnConfig = {
  enabled: boolean;
  intervalSec: number;
  leavePercent: number;
  rejoinDelayMinMs: number;
  rejoinDelayMaxMs: number;
};

type WebRtcTestConfig = {
  apiOrigin: string;
  sessionCode: string;
  channelId: string;
  clients: number;
  durationSec: number;
  rampUpSec: number;
  reconnect: boolean;
  churn: WebRtcChurnConfig;
};

type DebugTestConfig = LoadTestConfig | WebRtcTestConfig;

type DebugTestRun = {
  id: string;
  type: DebugTestType;
  status: DebugTestStatus;
  startedAt: string;
  endedAt: string | null;
  config: DebugTestConfig;
  summary: Record<string, unknown>;
  events: DebugTestEvent[];
};

type LoadMetrics = {
  requestsTotal: number;
  requestsFailed: number;
  activeWorkers: number;
  latencyMsP95: number;
};

type WebRtcMetrics = {
  targetClients: number;
  connectedClients: number;
  joinedClients: number;
  failedJoins: number;
  disconnects: number;
  reconnects: number;
  avgConnectionSeconds: number;
  eventsTotal: number;
  churnCycles: number;
  churnLeaves: number;
  churnRejoins: number;
  disconnectReasons: Record<string, number>;
};

type ActiveRun = {
  run: DebugTestRun;
  stop: () => void;
  getMetrics: () => LoadMetrics | WebRtcMetrics;
};

type StartLoadInput = {
  targetUrl: string;
  vus: number;
  durationSec: number;
  rampUpSec: number;
  requestIntervalMs: number;
};

type StartWebRtcInput = {
  apiOrigin: string;
  sessionCode: string;
  channelId: string;
  clients: number;
  durationSec: number;
  rampUpSec: number;
  reconnect: boolean;
  churn: WebRtcChurnConfig;
};

const MAX_EVENTS_PER_RUN = 10_000;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const seed = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${seed}`;
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1));
  return Number(sorted[idx].toFixed(2));
}

function appendEvent(
  run: DebugTestRun,
  event: Omit<DebugTestEvent, "at"> & { at?: string }
): void {
  run.events.push({
    at: event.at ?? nowIso(),
    message: event.message,
    level: event.level ?? "info",
    category: event.category,
    clientId: event.clientId,
    code: event.code,
    data: event.data
  });
  if (run.events.length > MAX_EVENTS_PER_RUN) {
    run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
  }
}

export function parseDurationToSeconds(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    const normalized = Math.floor(input);
    return normalized > 0 ? normalized : null;
  }
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const sec = Number(raw);
    return Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : null;
  }
  const tokenRegex = /(\d+)\s*(h|m|s)/g;
  let totalSec = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(raw)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit === "h") totalSec += value * 3600;
    if (unit === "m") totalSec += value * 60;
    if (unit === "s") totalSec += value;
    consumed += match[0];
  }
  if (totalSec <= 0) return null;
  if (consumed.replace(/\s+/g, "") !== raw.replace(/\s+/g, "")) return null;
  return totalSec;
}

export function createDebugTestManager() {
  const runs = new Map<string, DebugTestRun>();
  let active: ActiveRun | null = null;

  function finalizeRun(run: DebugTestRun, status: DebugTestStatus, summary: Record<string, unknown>): void {
    run.status = status;
    run.endedAt = nowIso();
    run.summary = summary;
    runs.set(run.id, run);
  }

  function startLoadTest(input: StartLoadInput): DebugTestRun {
    if (active) throw new Error("Ein Testlauf ist bereits aktiv.");
    const run: DebugTestRun = {
      id: makeId("load"),
      type: "load",
      status: "running",
      startedAt: nowIso(),
      endedAt: null,
      config: {
        targetUrl: input.targetUrl,
        vus: input.vus,
        durationSec: input.durationSec,
        rampUpSec: input.rampUpSec,
        requestIntervalMs: input.requestIntervalMs
      },
      summary: {},
      events: []
    };
    appendEvent(run, { category: "run.started", message: `Loadtest gestartet (${input.vus} VUs)` });
    runs.set(run.id, run);

    let stopping = false;
    let requestsTotal = 0;
    let requestsFailed = 0;
    let activeWorkers = 0;
    const latencies: number[] = [];
    const workerTimers: NodeJS.Timeout[] = [];
    const timeoutHandles: NodeJS.Timeout[] = [];
    const startAtMs = Date.now();
    const endAtMs = startAtMs + input.durationSec * 1000;

    const stop = () => {
      if (stopping) return;
      stopping = true;
      run.status = "stopping";
      for (const timer of workerTimers) clearInterval(timer);
      for (const timeout of timeoutHandles) clearTimeout(timeout);
      workerTimers.length = 0;
      timeoutHandles.length = 0;
      const summary = {
        requestsTotal,
        requestsFailed,
        failureRate: requestsTotal > 0 ? Number((requestsFailed / requestsTotal).toFixed(4)) : 0,
        latencyMsP95: percentile95(latencies),
        eventsTotal: run.events.length
      };
      appendEvent(run, { category: "run.finished", message: "Loadtest beendet." });
      finalizeRun(run, "finished", summary);
      active = null;
    };

    const requestOnce = async (): Promise<void> => {
      const t0 = Date.now();
      try {
        const response = await fetch(input.targetUrl, { method: "GET" });
        requestsTotal += 1;
        if (!response.ok) {
          requestsFailed += 1;
          appendEvent(run, {
            level: "warn",
            category: "load.request.failed",
            code: `HTTP_${response.status}`,
            message: `Request fehlgeschlagen (${response.status}).`
          });
        }
      } catch (error) {
        requestsTotal += 1;
        requestsFailed += 1;
        appendEvent(run, {
          level: "error",
          category: "load.request.error",
          message: `Request-Fehler: ${error instanceof Error ? error.message : "unknown"}`
        });
      } finally {
        const dt = Date.now() - t0;
        if (latencies.length >= 5000) latencies.shift();
        latencies.push(dt);
      }
    };

    const startWorker = (): void => {
      activeWorkers += 1;
      void requestOnce();
      const timer = setInterval(() => {
        if (stopping || Date.now() >= endAtMs) {
          clearInterval(timer);
          activeWorkers = Math.max(0, activeWorkers - 1);
          if (activeWorkers === 0) stop();
          return;
        }
        void requestOnce();
      }, input.requestIntervalMs);
      workerTimers.push(timer);
    };

    const rampWindowMs = Math.max(0, input.rampUpSec * 1000);
    for (let i = 0; i < input.vus; i += 1) {
      const delayMs = rampWindowMs <= 0 ? 0 : Math.floor((rampWindowMs * i) / input.vus);
      const timeout = setTimeout(() => {
        if (stopping || Date.now() >= endAtMs) return;
        startWorker();
      }, delayMs);
      timeoutHandles.push(timeout);
    }

    const hardStopTimer = setTimeout(() => stop(), input.durationSec * 1000 + Math.max(1000, input.rampUpSec * 250));

    active = {
      run,
      stop: () => {
        clearTimeout(hardStopTimer);
        stop();
      },
      getMetrics: () => ({
        requestsTotal,
        requestsFailed,
        activeWorkers,
        latencyMsP95: percentile95(latencies)
      })
    };

    return run;
  }

  function startWebRtcTest(input: StartWebRtcInput): DebugTestRun {
    if (active) throw new Error("Ein Testlauf ist bereits aktiv.");
    const run: DebugTestRun = {
      id: makeId("webrtc"),
      type: "webrtc",
      status: "running",
      startedAt: nowIso(),
      endedAt: null,
      config: {
        apiOrigin: input.apiOrigin,
        sessionCode: input.sessionCode,
        channelId: input.channelId,
        clients: input.clients,
        durationSec: input.durationSec,
        rampUpSec: input.rampUpSec,
        reconnect: input.reconnect,
        churn: input.churn
      },
      summary: {},
      events: []
    };
    appendEvent(run, { category: "run.started", message: `WebRTC-Soak gestartet (${input.clients} Clients)` });
    runs.set(run.id, run);

    let stopping = false;
    let connectedClients = 0;
    let joinedClients = 0;
    let failedJoins = 0;
    let disconnects = 0;
    let reconnects = 0;
    let totalConnectionMs = 0;
    let disconnectEventsWithDuration = 0;
    let churnCycles = 0;
    let churnLeaves = 0;
    let churnRejoins = 0;

    const disconnectReasons = new Map<string, number>();
    const socketByClientId = new Map<string, Socket>();
    const connectedAtByClientId = new Map<string, number>();
    const plannedChurnDrop = new Set<string>();
    const timeoutHandles: NodeJS.Timeout[] = [];
    const intervalHandles: NodeJS.Timeout[] = [];
    const endAtMs = Date.now() + input.durationSec * 1000;
    let nextClientIndex = 0;

    const incrementReason = (reason: string) => {
      const key = reason || "unknown";
      disconnectReasons.set(key, (disconnectReasons.get(key) ?? 0) + 1);
    };

    const shutdownAllSockets = (): void => {
      for (const socket of socketByClientId.values()) {
        try {
          socket.disconnect();
        } catch {
          // no-op
        }
      }
      socketByClientId.clear();
      connectedAtByClientId.clear();
      plannedChurnDrop.clear();
      connectedClients = 0;
    };

    const getMetrics = (): WebRtcMetrics => {
      const avgConnectionSeconds = disconnectEventsWithDuration > 0 ? totalConnectionMs / disconnectEventsWithDuration / 1000 : 0;
      return {
        targetClients: input.clients,
        connectedClients,
        joinedClients,
        failedJoins,
        disconnects,
        reconnects,
        avgConnectionSeconds: Number(avgConnectionSeconds.toFixed(2)),
        eventsTotal: run.events.length,
        churnCycles,
        churnLeaves,
        churnRejoins,
        disconnectReasons: Object.fromEntries(disconnectReasons.entries())
      };
    };

    const stop = () => {
      if (stopping) return;
      stopping = true;
      run.status = "stopping";
      for (const timeout of timeoutHandles) clearTimeout(timeout);
      for (const interval of intervalHandles) clearInterval(interval);
      timeoutHandles.length = 0;
      intervalHandles.length = 0;
      shutdownAllSockets();
      appendEvent(run, { category: "run.finished", message: "WebRTC-Test beendet." });
      finalizeRun(run, "finished", getMetrics());
      active = null;
    };

    const connectClient = (clientId: string, isChurnRejoin: boolean): void => {
      if (stopping || Date.now() >= endAtMs) return;
      const socket = ioClient(input.apiOrigin, {
        transports: ["websocket"],
        reconnection: input.reconnect && !input.churn.enabled,
        reconnectionAttempts: input.reconnect ? Infinity : 0,
        auth: { role: "LISTENER", sessionCode: input.sessionCode }
      });

      socket.on("connect", () => {
        if (stopping) return;
        connectedClients += 1;
        connectedAtByClientId.set(clientId, Date.now());
        if (socket.recovered) reconnects += 1;
        appendEvent(run, {
          category: "client.joined",
          clientId,
          message: `Client verbunden (${clientId})`,
          data: { churnRejoin: isChurnRejoin }
        });
        socket.emit("listener:joinSession", { channelId: input.channelId }, (payload: { error?: string } | undefined) => {
          if (payload?.error) {
            failedJoins += 1;
            appendEvent(run, {
              level: "warn",
              category: "client.join.failed",
              clientId,
              message: `Join fehlgeschlagen: ${payload.error}`
            });
            return;
          }
          joinedClients += 1;
          appendEvent(run, { category: "client.join.ok", clientId, message: "Join erfolgreich." });
        });
      });

      socket.on("disconnect", (reason: string) => {
        disconnects += 1;
        connectedClients = Math.max(0, connectedClients - 1);
        incrementReason(reason);
        const started = connectedAtByClientId.get(clientId);
        if (typeof started === "number") {
          totalConnectionMs += Math.max(0, Date.now() - started);
          disconnectEventsWithDuration += 1;
          connectedAtByClientId.delete(clientId);
        }
        const churnDrop = plannedChurnDrop.has(clientId);
        plannedChurnDrop.delete(clientId);
        appendEvent(run, {
          level: churnDrop ? "info" : "warn",
          category: churnDrop ? "client.left.simulated" : "client.left.unexpected",
          clientId,
          code: reason || "unknown",
          message: `Client getrennt (${reason || "unknown"})`
        });
        socketByClientId.delete(clientId);
      });

      socket.on("connect_error", (error: Error) => {
        failedJoins += 1;
        appendEvent(run, {
          level: "error",
          category: "client.connect.error",
          clientId,
          message: `Connect-Fehler: ${error.message}`
        });
      });

      socketByClientId.set(clientId, socket);
      if (isChurnRejoin) churnRejoins += 1;
    };

    const createClientId = (): string => {
      nextClientIndex += 1;
      return `c_${nextClientIndex}`;
    };

    const scheduleClientConnect = (delayMs: number, isChurnRejoin: boolean): void => {
      const timeout = setTimeout(() => {
        const clientId = createClientId();
        connectClient(clientId, isChurnRejoin);
      }, Math.max(0, delayMs));
      timeoutHandles.push(timeout);
    };

    const performChurnCycle = (): void => {
      if (stopping || Date.now() >= endAtMs) return;
      const currentClients = Array.from(socketByClientId.keys());
      if (!currentClients.length) return;
      churnCycles += 1;
      const leaveCount = Math.max(1, Math.floor((currentClients.length * input.churn.leavePercent) / 100));
      const selected = [...currentClients].sort(() => Math.random() - 0.5).slice(0, leaveCount);
      appendEvent(run, {
        category: "churn.cycle",
        message: `Churn-Zyklus: ${selected.length} Clients verlassen/rejoinen`,
        data: { activeClients: currentClients.length, leaveCount: selected.length }
      });
      for (const clientId of selected) {
        const socket = socketByClientId.get(clientId);
        if (!socket) continue;
        plannedChurnDrop.add(clientId);
        churnLeaves += 1;
        appendEvent(run, { category: "client.rejoin.scheduled", clientId, message: "Simulierter Leave geplant." });
        try {
          socket.disconnect();
        } catch {
          // no-op
        }
        const randomSpan = Math.max(0, input.churn.rejoinDelayMaxMs - input.churn.rejoinDelayMinMs);
        const jitter = randomSpan > 0 ? Math.floor(Math.random() * (randomSpan + 1)) : 0;
        const delayMs = input.churn.rejoinDelayMinMs + jitter;
        scheduleClientConnect(delayMs, true);
      }
    };

    const rampWindowMs = Math.max(0, input.rampUpSec * 1000);
    for (let i = 0; i < input.clients; i += 1) {
      const delayMs = rampWindowMs <= 0 ? 0 : Math.floor((rampWindowMs * i) / input.clients);
      scheduleClientConnect(delayMs, false);
    }

    if (input.churn.enabled) {
      appendEvent(run, {
        category: "churn.enabled",
        message: "Churn-Modus aktiv.",
        data: {
          intervalSec: input.churn.intervalSec,
          leavePercent: input.churn.leavePercent,
          rejoinDelayMinMs: input.churn.rejoinDelayMinMs,
          rejoinDelayMaxMs: input.churn.rejoinDelayMaxMs
        }
      });
      const churnTimer = setInterval(() => performChurnCycle(), input.churn.intervalSec * 1000);
      intervalHandles.push(churnTimer);
    }

    const hardStopTimer = setTimeout(() => stop(), input.durationSec * 1000 + Math.max(1000, input.rampUpSec * 250));
    timeoutHandles.push(hardStopTimer);

    active = {
      run,
      stop: () => {
        clearTimeout(hardStopTimer);
        stop();
      },
      getMetrics
    };

    return run;
  }

  return {
    isRunning: () => active !== null,
    getActiveRun: () => (active ? { ...active.run, summary: active.getMetrics() } : null),
    getRunById: (id: string) => {
      if (active?.run.id === id) return { ...active.run, summary: active.getMetrics() };
      return runs.get(id) ?? null;
    },
    getRunEvents: (id: string, limit = 500) => {
      const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Math.floor(limit))) : 500;
      const run = active?.run.id === id ? { ...active.run, summary: active.getMetrics() } : runs.get(id);
      if (!run) return null;
      const events = run.events.slice(-normalizedLimit);
      return { id: run.id, type: run.type, status: run.status, events };
    },
    getHistory: () =>
      Array.from(runs.values())
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 50),
    startLoadTest,
    startWebRtcTest,
    stopRun: (id: string) => {
      if (!active || active.run.id !== id) return false;
      active.stop();
      return true;
    }
  };
}

export type DebugTestManager = ReturnType<typeof createDebugTestManager>;
export type { DebugTestEvent };
