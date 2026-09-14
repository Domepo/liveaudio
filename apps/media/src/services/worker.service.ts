import * as mediasoup from "mediasoup";
import type { WebRtcServer, Worker } from "mediasoup/node/lib/types";
import { MEDIA_ANNOUNCED_IP, MEDIA_LISTEN_IP, RTC_PORT } from "../config/media";

let worker: Worker | null = null;
let webRtcServer: WebRtcServer | null = null;

export async function initWorker(): Promise<Worker> {
  worker = await mediasoup.createWorker({
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"]
  });

  webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      {
        protocol: "udp",
        ip: MEDIA_LISTEN_IP,
        announcedAddress: MEDIA_ANNOUNCED_IP,
        port: RTC_PORT
      },
      {
        protocol: "tcp",
        ip: MEDIA_LISTEN_IP,
        announcedAddress: MEDIA_ANNOUNCED_IP,
        port: RTC_PORT
      }
    ]
  });

  worker.on("died", () => {
    // eslint-disable-next-line no-console
    console.error("mediasoup worker died");
    process.exit(1);
  });

  return worker;
}

export function getWorker(): Worker {
  if (!worker) {
    throw new Error("Worker is not initialized");
  }
  return worker;
}

export function getWebRtcServer(): WebRtcServer {
  if (!webRtcServer) {
    throw new Error("WebRTC server is not initialized");
  }
  return webRtcServer;
}
