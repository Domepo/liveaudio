import type { Role } from "@prisma/client";
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

type AnalyticsRoutesDeps = {
  app: Express;
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  analyticsV2QuerySchema: ZodSchema<{ from?: string; to?: string; sessionIds?: string; channelId?: string; metric?: string; granularity?: "10s" | "1m" | "15m" }>;
  parseAnalyticsWindow: (input: { from?: string; to?: string }) => { from: Date; to: Date };
  buildAnalyticsV2: (input: {
    sessionIds: string[];
    from: Date;
    to: Date;
    channelId?: string;
    metric: string;
    granularity: "10s" | "1m" | "15m";
  }) => Promise<{
    from: string;
    to: string;
    metric: string;
    granularity: "10s" | "1m" | "15m";
    sessions: Array<{ sessionId: string; sessionName: string; summary: { peakMetricValue: number; joinEvents: number; uniqueListeners: number } }>;
  }>;
  getAccessibleSessionIds: (admin: AdminAuthContext) => Promise<string[]>;
  buildSessionAnalytics: (sessionId: string) => Promise<any>;
  toCsvValue: (value: string | number) => string;
  markSessionStatsSinceNow: (sessionId: string) => Promise<void>;
  clearSessionAnalyticsState: (sessionId: string) => void;
  ANALYTICS_MAX_COMPARE_SESSIONS: number;
  prisma: {
    session: { findUnique: (...args: any[]) => Promise<any>; findMany: (...args: any[]) => Promise<any[]> };
    analyticsPoint: { findMany: (...args: any[]) => Promise<any[]> };
    accessLog: { deleteMany: (...args: any[]) => Promise<any> };
  };
};

export function registerAnalyticsRoutes(deps: AnalyticsRoutesDeps): void {
  const {
    app,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    analyticsV2QuerySchema,
    parseAnalyticsWindow,
    buildAnalyticsV2,
    getAccessibleSessionIds,
    buildSessionAnalytics,
    toCsvValue,
    markSessionStatsSinceNow,
    clearSessionAnalyticsState,
    ANALYTICS_MAX_COMPARE_SESSIONS,
    prisma
  } = deps;

  app.get("/api/admin/analytics/broadcast-log", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const admin = (req as AdminRequest).admin!;
    const allowedSessionIds = await getAccessibleSessionIds(admin);
    if (allowedSessionIds.length === 0) return res.json({ rows: [] });

    const [sessions, events] = await Promise.all([
      prisma.session.findMany({ where: { id: { in: allowedSessionIds } }, select: { id: true, name: true } }),
      prisma.analyticsPoint.findMany({
        where: { sessionId: { in: allowedSessionIds }, metric: { in: ["events_broadcast_start", "events_broadcast_stop"] } },
        select: { sessionId: true, metric: true, ts: true },
        orderBy: { ts: "asc" }
      })
    ]);

    const sessionNameById = new Map(sessions.map((session) => [session.id, session.name]));
    const openRuns = new Map<string, { sessionId: string; startedAt: string; stoppedAt: string | null }>();
    const runs: Array<{ sessionId: string; startedAt: string; stoppedAt: string | null }> = [];

    for (const event of events) {
      const ts = new Date(event.ts).toISOString();
      if (event.metric === "events_broadcast_start") {
        const existingOpen = openRuns.get(event.sessionId);
        if (existingOpen && !existingOpen.stoppedAt) {
          // Repair inconsistent event sequences (e.g. reconnect/takeover without explicit stop).
          // A new start implies the previous run is no longer live at this exact timestamp.
          existingOpen.stoppedAt = ts;
        }
        const run = { sessionId: event.sessionId, startedAt: ts, stoppedAt: null };
        runs.push(run);
        openRuns.set(event.sessionId, run);
        continue;
      }
      const current = openRuns.get(event.sessionId);
      if (!current) {
        runs.push({ sessionId: event.sessionId, startedAt: ts, stoppedAt: ts });
        continue;
      }
      current.stoppedAt = ts;
      openRuns.delete(event.sessionId);
    }

    const rows = runs
      .map((run) => ({
        sessionId: run.sessionId,
        sessionName: sessionNameById.get(run.sessionId) ?? run.sessionId,
        startedAt: run.startedAt,
        stoppedAt: run.stoppedAt,
        isLive: !run.stoppedAt
      }))
      .sort((a, b) => {
        if (a.isLive !== b.isLive) return Number(b.isLive) - Number(a.isLive);
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      });

    return res.json({ rows });
  });

  app.get("/api/admin/sessions/:sessionId/analytics", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json(await buildSessionAnalytics(sessionId));
  });

  app.get("/api/admin/analytics/v2/overview", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const parsed = analyticsV2QuerySchema.safeParse({
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      sessionIds: typeof req.query.sessionIds === "string" ? req.query.sessionIds : undefined,
      channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined,
      metric: typeof req.query.metric === "string" ? req.query.metric : undefined,
      granularity: typeof req.query.granularity === "string" ? req.query.granularity : undefined
    });
    if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

    const admin = (req as AdminRequest).admin!;
    const allowedSessionIds = new Set(await getAccessibleSessionIds(admin));
    const requestedSessionIds = parsed.data.sessionIds ? parsed.data.sessionIds.split(",").map((v) => v.trim()).filter(Boolean) : Array.from(allowedSessionIds);
    const limitedSessionIds = requestedSessionIds.filter((sessionId) => allowedSessionIds.has(sessionId)).slice(0, ANALYTICS_MAX_COMPARE_SESSIONS);
    const window = parseAnalyticsWindow({ from: parsed.data.from, to: parsed.data.to });
    return res.json(await buildAnalyticsV2({ sessionIds: limitedSessionIds, from: window.from, to: window.to, channelId: parsed.data.channelId, metric: parsed.data.metric ?? "listeners_total", granularity: parsed.data.granularity ?? "1m" }));
  });

  app.get("/api/admin/analytics/v2/compare", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const parsed = analyticsV2QuerySchema.safeParse({
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      sessionIds: typeof req.query.sessionIds === "string" ? req.query.sessionIds : undefined,
      channelId: typeof req.query.channelId === "string" ? req.query.channelId : undefined,
      metric: typeof req.query.metric === "string" ? req.query.metric : undefined,
      granularity: typeof req.query.granularity === "string" ? req.query.granularity : undefined
    });
    if (!parsed.success) return res.status(400).json({ error: "Invalid query" });

    const admin = (req as AdminRequest).admin!;
    const allowedSessionIds = new Set(await getAccessibleSessionIds(admin));
    const requestedSessionIds = parsed.data.sessionIds ? parsed.data.sessionIds.split(",").map((v) => v.trim()).filter(Boolean) : Array.from(allowedSessionIds);
    const limitedSessionIds = requestedSessionIds.filter((sessionId) => allowedSessionIds.has(sessionId)).slice(0, ANALYTICS_MAX_COMPARE_SESSIONS);
    const window = parseAnalyticsWindow({ from: parsed.data.from, to: parsed.data.to });
    const data = await buildAnalyticsV2({ sessionIds: limitedSessionIds, from: window.from, to: window.to, channelId: parsed.data.channelId, metric: parsed.data.metric ?? "listeners_total", granularity: parsed.data.granularity ?? "1m" });
    const ranking = [...data.sessions]
      .map((session) => ({ sessionId: session.sessionId, sessionName: session.sessionName, peakMetricValue: session.summary.peakMetricValue, joinEvents: session.summary.joinEvents, uniqueListeners: session.summary.uniqueListeners }))
      .sort((a, b) => b.peakMetricValue - a.peakMetricValue);
    return res.json({ ...data, ranking });
  });

  app.get("/api/admin/sessions/:sessionId/analytics/export", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const format = String(req.query.format ?? "json").toLowerCase();
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, name: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    const analytics = await buildSessionAnalytics(sessionId);
    if (format === "csv") {
      const rows: string[] = [];
      rows.push("section,metric,value");
      rows.push(`post,statsSince,${toCsvValue(analytics.postSession.statsSince)}`);
      rows.push(`post,joinEvents,${toCsvValue(analytics.postSession.joinEvents)}`);
      rows.push(`post,leaveEvents,${toCsvValue(analytics.postSession.leaveEvents)}`);
      rows.push(`post,consumeEvents,${toCsvValue(analytics.postSession.consumeEvents)}`);
      rows.push(`post,uniqueListeners,${toCsvValue(analytics.postSession.uniqueListeners)}`);
      rows.push(`post,medianListeningDurationSec,${toCsvValue(analytics.postSession.medianListeningDurationSec.toFixed(2))}`);
      rows.push(`post,p95ListeningDurationSec,${toCsvValue(analytics.postSession.p95ListeningDurationSec.toFixed(2))}`);
      rows.push(`post,bounceRate,${toCsvValue(analytics.postSession.bounceRate.toFixed(4))}`);
      rows.push(`live,totalListeners,${toCsvValue(analytics.live.totalListeners)}`);
      rows.push(`live,peakListeners,${toCsvValue(analytics.live.peakListeners)}`);
      rows.push(`live,joinRatePerMin,${toCsvValue(analytics.live.joinRatePerMin.toFixed(2))}`);
      rows.push(`live,leaveRatePerMin,${toCsvValue(analytics.live.leaveRatePerMin.toFixed(2))}`);
      rows.push(`live,averageListenersLast10Min,${toCsvValue(analytics.live.averageListenersLast10Min.toFixed(2))}`);
      rows.push(`post,averageListeningDurationSec,${toCsvValue(analytics.postSession.averageListeningDurationSec.toFixed(2))}`);
      for (const channel of analytics.postSession.channelComparison) {
        rows.push(`channel,${toCsvValue(channel.name)} joins,${toCsvValue(channel.joins)}`);
        rows.push(`channel,${toCsvValue(channel.name)} leaves,${toCsvValue(channel.leaves)}`);
        rows.push(`channel,${toCsvValue(channel.name)} avgDurationSec,${toCsvValue(channel.averageListeningDurationSec.toFixed(2))}`);
        rows.push(`channel,${toCsvValue(channel.name)} peakListeners,${toCsvValue(channel.peakListeners)}`);
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${session.name}-analytics.csv\"`);
      return res.send(rows.join("\n"));
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=\"${session.name}-analytics.json\"`);
    return res.send(JSON.stringify(analytics, null, 2));
  });

  app.post("/api/admin/sessions/:sessionId/analytics/clear", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    await prisma.accessLog.deleteMany({ where: { sessionId } });
    await markSessionStatsSinceNow(sessionId);
    clearSessionAnalyticsState(sessionId);
    return res.json({ ok: true });
  });
}
