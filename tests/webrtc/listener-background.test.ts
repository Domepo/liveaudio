import http from "node:http";
import path from "node:path";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { chromium, type Browser, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { registerSocketRealtime } from "../../apps/api/src/realtime/socket";
import { registerRoutes } from "../../apps/media/src/http/register-routes";
import { initWorker } from "../../apps/media/src/services/worker.service";
import { getOrCreateRouter } from "../../apps/media/src/services/router.service";
import { connectTransport, createWebRtcTransport } from "../../apps/media/src/services/transport.service";
import { createProducer } from "../../apps/media/src/services/producer.service";
import { consumers, transports, producersByChannel } from "../../apps/media/src/state/media-state";

let browser: Browser;
let vite: ViteDevServer;
let io: Server;
let apiServer: http.Server;
let mediaServer: http.Server;
let worker: Awaited<ReturnType<typeof initWorker>>;
let producerPage: Page;
let url = "";
let blockReconnect = false;
const pendingConnections: (() => void)[] = [];
const helper = `/@fs${path.resolve("tests/webrtc/browser.ts")}`;

function origin(server: http.Server): string {
  return `http://127.0.0.1:${(server.address() as any).port}`;
}

async function fixturePage(): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const Original = window.RTCPeerConnection;
    (window as any).testPeers = [];
    window.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        (window as any).testPeers.push(this);
      }
    };
  });
  await page.goto(url);
  await page.addScriptTag({ type: "module", content: `import * as helper from ${JSON.stringify(helper)}; window.testHelper = helper;` });
  await page.waitForFunction(() => Boolean((window as any).testHelper));
  return page;
}

async function audioStats(page: Page): Promise<{ packets: number; energy: number }> {
  return page.evaluate(async () => {
    let packets = 0;
    let energy = 0;
    for (const peer of (window as any).testPeers as RTCPeerConnection[]) {
      const stats = await peer.getStats();
      stats.forEach((stat) => {
        if (stat.type === "inbound-rtp" && stat.kind === "audio") {
          packets += stat.packetsReceived ?? 0;
          energy += stat.totalAudioEnergy ?? 0;
        }
      });
    }
    return { packets, energy };
  });
}

beforeAll(async () => {
  worker = await initWorker();
  const media = express();
  media.use(express.json());
  registerRoutes(media);
  mediaServer = media.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => mediaServer.once("listening", resolve));

  const api = express();
  api.use(cors({ origin: true, credentials: true }));
  apiServer = http.createServer(api);
  io = new Server(apiServer, { cors: { origin: true, credentials: true } });
  io.on("connection", (socket) => socket.on("disconnect", (reason) => console.log("TEST signaling disconnected:", reason)));
  io.use((_socket, next) => {
    if (blockReconnect) pendingConnections.push(() => next());
    else next();
  });
  registerSocketRealtime({
    io,
    prisma: { accessLog: { create: vi.fn().mockResolvedValue({}) } } as any,
    MEDIA_BASE_URL: origin(mediaServer), MEDIA_INTERNAL_TOKEN: "",
    decodeAdminWsJwt: vi.fn(), readValidatedAdminFromCookieHeader: vi.fn(),
    isSessionVersionCurrent: vi.fn(),
    findActiveSessionByCode: async (code) => code === "123456" ? { id: "background-test-session", broadcastCode: null, broadcastCodeHash: null } : null,
    hasSessionAccess: vi.fn(), isListenerAuth: ((auth: any) => auth.role === "LISTENER") as any,
    addSocketToRoleMap: (map, session, id) => { const set = map.get(session) ?? new Set(); set.add(id); map.set(session, set); },
    removeSocketFromRoleMap: (map, session, id) => { map.get(session)?.delete(id); },
    changeLiveListenerCount: vi.fn(), recordLiveSnapshot: vi.fn(), clearSessionAnalyticsState: vi.fn(),
    markSessionStatsSinceNow: vi.fn(), recordAnalyticsPoint: vi.fn().mockResolvedValue(undefined),
    getBroadcastOwner: () => null, getSessionLiveMode: () => "mic", setSessionLiveMode: vi.fn(),
    clearSessionLiveMode: vi.fn(), setBroadcastOwner: vi.fn(), clearBroadcastOwner: vi.fn(),
    getDebugMode: () => false, testToneWatchdogStore: { removeClient: vi.fn() } as any,
    listenerSocketsBySession: new Map(), broadcasterSocketsBySession: new Map(), listenerStateBySocket: new Map()
  });
  apiServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => apiServer.once("listening", resolve));

  vite = await createServer({
    configFile: false, root: path.resolve("apps/web"), appType: "custom",
    optimizeDeps: { entries: [path.resolve("tests/webrtc/browser.ts")] },
    plugins: [{ name: "isolated-test-page", configureServer(server) {
      server.middlewares.use("/background-test", (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><html><head><title>Isolated WebRTC test</title></head><body></body></html>");
      });
    } }],
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(origin(apiServer)), "import.meta.env.VITE_WS_URL": JSON.stringify(origin(apiServer)) },
    server: { host: "127.0.0.1", port: 0, fs: { allow: [process.cwd()] } }
  });
  await vite.listen();
  url = `${origin(vite.httpServer!)}/background-test`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });

  const router = await getOrCreateRouter("background-test-session");
  const transport = await createWebRtcTransport(router);
  transport.appData = { role: "broadcaster", clientId: "test-producer", sessionId: "background-test-session", channelId: "background-test-channel" };
  producerPage = await fixturePage();
  await producerPage.exposeFunction("connectProducer", (dtlsParameters) => connectTransport(transport.id, dtlsParameters, "test-producer"));
  await producerPage.exposeFunction("createProducer", async (rtpParameters) => {
    const result = await createProducer({ clientId: "test-producer", transportId: transport.id, sessionId: "background-test-session", channelId: "background-test-channel", kind: "audio", rtpParameters });
    if (result.type !== "ok") throw new Error(result.type);
    return result.producer.id;
  });
  await producerPage.evaluate(async ({ data }) => (window as any).testHelper.produce(data), {
    helper, data: { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters, rtpCapabilities: router.rtpCapabilities }
  });
});

afterEach(async () => {
  blockReconnect = false;
  pendingConnections.splice(0).forEach((next) => next());
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) if (page !== producerPage) await page.close();
  }
  for (const transport of transports.values()) if (transport.appData.role === "listener") transport.close();
});

afterAll(async () => {
  blockReconnect = false;
  pendingConnections.splice(0).forEach((next) => next());
  await browser?.close();
  await vite?.close();
  await new Promise<void>((resolve) => io?.close(() => resolve()));
  await new Promise<void>((resolve) => mediaServer?.close(() => resolve()));
  worker?.close();
});

it("receives actual audio and preserves it when only signaling is interrupted", async () => {
  const page = await fixturePage();
  await page.evaluate(async () => (window as any).testHelper.listen());
  await expect.poll(async () => (await audioStats(page)).energy, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).testHelper.status())).toEqual({ listening: true, paused: false, hasStream: true });
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  const before = await audioStats(page);
  const previousConsumerId = [...consumers.keys()][0];
  console.log("BEFORE signaling interruption", before, "consumers", consumers.size);

  blockReconnect = true;
  for (const socket of io.sockets.sockets.values()) socket.conn.transport.close();
  // Longer than the usual signaling heartbeat and ICE consent timeouts.
  await new Promise((resolve) => setTimeout(resolve, 65_000));
  const after = await audioStats(page);
  console.log("AFTER signaling interruption", after, "consumers", consumers.size);
  expect(after.packets).toBeGreaterThan(before.packets);
  expect(after.energy).toBeGreaterThan(before.energy);
  expect(await page.evaluate(() => (window as any).testHelper.status())).toEqual({ listening: true, paused: false, hasStream: true });

  blockReconnect = false;
  pendingConnections.splice(0).forEach((next) => next());
  await expect.poll(() => io.sockets.sockets.size, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => [...consumers.keys()].filter((id) => id !== previousConsumerId).length, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await audioStats(page)).energy, { timeout: 15_000 }).toBeGreaterThan(0);
  const resumed = await audioStats(page);
  await expect.poll(async () => (await audioStats(page)).packets, { timeout: 15_000 }).toBeGreaterThan(resumed.packets);
  await page.evaluate(async () => (window as any).testHelper.stopListening());
  await expect.poll(() => consumers.size).toBe(0);
  expect([...transports.values()].filter((t) => t.appData.role === "listener")).toHaveLength(0);
  await page.close();
});

it("releases the receiver when the user stops during a signaling outage", async () => {
  const page = await fixturePage();
  await page.evaluate(async () => (window as any).testHelper.listen());
  await expect.poll(async () => (await audioStats(page)).energy).toBeGreaterThan(0);
  blockReconnect = true;
  for (const socket of io.sockets.sockets.values()) socket.conn.transport.close();
  await expect.poll(() => io.sockets.sockets.size).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).testHelper.isSignalingConnected())).toBe(false);
  await page.evaluate(async () => (window as any).testHelper.stopListening());
  // With signaling unavailable, a native peer close is detected through ICE
  // consent (30s) plus the recovery grace (15s), rather than an HTTP request.
  await expect.poll(() => consumers.size, { timeout: 50_000 }).toBe(0);
  await expect.poll(() => [...transports.values()].filter((t) => t.appData.role === "listener").length).toBe(0);
  blockReconnect = false;
  pendingConnections.splice(0).forEach((next) => next());
  await page.close();
});

it("releases a detached receiver when the broadcast ends", async () => {
  const page = await fixturePage();
  await page.evaluate(async () => (window as any).testHelper.listen());
  await expect.poll(async () => (await audioStats(page)).energy).toBeGreaterThan(0);
  blockReconnect = true;
  for (const socket of io.sockets.sockets.values()) socket.conn.transport.close();
  await expect.poll(() => io.sockets.sockets.size).toBe(0);
  // Let the API's internal disconnect request reach the media service.
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const producer of producersByChannel.values()) producer.close();
  await expect.poll(() => consumers.size).toBe(0);
  await expect.poll(() => [...transports.values()].filter((t) => t.appData.role === "listener").length).toBe(0);
  await page.close();
  blockReconnect = false;
  pendingConnections.splice(0).forEach((next) => next());
});
