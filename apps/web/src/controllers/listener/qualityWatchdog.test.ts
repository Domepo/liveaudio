import { describe, expect, it } from "vitest";

import { evaluateInboundAudioHealth, type InboundAudioSnapshot } from "./qualityWatchdog";

const sample = (overrides: Partial<InboundAudioSnapshot> = {}): InboundAudioSnapshot => ({
  packetsReceived: 1_000,
  packetsLost: 2,
  jitterSeconds: 0.01,
  concealedSamples: 100,
  totalSamplesReceived: 480_000,
  concealmentEvents: 1,
  ...overrides
});

describe("listener audio quality watchdog", () => {
  it("detects a receive stall", () => {
    expect(evaluateInboundAudioHealth(sample(), sample()).state).toBe("stalled");
  });

  it("detects decoder concealment that can be heard as crackling", () => {
    const previous = sample();
    const current = sample({
      packetsReceived: 1_250,
      concealedSamples: 30_100,
      totalSamplesReceived: 720_000,
      concealmentEvents: 6
    });
    expect(evaluateInboundAudioHealth(previous, current)).toMatchObject({ state: "degraded", reason: "11% Audio ersetzt" });
  });

  it("keeps a clean advancing stream healthy", () => {
    expect(
      evaluateInboundAudioHealth(sample(), sample({ packetsReceived: 1_250, totalSamplesReceived: 720_000, concealedSamples: 105 }))
    ).toMatchObject({ state: "healthy" });
  });
});
