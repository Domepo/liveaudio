import type { Router } from "mediasoup/node/lib/types";
import { mediaCodecs } from "../config/media";
import { routersBySession } from "../state/media-state";
import { getWorker } from "./worker.service";

export async function getOrCreateRouter(sessionId: string): Promise<Router> {
  const existing = routersBySession.get(sessionId);
  if (existing) {
    return existing;
  }

  const router = await getWorker().createRouter({ mediaCodecs });
  routersBySession.set(sessionId, router);
  return router;
}

