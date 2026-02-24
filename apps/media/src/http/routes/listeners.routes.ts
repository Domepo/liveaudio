import type { Express } from "express";
import type { RtpCapabilities } from "mediasoup/node/lib/types";
import { createConsumer } from "../../services/consumer.service";
import { getOrCreateRouter } from "../../services/router.service";
import { createWebRtcTransport } from "../../services/transport.service";

type JoinBody = { sessionId: string };
type ListenerTransportBody = { clientId: string; sessionId: string; channelId: string };
type ConsumeBody = {
  clientId: string;
  transportId: string;
  sessionId: string;
  channelId: string;
  rtpCapabilities: RtpCapabilities;
};

export function registerListenerRoutes(app: Express): void {
  app.post("/listeners/join", async (req, res) => {
    const { sessionId } = req.body as JoinBody;
    const router = await getOrCreateRouter(sessionId);
    res.json({ rtpCapabilities: router.rtpCapabilities });
  });

  app.post("/listeners/transport", async (req, res) => {
    const { clientId, sessionId, channelId } = req.body as ListenerTransportBody;
    const router = await getOrCreateRouter(sessionId);
    const transport = await createWebRtcTransport(router);
    (transport.appData as any) = { role: "listener", clientId, sessionId, channelId };

    res.json({
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      rtpCapabilities: router.rtpCapabilities
    });
  });

  app.post("/listeners/consume", async (req, res) => {
    const result = await createConsumer(req.body as ConsumeBody);
    if (result.type === "transport_not_found") {
      return res.status(404).json({ error: "Transport not found" });
    }
    if (result.type === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (result.type === "router_not_found") {
      return res.status(404).json({ error: "Session router not found" });
    }
    if (result.type === "producer_not_found") {
      return res.status(404).json({ error: "No active producer for channel" });
    }
    if (result.type === "incompatible") {
      return res.status(400).json({ error: "Incompatible RTP capabilities" });
    }

    return res.status(201).json({
      consumerId: result.consumer.id,
      producerId: result.producerId,
      kind: result.consumer.kind,
      rtpParameters: result.consumer.rtpParameters,
      type: result.consumer.type
    });
  });
}
