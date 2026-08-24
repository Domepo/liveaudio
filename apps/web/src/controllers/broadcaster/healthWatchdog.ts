export const BROADCASTER_HEALTH_POLL_MS = 5_000;
export const BROADCASTER_HEALTH_BAD_SAMPLES_BEFORE_RECOVERY = 3;
export const BROADCASTER_WATCHDOG_RECOVERIES_BEFORE_RELOAD = 3;
export const BROADCASTER_WATCHDOG_RECOVERY_WINDOW_MS = 2 * 60_000;
export const BROADCASTER_WATCHDOG_RELOAD_WINDOW_MS = 10 * 60_000;
export const BROADCASTER_WATCHDOG_MAX_RELOADS_PER_WINDOW = 2;

const HIGH_PACKET_LOSS_RATIO = 0.08;
const HIGH_JITTER_SECONDS = 0.08;
const HIGH_ROUND_TRIP_SECONDS = 1.5;

export type OutboundAudioSnapshot = {
  packetsSent: number | null;
  packetsLost: number | null;
  jitterSeconds: number | null;
  roundTripSeconds: number | null;
};

export type OutboundAudioHealth = {
  state: "healthy" | "degraded" | "stalled";
  reason: string;
};

export type OutboundAudioMetrics = {
  packetsSentDelta: number | null;
  packetLossRatio: number | null;
  jitterMs: number | null;
  roundTripMs: number | null;
};

export type OutboundAudioQualitySummary = {
  state: "measuring" | "good" | "fair" | "poor";
  packetLossPercent: number | null;
  jitterMs: number | null;
  roundTripMs: number | null;
};

type StatsLike = {
  type?: string;
  kind?: string;
  mediaType?: string;
  packetsSent?: number;
  packetsLost?: number;
  jitter?: number;
  roundTripTime?: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function snapshotOutboundAudioStats(report: RTCStatsReport): OutboundAudioSnapshot {
  let outbound: StatsLike | null = null;
  let remoteInbound: StatsLike | null = null;

  report.forEach((raw) => {
    const stat = raw as StatsLike;
    const mediaKind = stat.kind ?? stat.mediaType;
    if (mediaKind !== "audio") return;
    if (stat.type === "outbound-rtp") outbound = stat;
    if (stat.type === "remote-inbound-rtp") remoteInbound = stat;
  });

  return {
    packetsSent: finiteNumber(outbound?.packetsSent),
    packetsLost: finiteNumber(remoteInbound?.packetsLost),
    jitterSeconds: finiteNumber(remoteInbound?.jitter),
    roundTripSeconds: finiteNumber(remoteInbound?.roundTripTime)
  };
}

export function calculateOutboundAudioMetrics(
  previous: OutboundAudioSnapshot | null,
  current: OutboundAudioSnapshot
): OutboundAudioMetrics {
  const packetsSentDelta =
    previous?.packetsSent !== null && previous?.packetsSent !== undefined && current.packetsSent !== null
      ? Math.max(0, current.packetsSent - previous.packetsSent)
      : null;
  const packetsLostDelta =
    previous?.packetsLost !== null && previous?.packetsLost !== undefined && current.packetsLost !== null
      ? Math.max(0, current.packetsLost - previous.packetsLost)
      : null;
  const packetLossRatio =
    packetsSentDelta !== null && packetsLostDelta !== null && packetsSentDelta + packetsLostDelta > 0
      ? packetsLostDelta / (packetsSentDelta + packetsLostDelta)
      : null;

  return {
    packetsSentDelta,
    packetLossRatio,
    jitterMs: current.jitterSeconds === null ? null : current.jitterSeconds * 1_000,
    roundTripMs: current.roundTripSeconds === null ? null : current.roundTripSeconds * 1_000
  };
}

export function summarizeOutboundAudioQuality(metrics: OutboundAudioMetrics[]): OutboundAudioQualitySummary {
  const maxOrNull = (values: Array<number | null>): number | null => {
    const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return available.length > 0 ? Math.max(...available) : null;
  };

  const maxLossRatio = maxOrNull(metrics.map((sample) => sample.packetLossRatio));
  const jitterMs = maxOrNull(metrics.map((sample) => sample.jitterMs));
  const roundTripMs = maxOrNull(metrics.map((sample) => sample.roundTripMs));
  const packetLossPercent = maxLossRatio === null ? null : maxLossRatio * 100;

  if (metrics.length === 0 || metrics.every((sample) => sample.packetsSentDelta === null)) {
    return { state: "measuring", packetLossPercent, jitterMs, roundTripMs };
  }
  if (
    metrics.some((sample) => sample.packetsSentDelta === 0) ||
    (maxLossRatio !== null && maxLossRatio >= HIGH_PACKET_LOSS_RATIO) ||
    (jitterMs !== null && jitterMs >= HIGH_JITTER_SECONDS * 1_000) ||
    (roundTripMs !== null && roundTripMs >= HIGH_ROUND_TRIP_SECONDS * 1_000)
  ) {
    return { state: "poor", packetLossPercent, jitterMs, roundTripMs };
  }
  if (
    (maxLossRatio !== null && maxLossRatio >= 0.02) ||
    (jitterMs !== null && jitterMs >= 30) ||
    (roundTripMs !== null && roundTripMs >= 500)
  ) {
    return { state: "fair", packetLossPercent, jitterMs, roundTripMs };
  }
  return { state: "good", packetLossPercent, jitterMs, roundTripMs };
}

export function evaluateOutboundAudioHealth(
  previous: OutboundAudioSnapshot | null,
  current: OutboundAudioSnapshot
): OutboundAudioHealth {
  if (current.packetsSent === null) {
    return { state: "degraded", reason: "keine Senderstatistik" };
  }
  if (!previous || previous.packetsSent === null) {
    return { state: "healthy", reason: "erste Messung" };
  }

  const metrics = calculateOutboundAudioMetrics(previous, current);
  const sentDelta = metrics.packetsSentDelta ?? 0;
  if (sentDelta === 0) {
    return { state: "stalled", reason: "keine neuen Audiopakete" };
  }

  const lossRatio = metrics.packetLossRatio ?? 0;
  if (lossRatio >= HIGH_PACKET_LOSS_RATIO) {
    return { state: "degraded", reason: `${Math.round(lossRatio * 100)}% Paketverlust` };
  }
  if (current.jitterSeconds !== null && current.jitterSeconds >= HIGH_JITTER_SECONDS) {
    return { state: "degraded", reason: `${Math.round(current.jitterSeconds * 1_000)}ms Jitter` };
  }
  if (current.roundTripSeconds !== null && current.roundTripSeconds >= HIGH_ROUND_TRIP_SECONDS) {
    return { state: "degraded", reason: `${current.roundTripSeconds.toFixed(1)}s Laufzeit` };
  }

  return { state: "healthy", reason: "Audiopakete laufen" };
}
