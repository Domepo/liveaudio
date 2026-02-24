import type { Express } from "express";
import { createProducer } from "../../services/producer.service";
import { getOrCreateRouter } from "../../services/router.service";
import { createWebRtcTransport } from "../../services/transport.service";

type BroadcasterTransportBody = { clientId: string; sessionId: string; channelId: string };
type ProduceBody = {
  clientId: string;
  transportId: string;
  sessionId: string;
  channelId: string;
  kind: "audio";
  rtpParameters: unknown;
};

export function registerBroadcasterRoutes(app: Express): void {
  app.post("/broadcasters/transport", async (req, res) => {
    const { clientId, sessionId, channelId } = req.body as BroadcasterTransportBody;
    const router = await getOrCreateRouter(sessionId);
    const transport = await createWebRtcTransport(router);
    (transport.appData as any) = { role: "broadcaster", clientId, sessionId, channelId };

    res.json({
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    });
  });

  app.post("/broadcasters/produce", async (req, res) => {
    const result = await createProducer(req.body as ProduceBody);
    if (result.type === "transport_not_found") {
      return res.status(404).json({ error: "Transport not found" });
    }
    if (result.type === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    return res.status(201).json({ producerId: result.producer.id });
  });
}
