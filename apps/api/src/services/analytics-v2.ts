import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

function granularityToMs(granularity: "10s" | "1m" | "15m"): number {
  if (granularity === "1m") return 60_000;
  if (granularity === "15m") return 15 * 60_000;
  return 10_000;
}

function floorToBucket(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs;
}

export async function buildAnalyticsV2(
  prisma: PrismaClient,
  input: {
    sessionIds: string[];
    from: Date;
    to: Date;
    channelId?: string;
    metric: string;
    granularity: "10s" | "1m" | "15m";
  }
): Promise<{
  from: string;
  to: string;
  metric: string;
  granularity: "10s" | "1m" | "15m";
  sessions: Array<{
    sessionId: string;
    sessionName: string;
    summary: {
      joinEvents: number;
      leaveEvents: number;
      consumeEvents: number;
      uniqueListeners: number;
      medianListeningDurationSec: number;
      p95ListeningDurationSec: number;
      bounceRate: number;
      averageListeningDurationSec: number;
      peakMetricValue: number;
    };
    series: Array<{ ts: number; value: number }>;
  }>;
}> {
  if (input.sessionIds.length === 0) {
    return { from: input.from.toISOString(), to: input.to.toISOString(), metric: input.metric, granularity: input.granularity, sessions: [] };
  }
  const sessions = await prisma.session.findMany({ where: { id: { in: input.sessionIds } }, select: { id: true, name: true } });
  const sessionNameById = new Map(sessions.map((session) => [session.id, session.name]));
  const bucketMs = granularityToMs(input.granularity);
  const shouldSumMetric = input.metric.startsWith("events_");

  const [points, logs] = await Promise.all([
    prisma.analyticsPoint.findMany({
      where: { sessionId: { in: input.sessionIds }, metric: input.metric, ts: { gte: input.from, lte: input.to }, ...(input.channelId ? { channelId: input.channelId } : {}) },
      select: { sessionId: true, ts: true, value: true },
      orderBy: { ts: "asc" }
    }),
    prisma.accessLog.findMany({
      where: { sessionId: { in: input.sessionIds }, createdAt: { gte: input.from, lte: input.to }, eventType: { in: ["LISTENER_JOIN", "LISTENER_LEAVE", "LISTENER_CONSUME"] }, ...(input.channelId ? { channelId: input.channelId } : {}) },
      select: { sessionId: true, eventType: true, reason: true, ip: true, userAgent: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const seriesBySession = new Map<string, Map<number, { sum: number; count: number }>>();
  for (const point of points) {
    const perSession = seriesBySession.get(point.sessionId) ?? new Map<number, { sum: number; count: number }>();
    const bucket = floorToBucket(point.ts.getTime(), bucketMs);
    const prev = perSession.get(bucket) ?? { sum: 0, count: 0 };
    prev.sum += point.value;
    prev.count += 1;
    perSession.set(bucket, prev);
    seriesBySession.set(point.sessionId, perSession);
  }

  const logsBySession = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = logsBySession.get(log.sessionId) ?? [];
    list.push(log);
    logsBySession.set(log.sessionId, list);
  }

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    metric: input.metric,
    granularity: input.granularity,
    sessions: input.sessionIds.map((sessionId) => {
      const buckets = seriesBySession.get(sessionId) ?? new Map<number, { sum: number; count: number }>();
      const series = Array.from(buckets.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, aggregate]) => ({ ts, value: shouldSumMetric ? aggregate.sum : aggregate.sum / Math.max(1, aggregate.count) }));

      const sessionLogs = logsBySession.get(sessionId) ?? [];
      const joinEvents = sessionLogs.filter((log) => log.eventType === "LISTENER_JOIN").length;
      const leaveEvents = sessionLogs.filter((log) => log.eventType === "LISTENER_LEAVE").length;
      const consumeEvents = sessionLogs.filter((log) => log.eventType === "LISTENER_CONSUME").length;
      const listenerKeys = new Set(sessionLogs.filter((log) => log.eventType === "LISTENER_JOIN" || log.eventType === "LISTENER_CONSUME").map((log) => `${log.ip ?? "unknown"}|${log.userAgent ?? "unknown"}`));
      const durations = sessionLogs
        .filter((log) => log.eventType === "LISTENER_LEAVE" && typeof log.reason === "string")
        .map((log) => {
          const match = /durationMs=(\d+)/.exec(log.reason ?? "");
          return match ? Number(match[1]) / 1000 : 0;
        })
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      const averageListeningDurationSec = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
      const medianListeningDurationSec = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;
      const p95ListeningDurationSec = durations.length > 0 ? durations[Math.max(0, Math.floor(durations.length * 0.95) - 1)] : 0;
      const bounceRate = joinEvents > 0 ? durations.filter((duration) => duration <= 30).length / joinEvents : 0;
      const peakMetricValue = series.reduce((max, point) => Math.max(max, point.value), 0);

      return {
        sessionId,
        sessionName: sessionNameById.get(sessionId) ?? sessionId,
        summary: { joinEvents, leaveEvents, consumeEvents, uniqueListeners: listenerKeys.size, medianListeningDurationSec, p95ListeningDurationSec, bounceRate, averageListeningDurationSec, peakMetricValue },
        series
      };
    })
  };
}

export async function findActiveSessionByCode(prisma: PrismaClient, code: string) {
  const direct = await prisma.session.findFirst({
    where: { status: "ACTIVE", broadcastCode: code },
    select: { id: true, name: true, description: true, imageUrl: true, status: true, broadcastCode: true, broadcastCodeHash: true }
  });
  if (direct) return direct;

  const legacy = await prisma.session.findMany({
    where: { status: "ACTIVE", broadcastCode: null, broadcastCodeHash: { not: null } },
    select: { id: true, name: true, description: true, imageUrl: true, status: true, broadcastCode: true, broadcastCodeHash: true }
  });
  for (const session of legacy) {
    if (!session.broadcastCodeHash) continue;
    if (await bcrypt.compare(code, session.broadcastCodeHash)) return session;
  }
  return null;
}

