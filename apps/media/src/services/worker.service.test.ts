import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const webRtcServer = { id: "shared-web-rtc-server" };
  const createWebRtcServer = vi.fn().mockResolvedValue(webRtcServer);
  const on = vi.fn();
  const worker = { createWebRtcServer, on };
  const createWorker = vi.fn().mockResolvedValue(worker);

  return { createWebRtcServer, createWorker, on, webRtcServer, worker };
});

vi.mock("mediasoup", () => ({
  createWorker: mocks.createWorker
}));

import { getWebRtcServer, initWorker } from "./worker.service";

describe("worker service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shares one UDP/TCP port across all WebRTC transports", async () => {
    await initWorker();

    expect(mocks.createWorker).toHaveBeenCalledWith({
      logLevel: "warn",
      logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"]
    });
    expect(mocks.createWebRtcServer).toHaveBeenCalledWith({
      listenInfos: [
        expect.objectContaining({ protocol: "udp", port: 40000 }),
        expect.objectContaining({ protocol: "tcp", port: 40000 })
      ]
    });
    expect(getWebRtcServer()).toBe(mocks.webRtcServer);
  });
});
