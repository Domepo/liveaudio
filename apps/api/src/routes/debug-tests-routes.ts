import type { Express, Request, Response } from "express";
import type { PrismaClient, Role } from "@prisma/client";
import { parseDurationToSeconds, type DebugTestManager } from "../services/debug-tests";
import type { TestToneWatchdogStore } from "../services/testtone-watchdog";

type DebugTestsRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  debugMode: () => boolean;
  debugTestManager: DebugTestManager;
  testToneWatchdogStore: TestToneWatchdogStore;
  getSessionLiveMode: (sessionId: string) => "none" | "mic" | "preshow" | "testtone";
  MEDIA_BASE_URL: string;
  requireAuthenticated: (req: Request, res: Response, next: (err?: unknown) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: unknown) => void) => void;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  apiOrigin: string;
};

function toPositiveInt(input: unknown, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.floor(n);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function toPercent(input: unknown, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Number(n.toFixed(2));
}

function toBoolean(input: unknown, fallback: boolean): boolean {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const normalized = input.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  if (typeof input === "number") return input !== 0;
  return fallback;
}

function toCsvCell(value: unknown): string {
  const raw = String(value ?? "");
  const escaped = raw.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

export function registerDebugTestsRoutes(deps: DebugTestsRoutesDeps): void {
  const { app, prisma, debugMode, debugTestManager, testToneWatchdogStore, getSessionLiveMode, MEDIA_BASE_URL, requireAuthenticated, requireRoles, ensureSessionAccessOr404, apiOrigin } = deps;
  const isDebugMode = (): boolean => debugMode();

  app.get("/api/admin/debug/config", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (_req, res) => {
    return res.json({ debugMode: isDebugMode() });
  });

  app.get("/api/admin/debug/tests/history", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (_req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    return res.json({ runs: debugTestManager.getHistory(), active: debugTestManager.getActiveRun() });
  });

  app.get("/api/admin/debug/tests/:id/status", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    const run = debugTestManager.getRunById(String(req.params.id));
    if (!run) return res.status(404).json({ error: "Run not found" });
    return res.json(run);
  });

  app.get("/api/admin/debug/tests/:id/events", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    const limit = toPositiveInt((req.query as { limit?: unknown }).limit, 500, 1, 5000);
    const payload = debugTestManager.getRunEvents(String(req.params.id), limit);
    if (!payload) return res.status(404).json({ error: "Run not found" });
    return res.json(payload);
  });

  app.get("/api/admin/debug/tests/:id/export", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    const formatRaw = String((req.query as { format?: unknown }).format ?? "json").trim().toLowerCase();
    const format = formatRaw === "csv" ? "csv" : "json";
    const payload = debugTestManager.getRunEvents(String(req.params.id), 5000);
    const run = debugTestManager.getRunById(String(req.params.id));
    if (!payload || !run) return res.status(404).json({ error: "Run not found" });
    if (format === "json") {
      return res.json({
        run: {
          id: run.id,
          type: run.type,
          status: run.status,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          config: run.config,
          summary: run.summary
        },
        events: payload.events
      });
    }
    const header = ["at", "level", "category", "clientId", "code", "message", "data"];
    const rows = payload.events.map((event) =>
      [
        toCsvCell(event.at),
        toCsvCell(event.level ?? ""),
        toCsvCell(event.category ?? ""),
        toCsvCell(event.clientId ?? ""),
        toCsvCell(event.code ?? ""),
        toCsvCell(event.message ?? ""),
        toCsvCell(event.data ? JSON.stringify(event.data) : "")
      ].join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename=\"debug-test-${run.id}.csv\"`);
    return res.status(200).send(csv);
  });

  app.get("/api/admin/debug/audio-watchdog", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
    if (!sessionId) return res.status(400).json({ error: "sessionId fehlt." });
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    return res.json(testToneWatchdogStore.getSummary(sessionId));
  });

  app.get("/api/admin/debug/producer-status", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
    if (!sessionId) return res.status(400).json({ error: "sessionId fehlt." });
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;

    const channels = await prisma.channel.findMany({
      where: { sessionId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true }
    });
    let activeChannelIds: string[] = [];
    try {
      const mediaRes = await fetch(`${MEDIA_BASE_URL}/stats/session/${encodeURIComponent(sessionId)}`);
      if (mediaRes.ok) {
        const payload = (await mediaRes.json()) as { activeChannelIds?: unknown };
        if (Array.isArray(payload.activeChannelIds)) {
          activeChannelIds = payload.activeChannelIds.filter((item): item is string => typeof item === "string");
        }
      }
    } catch {
      // ignore media connectivity errors in debug response
    }
    const activeSet = new Set(activeChannelIds);
    return res.json({
      sessionId,
      liveMode: getSessionLiveMode(sessionId),
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        producerPresent: activeSet.has(channel.id)
      }))
    });
  });

  app.post("/api/admin/debug/tests/:id/stop", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    const stopped = debugTestManager.stopRun(String(req.params.id));
    if (!stopped) return res.status(404).json({ error: "Run not active" });
    return res.json({ ok: true });
  });

  app.post("/api/admin/debug/tests/load/start", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    if (debugTestManager.isRunning()) return res.status(409).json({ error: "Ein Testlauf ist bereits aktiv." });

    const targetUrlRaw = typeof (req.body as { targetUrl?: unknown } | undefined)?.targetUrl === "string" ? String((req.body as { targetUrl?: string }).targetUrl).trim() : "";
    const targetUrl = targetUrlRaw || `${apiOrigin}/health`;
    const vus = toPositiveInt((req.body as { vus?: unknown } | undefined)?.vus, 25, 1, 300);
    const durationSec = toPositiveInt((req.body as { durationSec?: unknown } | undefined)?.durationSec, 60, 10, 3600);
    const rampUpSec = toPositiveInt((req.body as { rampUpSec?: unknown } | undefined)?.rampUpSec, 10, 0, 600);
    const requestIntervalMs = toPositiveInt((req.body as { requestIntervalMs?: unknown } | undefined)?.requestIntervalMs, 250, 50, 5000);

    try {
      const run = debugTestManager.startLoadTest({ targetUrl, vus, durationSec, rampUpSec, requestIntervalMs });
      return res.status(201).json(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Loadtest konnte nicht gestartet werden.";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/admin/debug/tests/webrtc/start", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    if (!isDebugMode()) return res.status(404).json({ error: "Not found" });
    if (debugTestManager.isRunning()) return res.status(409).json({ error: "Ein Testlauf ist bereits aktiv." });

    const sessionId = typeof (req.body as { sessionId?: unknown } | undefined)?.sessionId === "string" ? String((req.body as { sessionId?: string }).sessionId).trim() : "";
    if (!sessionId) return res.status(400).json({ error: "sessionId fehlt." });
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE" || !session.broadcastCode) {
      return res.status(400).json({ error: "Session muss aktiv sein und einen Broadcast-Code haben." });
    }

    const requestedChannelId = typeof (req.body as { channelId?: unknown } | undefined)?.channelId === "string" ? String((req.body as { channelId?: string }).channelId).trim() : "";
    let channelId = requestedChannelId;
    if (!channelId) {
      const firstChannel = await prisma.channel.findFirst({ where: { sessionId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!firstChannel) return res.status(400).json({ error: "Keine aktiven Kanaele vorhanden." });
      channelId = firstChannel.id;
    }

    const clients = toPositiveInt((req.body as { clients?: unknown } | undefined)?.clients, 30, 1, 500);
    const rawDuration =
      (req.body as { duration?: unknown } | undefined)?.duration ??
      (req.body as { durationSec?: unknown } | undefined)?.durationSec ??
      "5m";
    const parsedDuration = parseDurationToSeconds(rawDuration);
    if (!parsedDuration) return res.status(400).json({ error: "Ungueltige Dauer. Beispiele: 1h, 30m, 90s." });
    const durationSec = toPositiveInt(parsedDuration, 300, 10, 43200);
    const rampUpSec = toPositiveInt((req.body as { rampUpSec?: unknown } | undefined)?.rampUpSec, 30, 0, 1200);
    const reconnect = toBoolean((req.body as { reconnect?: unknown } | undefined)?.reconnect, true);
    const churnEnabled = toBoolean((req.body as { churnEnabled?: unknown } | undefined)?.churnEnabled, false);
    const churnIntervalSec = toPositiveInt((req.body as { churnIntervalSec?: unknown } | undefined)?.churnIntervalSec, 30, 5, 3600);
    const churnLeavePercent = toPercent((req.body as { churnLeavePercent?: unknown } | undefined)?.churnLeavePercent, 10, 1, 90);
    const churnRejoinDelayMinMs = toPositiveInt((req.body as { churnRejoinDelayMinMs?: unknown } | undefined)?.churnRejoinDelayMinMs, 500, 0, 120000);
    const churnRejoinDelayMaxMs = toPositiveInt((req.body as { churnRejoinDelayMaxMs?: unknown } | undefined)?.churnRejoinDelayMaxMs, 5000, 0, 120000);
    const churnDelayMin = Math.min(churnRejoinDelayMinMs, churnRejoinDelayMaxMs);
    const churnDelayMax = Math.max(churnRejoinDelayMinMs, churnRejoinDelayMaxMs);

    try {
      const run = debugTestManager.startWebRtcTest({
        apiOrigin,
        sessionCode: session.broadcastCode,
        channelId,
        clients,
        durationSec,
        rampUpSec,
        reconnect,
        churn: {
          enabled: churnEnabled,
          intervalSec: churnIntervalSec,
          leavePercent: churnLeavePercent,
          rejoinDelayMinMs: churnDelayMin,
          rejoinDelayMaxMs: churnDelayMax
        }
      });
      return res.status(201).json(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : "WebRTC-Test konnte nicht gestartet werden.";
      return res.status(400).json({ error: message });
    }
  });
}
