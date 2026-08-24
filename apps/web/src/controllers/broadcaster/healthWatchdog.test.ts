import { describe, expect, it } from "vitest";

import {
  calculateOutboundAudioMetrics,
  evaluateOutboundAudioHealth,
  summarizeOutboundAudioQuality,
  type OutboundAudioSnapshot
} from "./healthWatchdog";

const sample = (overrides: Partial<OutboundAudioSnapshot> = {}): OutboundAudioSnapshot => ({
  packetsSent: 1_000,
  packetsLost: 5,
  jitterSeconds: 0.01,
  roundTripSeconds: 0.05,
  ...overrides
});

describe("broadcaster audio health watchdog", () => {
  it("detects an outbound audio packet stall", () => {
    expect(evaluateOutboundAudioHealth(sample(), sample()).state).toBe("stalled");
  });

  it("detects sustained quality values that can precede crackling", () => {
    const previous = sample();
    const lossy = sample({ packetsSent: 1_090, packetsLost: 15 });
    const jittery = sample({ packetsSent: 1_100, jitterSeconds: 0.12 });

    expect(evaluateOutboundAudioHealth(previous, lossy)).toMatchObject({ state: "degraded", reason: "10% Paketverlust" });
    expect(evaluateOutboundAudioHealth(previous, jittery)).toMatchObject({ state: "degraded", reason: "120ms Jitter" });
  });

  it("keeps a normally advancing audio stream healthy", () => {
    expect(evaluateOutboundAudioHealth(sample(), sample({ packetsSent: 1_250, packetsLost: 6 }))).toMatchObject({ state: "healthy" });
  });

  it("calculates and classifies live dashboard quality metrics", () => {
    const good = calculateOutboundAudioMetrics(sample(), sample({ packetsSent: 1_100, packetsLost: 6, jitterSeconds: 0.012 }));
    const fair = calculateOutboundAudioMetrics(sample(), sample({ packetsSent: 1_095, packetsLost: 8, jitterSeconds: 0.04 }));
    const poor = calculateOutboundAudioMetrics(sample(), sample({ packetsSent: 1_090, packetsLost: 15 }));

    const goodSummary = summarizeOutboundAudioQuality([good]);
    expect(goodSummary).toMatchObject({ state: "good", jitterMs: 12 });
    expect(goodSummary.packetLossPercent).toBeCloseTo(0.99, 2);
    expect(summarizeOutboundAudioQuality([fair])).toMatchObject({ state: "fair", jitterMs: 40 });
    expect(summarizeOutboundAudioQuality([poor])).toMatchObject({ state: "poor", packetLossPercent: 10 });
  });
});
