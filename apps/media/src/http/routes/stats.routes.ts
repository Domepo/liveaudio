import type { Express } from "express";
import {
  activeChannelIdsForSession,
  activeProducerChannelsForSession,
  consumers,
  producersByChannel,
  routersBySession,
  transports
} from "../../state/media-state";

export function registerStatsRoutes(app: Express): void {
  app.get("/stats", (_req, res) => {
    res.json({
      routers: routersBySession.size,
      transports: transports.size,
      producers: producersByChannel.size,
      consumers: consumers.size
    });
  });

  app.get("/stats/session/:sessionId", (req, res) => {
    const sessionId = String(req.params.sessionId);
    const activeChannelIds = activeChannelIdsForSession(sessionId);
    res.json({
      sessionId,
      activeProducerChannels: activeProducerChannelsForSession(sessionId),
      activeChannelIds
    });
  });
}

