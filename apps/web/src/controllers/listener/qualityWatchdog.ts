export const LISTENER_QUALITY_POLL_MS = 5_000;
export const LISTENER_BAD_SAMPLES_BEFORE_RECOVERY = 3;

const HIGH_PACKET_LOSS_RATIO = 0.08;
const HIGH_CONCEALED_AUDIO_RATIO = 0.05;
const HIGH_JITTER_SECONDS = 0.08;

export type InboundAudioSnapshot = {
  packetsReceived: number | null;
  packetsLost: number | null;
  jitterSeconds: number | null;
  concealedSamples: number | null;
  totalSamplesReceived: number | null;
  concealmentEvents: number | null;
};

export type InboundAudioHealth = {
  state: "healthy" | "degraded" | "stalled";
  reason: string;
};

type StatsLike = {
  type?: string;
  kind?: string;
  mediaType?: string;
  packetsReceived?: number;
  packetsLost?: number;
  jitter?: number;
  concealedSamples?: number;
  totalSamplesReceived?: number;
  concealmentEvents?: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function snapshotInboundAudioStats(report: RTCStatsReport): InboundAudioSnapshot {
  let inbound: StatsLike | null = null;
  report.forEach((raw) => {
    const stat = raw as StatsLike;
    if (stat.type === "inbound-rtp" && (stat.kind ?? stat.mediaType) === "audio") inbound = stat;
  });

  return {
    packetsReceived: finiteNumber(inbound?.packetsReceived),
    packetsLost: finiteNumber(inbound?.packetsLost),
    jitterSeconds: finiteNumber(inbound?.jitter),
    concealedSamples: finiteNumber(inbound?.concealedSamples),
    totalSamplesReceived: finiteNumber(inbound?.totalSamplesReceived),
    concealmentEvents: finiteNumber(inbound?.concealmentEvents)
  };
}

export function evaluateInboundAudioHealth(previous: InboundAudioSnapshot | null, current: InboundAudioSnapshot): InboundAudioHealth {
  if (current.packetsReceived === null) return { state: "degraded", reason: "keine Empfangsstatistik" };
  if (!previous || previous.packetsReceived === null) return { state: "healthy", reason: "erste Messung" };

  const receivedDelta = Math.max(0, current.packetsReceived - previous.packetsReceived);
  if (receivedDelta === 0) return { state: "stalled", reason: "keine neuen Audiopakete" };

  const lostDelta =
    current.packetsLost !== null && previous.packetsLost !== null
      ? Math.max(0, current.packetsLost - previous.packetsLost)
      : 0;
  const lossRatio = lostDelta / Math.max(1, receivedDelta + lostDelta);
  if (lossRatio >= HIGH_PACKET_LOSS_RATIO) {
    return { state: "degraded", reason: `${Math.round(lossRatio * 100)}% Paketverlust` };
  }

  const concealedDelta =
    current.concealedSamples !== null && previous.concealedSamples !== null
      ? Math.max(0, current.concealedSamples - previous.concealedSamples)
      : 0;
  const receivedSamplesDelta =
    current.totalSamplesReceived !== null && previous.totalSamplesReceived !== null
      ? Math.max(0, current.totalSamplesReceived - previous.totalSamplesReceived)
      : 0;
  const concealedRatio = concealedDelta / Math.max(1, receivedSamplesDelta + concealedDelta);
  const concealmentEventsDelta =
    current.concealmentEvents !== null && previous.concealmentEvents !== null
      ? Math.max(0, current.concealmentEvents - previous.concealmentEvents)
      : 0;
  if (concealedRatio >= HIGH_CONCEALED_AUDIO_RATIO || concealmentEventsDelta >= 3) {
    return { state: "degraded", reason: `${Math.round(concealedRatio * 100)}% Audio ersetzt` };
  }
  if (current.jitterSeconds !== null && current.jitterSeconds >= HIGH_JITTER_SECONDS) {
    return { state: "degraded", reason: `${Math.round(current.jitterSeconds * 1_000)}ms Jitter` };
  }

  return { state: "healthy", reason: "Audiopakete laufen" };
}
