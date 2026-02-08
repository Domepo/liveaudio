import "dotenv/config";
import os from "node:os";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import * as mediasoup from "mediasoup";
import type {
  Consumer,
  Producer,
  Router,
  RouterRtpCodecCapability,
  RtpCapabilities,
  WebRtcTransport,
  Worker
} from "mediasoup/node/lib/types";

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

const MEDIA_PORT = Number(process.env.MEDIA_PORT ?? 4000);
const MEDIA_LISTEN_IP = process.env.MEDIA_LISTEN_IP ?? "0.0.0.0";
const RTC_MIN_PORT = Number(process.env.RTC_MIN_PORT ?? 40000);
const RTC_MAX_PORT = Number(process.env.RTC_MAX_PORT ?? 49999);

function detectLanIp(): string {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

const MEDIA_ANNOUNCED_IP = process.env.MEDIA_ANNOUNCED_IP || detectLanIp();

let worker: Worker;
const routersBySession = new Map<string, Router>();
const transports = new Map<string, WebRtcTransport>();
const producersByChannel = new Map<string, Producer>();
const consumers = new Map<string, Consumer>();

const mediaCodecs: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
      usedtx: 1
    }
  }
];

function channelKey(sessionId: string, channelId: string): string {
  return `${sessionId}:${channelId}`;
}

async function getOrCreateRouter(sessionId: string): Promise<Router> {
  const existing = routersBySession.get(sessionId);
  if (existing) {
    return existing;
  }

  const router = await worker.createRouter({ mediaCodecs });
  routersBySession.set(sessionId, router);
  return router;
}

async function createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: "udp",
        ip: MEDIA_LISTEN_IP,
        announcedAddress: MEDIA_ANNOUNCED_IP
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 300000,
    appData: {}
  } as any);

  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") {
      transport.close();
      transports.delete(transport.id);
    }
  });

  transport.on("@close", () => {
    transports.delete(transport.id);
  });

  transports.set(transport.id, transport);
  return transport;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    routers: routersBySession.size,
    transports: transports.size,
    producers: producersByChannel.size,
    consumers: consumers.size
  });
});

app.post("/listeners/join", async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  const router = await getOrCreateRouter(sessionId);
  res.json({ rtpCapabilities: router.rtpCapabilities });
});

app.post("/broadcasters/transport", async (req, res) => {
  const { sessionId, channelId } = req.body as { sessionId: string; channelId: string };
  const router = await getOrCreateRouter(sessionId);
  const transport = await createWebRtcTransport(router);
  (transport.appData as any) = { role: "broadcaster", sessionId, channelId };

  res.json({
    transportId: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });
});

app.post("/listeners/transport", async (req, res) => {
  const { sessionId, channelId } = req.body as { sessionId: string; channelId: string };
  const router = await getOrCreateRouter(sessionId);
  const transport = await createWebRtcTransport(router);
  (transport.appData as any) = { role: "listener", sessionId, channelId };

  res.json({
    transportId: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    rtpCapabilities: router.rtpCapabilities
  });
});

app.post("/transports/connect", async (req, res) => {
  const { transportId, dtlsParameters } = req.body as { transportId: string; dtlsParameters: unknown };
  const transport = transports.get(transportId);
  if (!transport) {
    return res.status(404).json({ error: "Transport not found" });
  }

  await transport.connect({ dtlsParameters: dtlsParameters as any });
  return res.json({ ok: true });
});

app.post("/broadcasters/produce", async (req, res) => {
  const { transportId, sessionId, channelId, kind, rtpParameters } = req.body as {
    transportId: string;
    sessionId: string;
    channelId: string;
    kind: "audio";
    rtpParameters: unknown;
  };

  const transport = transports.get(transportId);
  if (!transport) {
    return res.status(404).json({ error: "Transport not found" });
  }

  const producer = await transport.produce({ kind, rtpParameters: rtpParameters as any });
  const key = channelKey(sessionId, channelId);

  const oldProducer = producersByChannel.get(key);
  if (oldProducer) {
    oldProducer.close();
  }

  producersByChannel.set(key, producer);
  producer.on("@close", () => {
    producersByChannel.delete(key);
  });

  return res.status(201).json({ producerId: producer.id });
});

app.post("/listeners/consume", async (req, res) => {
  const { transportId, sessionId, channelId, rtpCapabilities } = req.body as {
    transportId: string;
    sessionId: string;
    channelId: string;
    rtpCapabilities: RtpCapabilities;
  };

  const transport = transports.get(transportId);
  if (!transport) {
    return res.status(404).json({ error: "Transport not found" });
  }

  const router = routersBySession.get(sessionId);
  if (!router) {
    return res.status(404).json({ error: "Session router not found" });
  }

  const producer = producersByChannel.get(channelKey(sessionId, channelId));
  if (!producer) {
    return res.status(404).json({ error: "No active producer for channel" });
  }

  if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
    return res.status(400).json({ error: "Incompatible RTP capabilities" });
  }

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities,
    paused: true
  });

  consumers.set(consumer.id, consumer);
  consumer.on("@close", () => {
    consumers.delete(consumer.id);
  });

  return res.status(201).json({
    consumerId: consumer.id,
    producerId: producer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type
  });
});

app.post("/consumers/resume", async (req, res) => {
  const { consumerId } = req.body as { consumerId: string };
  const consumer = consumers.get(consumerId);
  if (!consumer) {
    return res.status(404).json({ error: "Consumer not found" });
  }

  await consumer.resume();
  return res.json({ ok: true });
});

async function start(): Promise<void> {
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

  app.listen(MEDIA_PORT, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log(`Media service listening on 0.0.0.0:${MEDIA_PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
