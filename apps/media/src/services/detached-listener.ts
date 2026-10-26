import type { Consumer, WebRtcTransport } from "mediasoup/node/lib/types";

// Signaling may sleep while the browser's native WebRTC/audio threads keep
// running. ICE consent, rather than a JavaScript heartbeat, proves liveness.
const DETACHED_MEDIA_RECOVERY_MS = 15_000;
const detached = new WeakSet<WebRtcTransport>();

export function hasConnectedMedia(transport: WebRtcTransport): boolean {
  return !transport.closed && transport.dtlsState === "connected" &&
    (transport.iceState === "connected" || transport.iceState === "completed");
}

export function retainConnectedListener(transport: WebRtcTransport, consumer: Consumer): void {
  if (detached.has(transport)) return;
  detached.add(transport);
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => {
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = null;
  };
  const close = () => {
    if (!transport.closed) transport.close();
  };
  const checkConnection = () => {
    if (hasConnectedMedia(transport)) {
      clearTimer();
    } else if (!cleanupTimer) {
      cleanupTimer = setTimeout(() => {
        cleanupTimer = null;
        if (!hasConnectedMedia(transport)) close();
      }, DETACHED_MEDIA_RECOVERY_MS);
      cleanupTimer.unref();
    }
  };
  transport.on("icestatechange", checkConnection);
  transport.on("dtlsstatechange", checkConnection);
  // A stopped broadcast must also release listeners whose signaling is asleep.
  consumer.observer.once("close", close);
  transport.observer.once("close", () => {
    clearTimer();
    transport.off("icestatechange", checkConnection);
    transport.off("dtlsstatechange", checkConnection);
    consumer.observer.off("close", close);
  });
}
