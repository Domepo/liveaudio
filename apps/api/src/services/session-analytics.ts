import axios from "axios";
import type { PrismaClient } from "@prisma/client";

type SessionLiveSnapshot = Array<{ ts: number; total: number; channels: Record<string, number> }>;

type SessionAnalyticsDeps = {
  prisma: PrismaClient;
  MEDIA_BASE_URL: string;
  SESSION_STATS_SINCE_PREFIX: string;
  listenerSocketsBySession: Map<string, Set<string>>;
  broadcasterSocketsBySession: Map<string, Set<string>>;
  getLiveListenerChannelCounts: (sessionId: string) => Record<string, number>;
  getLiveListenerTotal: (sessionId: string) => number;
  sessionLiveSeries: Map<string, SessionLiveSnapshot>;
};

export function appConfigSessionStatsSinceKey(prefix: string, sessionId: string): string {
  return `${prefix}${sessionId}`;
}

export async function getSessionStatsSince(prisma: PrismaClient, prefix: string, sessionId: string): Promise<Date> {
  const config = await prisma.appConfig.findUnique({
    where: { key: appConfigSessionStatsSinceKey(prefix, sessionId) },
    select: { value: true }
  });
  if (!config?.value) return new Date(0);
  const parsed = new Date(config.value);
  if (Number.isNaN(parsed.getTime())) return new Date(0);
  return parsed;
}

export async function markSessionStatsSinceNow(prisma: PrismaClient, prefix: string, sessionId: string): Promise<void> {
  const key = appConfigSessionStatsSinceKey(prefix, sessionId);
  await prisma.appConfig.upsert({
    where: { key },
    create: { key, value: new Date().toISOString() },
    update: { value: new Date().toISOString() }
  });
}

export async function fetchSessionStats(deps: SessionAnalyticsDeps, sessionId: string): Promise<{
  channelsTotal: number;
  channelsActive: number;
  listenersConnected: number;
  broadcastersConnected: number;
  joinEvents24h: number;
  activeProducerChannels: number;
}> {
  const { prisma, MEDIA_BASE_URL, broadcasterSocketsBySession, getLiveListenerTotal } = deps;
  const [channelsTotal, channelsActive, joinEvents24h] = await Promise.all([
    prisma.channel.count({ where: { sessionId } }),
    prisma.channel.count({ where: { sessionId, isActive: true } }),
    prisma.accessLog.count({ where: { sessionId, eventType: "LISTENER_CONSUME", success: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
  ]);
  let activeProducerChannels = 0;
  try {
    const response = await axios.get<{ activeProducerChannels: number }>(`${MEDIA_BASE_URL}/stats/session/${sessionId}`);
    activeProducerChannels = Number(response.data.activeProducerChannels ?? 0);
  } catch {
    activeProducerChannels = 0;
  }
  return {
    channelsTotal,
    channelsActive,
    listenersConnected: getLiveListenerTotal(sessionId),
    broadcastersConnected: broadcasterSocketsBySession.get(sessionId)?.size ?? 0,
    joinEvents24h,
    activeProducerChannels
  };
}

export async function fetchLiveChannelIds(mediaBaseUrl: string, sessionId: string): Promise<string[]> {
  try {
    const response = await axios.get<{ activeChannelIds?: string[] }>(`${mediaBaseUrl}/stats/session/${sessionId}`);
    return Array.isArray(response.data.activeChannelIds) ? response.data.activeChannelIds : [];
  } catch {
    return [];
  }
}

export function toCsvValue(value: string | number): string {
  if (typeof value === "number") return String(value);
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export async function buildSessionAnalytics(deps: SessionAnalyticsDeps, sessionId: string): Promise<any> {
  const { prisma, SESSION_STATS_SINCE_PREFIX, getLiveListenerChannelCounts, getLiveListenerTotal, sessionLiveSeries } = deps;
  const channels = await prisma.channel.findMany({ where: { sessionId, isActive: true }, select: { id: true, name: true } });
  const statsSince = await getSessionStatsSince(prisma, SESSION_STATS_SINCE_PREFIX, sessionId);
  const now = Date.now();
  const logs = await prisma.accessLog.findMany({
    where: { sessionId, createdAt: { gte: statsSince }, eventType: { in: ["LISTENER_JOIN", "LISTENER_LEAVE", "LISTENER_CONSUME"] } },
    select: { channelId: true, eventType: true, createdAt: true, reason: true, ip: true, userAgent: true },
    orderBy: { createdAt: "asc" }
  });
  const liveCounts = getLiveListenerChannelCounts(sessionId);
  const listenersPerChannel = channels.map((channel) => ({ channelId: channel.id, name: channel.name, listeners: liveCounts[channel.id] ?? 0 }));
  const totalListeners = getLiveListenerTotal(sessionId);
  const history = (sessionLiveSeries.get(sessionId) ?? []).slice(-120);
  const peakListeners = history.reduce((max, point) => Math.max(max, point.total), totalListeners);
  const last10min = logs.filter((log) => log.createdAt.getTime() >= now - 10 * 60 * 1000);
  const joinRatePerMin = last10min.filter((log) => log.eventType === "LISTENER_JOIN").length / 10;
  const leaveRatePerMin = last10min.filter((log) => log.eventType === "LISTENER_LEAVE").length / 10;
  const history10 = history.filter((point) => point.ts >= now - 10 * 60 * 1000);
  const averageListenersLast10Min = history10.length > 0 ? history10.reduce((sum, point) => sum + point.total, 0) / history10.length : totalListeners;
  const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour, joins: 0 }));
  for (const log of logs) if (log.eventType === "LISTENER_JOIN") hourBuckets[log.createdAt.getHours()].joins += 1;
  const durationsByChannel = new Map<string, number[]>();
  for (const log of logs) {
    if (log.eventType !== "LISTENER_LEAVE" || !log.channelId || !log.reason) continue;
    const match = /durationMs=(\d+)/.exec(log.reason);
    if (!match) continue;
    const durationSec = Number(match[1]) / 1000;
    const list = durationsByChannel.get(log.channelId) ?? [];
    list.push(durationSec);
    durationsByChannel.set(log.channelId, list);
  }
  const allDurations = Array.from(durationsByChannel.values()).flat();
  const averageListeningDurationSec = allDurations.length > 0 ? allDurations.reduce((sum, value) => sum + value, 0) / allDurations.length : 0;
  const sortedDurations = [...allDurations].sort((a, b) => a - b);
  const medianListeningDurationSec = sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
  const p95ListeningDurationSec = sortedDurations.length > 0 ? sortedDurations[Math.max(0, Math.floor(sortedDurations.length * 0.95) - 1)] : 0;
  const joinsByChannel = new Map<string, number>();
  const leavesByChannel = new Map<string, number>();
  for (const log of logs) {
    if (!log.channelId) continue;
    if (log.eventType === "LISTENER_JOIN") joinsByChannel.set(log.channelId, (joinsByChannel.get(log.channelId) ?? 0) + 1);
    else if (log.eventType === "LISTENER_LEAVE") leavesByChannel.set(log.channelId, (leavesByChannel.get(log.channelId) ?? 0) + 1);
  }
  const peakByChannel = new Map<string, number>();
  for (const point of history) for (const [channelId, value] of Object.entries(point.channels)) peakByChannel.set(channelId, Math.max(peakByChannel.get(channelId) ?? 0, value));
  const channelComparison = channels.map((channel) => {
    const durations = durationsByChannel.get(channel.id) ?? [];
    const average = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    return { channelId: channel.id, name: channel.name, joins: joinsByChannel.get(channel.id) ?? 0, leaves: leavesByChannel.get(channel.id) ?? 0, averageListeningDurationSec: average, peakListeners: peakByChannel.get(channel.id) ?? 0 };
  });
  const perChannelSeries = channels.map((channel) => ({ channelId: channel.id, name: channel.name, points: history.map((point) => ({ ts: point.ts, listeners: point.channels[channel.id] ?? 0 })) }));
  const joinEvents = logs.filter((log) => log.eventType === "LISTENER_JOIN").length;
  const leaveEvents = logs.filter((log) => log.eventType === "LISTENER_LEAVE").length;
  const consumeEvents = logs.filter((log) => log.eventType === "LISTENER_CONSUME").length;
  const uniqueListeners = new Set(logs.filter((log) => log.eventType === "LISTENER_JOIN" || log.eventType === "LISTENER_CONSUME").map((log) => `${log.ip ?? "unknown"}|${log.userAgent ?? "unknown"}`)).size;
  const bounceRate = joinEvents > 0 ? allDurations.filter((duration) => duration <= 30).length / joinEvents : 0;
  return {
    live: { listenersPerChannel, totalListeners, peakListeners, joinRatePerMin, leaveRatePerMin, averageListenersLast10Min },
    realtimeGraph: { points: history.map((point) => ({ ts: point.ts, total: point.total })), perChannel: perChannelSeries },
    postSession: { statsSince: statsSince.toISOString(), joinEvents, leaveEvents, consumeEvents, uniqueListeners, medianListeningDurationSec, p95ListeningDurationSec, bounceRate, averageListeningDurationSec, heatmap: hourBuckets, channelComparison }
  };
}
