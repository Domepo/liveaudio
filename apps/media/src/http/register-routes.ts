import type { Express } from "express";
import { requireInternalApiToken } from "./middleware/internal-auth";
import { createSimpleRateLimit } from "./middleware/simple-rate-limit";
import { registerBroadcasterRoutes } from "./routes/broadcasters.routes";
import { registerConsumerRoutes } from "./routes/consumers.routes";
import { registerHealthRoutes } from "./routes/health.routes";
import { registerListenerRoutes } from "./routes/listeners.routes";
import { registerStatsRoutes } from "./routes/stats.routes";
import { registerTransportRoutes } from "./routes/transports.routes";

export function registerRoutes(app: Express): void {
  // These routes are reachable only by the authenticated API service. A
  // broadcaster recovery can legitimately reconnect every listener at once;
  // 120 requests/minute was too low for 20+ listeners and caused cleanup calls
  // themselves to be rejected with 429, leaving media resources behind.
  const protectedLimiter = createSimpleRateLimit(1_000, 60_000);
  const protectedPaths = [
    "/broadcasters/transport",
    "/broadcasters/produce",
    "/listeners/join",
    "/listeners/transport",
    "/listeners/consume",
    "/transports/connect",
    "/transports/close",
    "/clients/disconnect",
    "/consumers/resume",
    "/consumers/close"
  ];
  for (const path of protectedPaths) {
    app.use(path, requireInternalApiToken, protectedLimiter);
  }

  registerHealthRoutes(app);
  registerStatsRoutes(app);
  registerListenerRoutes(app);
  registerBroadcasterRoutes(app);
  registerTransportRoutes(app);
  registerConsumerRoutes(app);
}
