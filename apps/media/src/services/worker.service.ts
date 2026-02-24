import * as mediasoup from "mediasoup";
import type { Worker } from "mediasoup/node/lib/types";
import { RTC_MAX_PORT, RTC_MIN_PORT } from "../config/media";

let worker: Worker | null = null;

export async function initWorker(): Promise<Worker> {
  worker = await mediasoup.createWorker({
    rtcMinPort: RTC_MIN_PORT,
    rtcMaxPort: RTC_MAX_PORT,
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"]
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

