import type { Express } from "express";
import { consumers, producersByChannel, routersBySession, transports } from "../../state/media-state";

export function registerHealthRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      routers: routersBySession.size,
      transports: transports.size,
      producers: producersByChannel.size,
      consumers: consumers.size
    });
  });

  app.get("/metrics", (_req, res) => {
    const lines = [
      "# HELP liveaudio_media_routers mediasoup routers.",
      "# TYPE liveaudio_media_routers gauge",
      `liveaudio_media_routers ${routersBySession.size}`,
      "# HELP liveaudio_media_transports mediasoup transports.",
      "# TYPE liveaudio_media_transports gauge",
      `liveaudio_media_transports ${transports.size}`,
      "# HELP liveaudio_media_producers mediasoup producers.",
      "# TYPE liveaudio_media_producers gauge",
      `liveaudio_media_producers ${producersByChannel.size}`,
      "# HELP liveaudio_media_consumers mediasoup consumers.",
      "# TYPE liveaudio_media_consumers gauge",
      `liveaudio_media_consumers ${consumers.size}`,
      "# HELP liveaudio_media_process_rss_bytes media process RSS bytes.",
      "# TYPE liveaudio_media_process_rss_bytes gauge",
      `liveaudio_media_process_rss_bytes ${process.memoryUsage().rss}`,
      "# HELP liveaudio_media_process_uptime_seconds media process uptime seconds.",
      "# TYPE liveaudio_media_process_uptime_seconds gauge",
      `liveaudio_media_process_uptime_seconds ${process.uptime()}`
    ];

    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(`${lines.join("\n")}\n`);
  });
}
