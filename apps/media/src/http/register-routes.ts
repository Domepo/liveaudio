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
  const protectedLimiter = createSimpleRateLimit(120, 60_000);
  const protectedPaths = [
    "/broadcasters/transport",
    "/broadcasters/produce",
    "/listeners/join",
    "/listeners/transport",
    "/listeners/consume",
    "/transports/connect",
    "/clients/disconnect",
    "/consumers/resume"
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
