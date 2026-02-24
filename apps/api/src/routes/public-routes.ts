import type { Express, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";

type PublicRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  detectLanIp: () => string;
  getAppLogoBranding: () => Promise<{ logoUrl: string; version: string }>;
};

export function registerPublicRoutes(deps: PublicRoutesDeps): void {
  const { app, prisma, detectLanIp, getAppLogoBranding } = deps;

  app.get("/health", async (_req, res) => {
    const sessions = await prisma.session.count({ where: { status: "ACTIVE" } });
    const channels = await prisma.channel.count({ where: { isActive: true } });
    res.json({ ok: true, sessions, channels });
  });

  app.get("/metrics", async (_req, res) => {
    const sessions = await prisma.session.count({ where: { status: "ACTIVE" } });
    const channels = await prisma.channel.count({ where: { isActive: true } });
    const rssBytes = process.memoryUsage().rss;
    const uptimeSec = process.uptime();

    const lines = [
      "# HELP liveaudio_api_active_sessions Active API sessions.",
      "# TYPE liveaudio_api_active_sessions gauge",
      `liveaudio_api_active_sessions ${sessions}`,
      "# HELP liveaudio_api_active_channels Active API channels.",
      "# TYPE liveaudio_api_active_channels gauge",
      `liveaudio_api_active_channels ${channels}`,
      "# HELP liveaudio_api_process_rss_bytes API process RSS bytes.",
      "# TYPE liveaudio_api_process_rss_bytes gauge",
      `liveaudio_api_process_rss_bytes ${rssBytes}`,
      "# HELP liveaudio_api_process_uptime_seconds API process uptime seconds.",
      "# TYPE liveaudio_api_process_uptime_seconds gauge",
      `liveaudio_api_process_uptime_seconds ${uptimeSec}`
    ];

    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(`${lines.join("\n")}\n`);
  });

  app.get("/api/network", (req: Request, res: Response) => {
    const reqHost = req.get("host") ?? "";
    const reqHostname = reqHost.split(":")[0] || "localhost";
    const lanIp = detectLanIp();
    const webPort = process.env.PUBLIC_WEB_PORT ?? "5173";
    const useDefaultPort = webPort === "80" || webPort === "443";
    const suggestedJoinBaseUrl = `http://${lanIp}${useDefaultPort ? "" : `:${webPort}`}`;
    const currentHostJoinBaseUrl = `http://${reqHostname}${useDefaultPort ? "" : `:${webPort}`}`;
    res.json({ lanIp, suggestedJoinBaseUrl, currentHostJoinBaseUrl });
  });

  app.get("/api/public/branding", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const branding = await getAppLogoBranding();
    return res.json(branding);
  });

  app.get("/api/public/sessions/:sessionId", async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") {
      return res.status(404).json({ error: "Session not found" });
    }

    const channels = await prisma.channel.findMany({
      where: { sessionId, isActive: true },
      orderBy: { createdAt: "asc" }
    });

    return res.json({
      session: { id: session.id, name: session.name, description: session.description, imageUrl: session.imageUrl },
      channels
    });
  });
}
