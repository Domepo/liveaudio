import { Device } from "mediasoup-client";
import { io } from "socket.io-client";
import { get } from "svelte/store";

import { wsUrl } from "../../lib/config";
import { emitAck, waitForSocketConnect } from "../../lib/socketAck";
import { jitterMs } from "../../lib/time";
import { app } from "../../stores/app";
import { tr } from "../../i18n";
import { setStatus } from "../logging";
import { listenerAudioEl } from "../refs";
import {
  listenerReconnectTimer,
  listenerSocket,
  setListenerReconnectTimer,
  setListenerSocket
} from "../runtime";

import { validateJoin } from "./join";
import {
  LISTENER_BAD_SAMPLES_BEFORE_RECOVERY,
  LISTENER_QUALITY_POLL_MS,
  evaluateInboundAudioHealth,
  snapshotInboundAudioStats,
  type InboundAudioSnapshot
} from "./qualityWatchdog";

let producerSwitchReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastProducerSwitchReconnectAt = 0;
let activeRecvTransport: ReturnType<Device["createRecvTransport"]> | null = null;
let activeConsumer: Awaited<ReturnType<ReturnType<Device["createRecvTransport"]>["consume"]>> | null = null;
let activeTransportId = "";
let activeLiveMode: "none" | "mic" | "preshow" | "testtone" = "none";
let watchdogAudioContext: AudioContext | null = null;
let watchdogAnalyser: AnalyserNode | null = null;
let watchdogSource: MediaElementAudioSourceNode | null = null;
let watchdogSinkGain: GainNode | null = null;
let watchdogFreqData: Float32Array | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let watchdogLastState: "hearing" | "lost" | null = null;
let watchdogStateSinceMs = 0;
let watchdogReportedState: "hearing" | "lost" | null = null;
let listenerQualityTimer: ReturnType<typeof setInterval> | null = null;
let listenerQualityCheckInFlight = false;
let listenerBadQualitySamples = 0;
let listenerQualitySnapshot: InboundAudioSnapshot | null = null;

function detectTestTone400(freqData: Float32Array, sampleRate: number): boolean {
  const nyquist = sampleRate / 2;
  const binHz = nyquist / freqData.length;
  const fromHz = 300;
  const toHz = 520;
  const fromBin = Math.max(2, Math.round(fromHz / binHz));
  const toBin = Math.min(freqData.length - 2, Math.round(toHz / binHz));

  let peakDb = -160;
  for (let i = fromBin; i <= toBin; i += 1) {
    if (freqData[i] > peakDb) peakDb = freqData[i];
  }

  let bandSum = 0;
  let bandCount = 0;
  const bandFrom = Math.max(2, Math.round(120 / binHz));
  const bandTo = Math.min(freqData.length - 2, Math.round(2000 / binHz));
  for (let i = bandFrom; i <= bandTo; i += 1) {
    bandSum += freqData[i];
    bandCount += 1;
  }
  const bandDb = bandSum / Math.max(1, bandCount);

  const hasTonePeak = peakDb > -86 && peakDb - bandDb > 2;
  const hasUsableSignal = bandDb > -60;
  return hasTonePeak || hasUsableSignal;
}

function getMediaSessionSupport(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return null;
  return navigator.mediaSession;
}

function updateMediaSessionState(next: "none" | "paused" | "playing"): void {
  const mediaSession = getMediaSessionSupport();
  if (!mediaSession) return;
  try {
    mediaSession.playbackState = next;
  } catch {
    // ignore partial browser implementations
  }
}

function updateMediaSessionMetadata(): void {
  const mediaSession = getMediaSessionSupport();
  if (!mediaSession || typeof MediaMetadata === "undefined") return;
  const state = get(app);
  const channel = state.listenerChannels.find((item) => item.id === (state.activeListeningChannelId || state.selectedChannelId));
  const artwork = state.listenerSessionImageUrl
    ? [{ src: state.listenerSessionImageUrl, sizes: "512x512", type: "image/png" }]
    : [];
  try {
    mediaSession.metadata = new MediaMetadata({
      title: `${state.listenerSessionName || tr("common.session")} - ${channel?.name || tr("listener.audio_channel")}`,
      artist: tr("common.app_name"),
      album: state.listenerSessionName || tr("common.session"),
      artwork
    });
  } catch {
    // ignore metadata errors on unsupported browsers
  }
}

let mediaSessionActionsRegistered = false;
function registerMediaSessionActions(): void {
  if (mediaSessionActionsRegistered) return;
  const mediaSession = getMediaSessionSupport();
  if (!mediaSession) return;
  try {
    mediaSession.setActionHandler("play", () => {
      void resumeListening();
    });
    mediaSession.setActionHandler("pause", () => {
      void pauseListening();
    });
    mediaSession.setActionHandler("stop", () => {
      void stopListening();
    });
  } catch {
    // ignore action handler errors on partial implementations
  }
  mediaSessionActionsRegistered = true;
}

function emitTestToneState(state: "hearing" | "lost"): void {
  if (!listenerSocket) return;
  const channelId = get(app).activeListeningChannelId || get(app).selectedChannelId;
  listenerSocket.emit("listener:testToneState", { channelId, state });
}

function stopTestToneWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  try {
    watchdogSource?.disconnect();
  } catch {
    // ignore cleanup error
  }
  watchdogSource = null;
  try {
    watchdogSinkGain?.disconnect();
  } catch {
    // ignore cleanup error
  }
  watchdogSinkGain = null;
  watchdogAnalyser = null;
  watchdogFreqData = null;
  if (watchdogAudioContext) {
    void watchdogAudioContext.close().catch(() => undefined);
  }
  watchdogAudioContext = null;
  watchdogLastState = null;
  watchdogStateSinceMs = 0;
  watchdogReportedState = null;
}

async function startTestToneWatchdog(): Promise<void> {
  if (activeLiveMode !== "testtone") {
    stopTestToneWatchdog();
    return;
  }
  if (!listenerAudioEl) return;
  stopTestToneWatchdog();

  try {
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaElementSource(listenerAudioEl);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    const sinkGain = ctx.createGain();
    sinkGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(sinkGain);
    sinkGain.connect(ctx.destination);
    const freqData = new Float32Array(analyser.frequencyBinCount);
    watchdogAudioContext = ctx;
    watchdogSource = source;
    watchdogSinkGain = sinkGain;
    watchdogAnalyser = analyser;
    watchdogFreqData = freqData;

    watchdogTimer = setInterval(() => {
      if (!watchdogAnalyser || !watchdogFreqData || !watchdogAudioContext) return;
      watchdogAnalyser.getFloatFrequencyData(watchdogFreqData);
      const hearingNow = detectTestTone400(watchdogFreqData, watchdogAudioContext.sampleRate);
      const candidate: "hearing" | "lost" = hearingNow ? "hearing" : "lost";
      const now = Date.now();
      if (watchdogLastState !== candidate) {
        watchdogLastState = candidate;
        watchdogStateSinceMs = now;
        return;
      }
      if (now - watchdogStateSinceMs < 1200) return;
      if (watchdogReportedState === candidate) return;
      watchdogReportedState = candidate;
      emitTestToneState(candidate);
    }, 450);
  } catch {
    emitTestToneState("lost");
  }
}

export function initListenerPlaybackController(): () => void {
  registerMediaSessionActions();
  return () => undefined;
}

async function ensureAudioPlayback(): Promise<void> {
  if (!listenerAudioEl) throw new Error("Audio element not available");
  listenerAudioEl.autoplay = true;
  listenerAudioEl.playsInline = true;
  listenerAudioEl.preload = "auto";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await listenerAudioEl.play();
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  throw new Error("Audio Wiedergabe konnte nicht gestartet werden");
}

function closeActiveListenerMedia(): void {
  activeTransportId = "";
  const consumer = activeConsumer;
  activeConsumer = null;
  if (consumer) {
    try {
      consumer.close();
    } catch {
      // ignore cleanup error
    }
  }
  const recvTransport = activeRecvTransport;
  activeRecvTransport = null;
  if (recvTransport) {
    try {
      recvTransport.close();
    } catch {
      // ignore cleanup error
    }
  }
}

function stopListenerQualityWatchdog(): void {
  if (listenerQualityTimer) {
    clearInterval(listenerQualityTimer);
    listenerQualityTimer = null;
  }
  listenerQualityCheckInFlight = false;
  listenerBadQualitySamples = 0;
  listenerQualitySnapshot = null;
}

async function checkListenerAudioQuality(): Promise<void> {
  if (listenerQualityCheckInFlight || !activeConsumer || !get(app).listenerWantsListen) return;
  const consumer = activeConsumer;
  listenerQualityCheckInFlight = true;
  try {
    const snapshot = snapshotInboundAudioStats(await consumer.getStats());
    if (activeConsumer !== consumer) return;
    const health = evaluateInboundAudioHealth(listenerQualitySnapshot, snapshot);
    listenerQualitySnapshot = snapshot;
    listenerBadQualitySamples = health.state === "healthy" ? 0 : listenerBadQualitySamples + 1;
    if (listenerBadQualitySamples >= LISTENER_BAD_SAMPLES_BEFORE_RECOVERY) {
      listenerBadQualitySamples = 0;
      scheduleListenerReconnect(`Audio-Watchdog: ${health.reason}`);
    }
  } catch {
    if (activeConsumer !== consumer) return;
    listenerBadQualitySamples += 1;
    if (listenerBadQualitySamples >= LISTENER_BAD_SAMPLES_BEFORE_RECOVERY) {
      listenerBadQualitySamples = 0;
      scheduleListenerReconnect("Audio-Watchdog: WebRTC-Statistik nicht erreichbar");
    }
  } finally {
    listenerQualityCheckInFlight = false;
  }
}

function startListenerQualityWatchdog(): void {
  stopListenerQualityWatchdog();
  listenerQualityTimer = setInterval(() => {
    void checkListenerAudioQuality();
  }, LISTENER_QUALITY_POLL_MS);
}

function scheduleListenerReconnect(reason: string): void {
  const s = get(app);
  if (!s.listenerWantsListen || !s.activeListeningChannelId || listenerReconnectTimer) return;

  const nextAttempts = s.listenerReconnectAttempts + 1;
  app.update((prev) => ({ ...prev, listenerReconnectAttempts: nextAttempts }));
  stopListenerQualityWatchdog();

  // Install the timer before disconnecting: Socket.IO emits "disconnect"
  // synchronously, and that handler must not schedule a second reconnect.
  const delay = Math.min(10_000, 300 * 2 ** (nextAttempts - 1));
  setListenerReconnectTimer(
    setTimeout(() => {
      setListenerReconnectTimer(null);
      void startListening(get(app).activeListeningChannelId);
    }, jitterMs(delay))
  );

  const socket = listenerSocket;
  setListenerSocket(null);
  socket?.disconnect();
  closeActiveListenerMedia();

  if (listenerAudioEl) {
    listenerAudioEl.pause();
    listenerAudioEl.srcObject = null;
  }

  app.update((prev) => ({ ...prev, isListening: false }));
  updateMediaSessionState("paused");
  setStatus("listener", tr("status.listener_reconnect", { reason }));
}

export async function stopListening(options?: { preserveIntent?: boolean; silent?: boolean }): Promise<void> {
  const preserveIntent = options?.preserveIntent ?? false;
  const silent = options?.silent ?? false;
  stopListenerQualityWatchdog();

  if (!preserveIntent) {
    app.update((s) => ({ ...s, listenerWantsListen: false, listenerReconnectAttempts: 0 }));
    if (listenerReconnectTimer) {
      clearTimeout(listenerReconnectTimer);
      setListenerReconnectTimer(null);
    }
  }

  const socket = listenerSocket;
  const consumerId = activeConsumer?.id ?? "";
  const transportId = activeTransportId;
  setListenerSocket(null);
  closeActiveListenerMedia();

  if (socket?.connected) {
    if (consumerId) {
      try {
        await emitAck(socket, "consumer:close", { consumerId });
      } catch {
        // disconnect cleanup is the fallback
      }
    }
    if (transportId) {
      try {
        await emitAck(socket, "transport:close", { transportId });
      } catch {
        // disconnect cleanup is the fallback
      }
    }
  }
  socket?.disconnect();

  if (listenerAudioEl) {
    listenerAudioEl.pause();
    listenerAudioEl.srcObject = null;
  }

  app.update((s) => ({
    ...s,
    isListening: false,
    ...(preserveIntent ? {} : { activeListeningChannelId: "" })
  }));
  updateMediaSessionState(preserveIntent ? "paused" : "none");

  if (!silent) {
    setStatus("listener", tr("status.listener_stopped"));
  }
}

export async function pauseListening(): Promise<void> {
  await stopListening({ preserveIntent: true, silent: true });
}

export async function resumeListening(): Promise<void> {
  const state = get(app);
  const channelId = state.activeListeningChannelId || state.selectedChannelId;
  if (!channelId) return;
  await startListening(channelId);
}

export async function startListening(channelIdOverride?: string): Promise<void> {
  registerMediaSessionActions();
  const state = get(app);
  const targetChannelId = channelIdOverride ?? state.selectedChannelId;
  if (!targetChannelId) {
    setStatus("listener", tr("status.listener_choose_channel"));
    return;
  }
  if (!state.listenerCode.trim()) {
    setStatus("listener", tr("status.listener_enter_token"));
    return;
  }
  if (!state.listenerSessionId) {
    await validateJoin();
    if (!get(app).listenerSessionId) return;
  }

  if (get(app).isListening || listenerSocket || activeRecvTransport) {
    await stopListening({ preserveIntent: true, silent: true });
  }

  try {
    app.update((s) => ({ ...s, listenerWantsListen: true, activeListeningChannelId: targetChannelId }));
    const socket = io(wsUrl, {
      withCredentials: true,
      auth: { role: "LISTENER", sessionCode: get(app).listenerCode.trim() },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 300,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });
    setListenerSocket(socket);

    socket.on("disconnect", (reason) => {
      if (listenerSocket !== socket) return;
      scheduleListenerReconnect(String(reason));
    });
    socket.on("broadcast:ownershipChanged", (payload: { takeover?: boolean } | undefined) => {
      if (payload?.takeover) {
        scheduleListenerReconnect("broadcast takeover");
      }
    });
    socket.on("broadcast:liveModeChanged", (payload: { mode?: "none" | "mic" | "preshow" | "testtone" } | undefined) => {
      const mode = payload?.mode ?? "none";
      activeLiveMode = mode;
      if (mode === "testtone") {
        void startTestToneWatchdog();
      } else {
        stopTestToneWatchdog();
      }
    });
    socket.on("channel:producerAvailable", (payload: { channelId?: string } | undefined) => {
      const channelId = payload?.channelId ?? "";
      const current = get(app);
      if (!channelId || channelId !== current.activeListeningChannelId) return;
      const now = Date.now();
      // Avoid event storms when producer switches happen in quick bursts.
      if (now - lastProducerSwitchReconnectAt < 1500) return;
      if (producerSwitchReconnectTimer) return;
      producerSwitchReconnectTimer = setTimeout(() => {
        producerSwitchReconnectTimer = null;
        lastProducerSwitchReconnectAt = Date.now();
        scheduleListenerReconnect("producer switched");
      }, 450);
    });

    await waitForSocketConnect(socket, 25_000);

    const caps = await emitAck<{ rtpCapabilities: unknown }>(socket, "session:getRtpCapabilities", {});
    const device = new Device();
    await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });

    await emitAck(socket, "listener:joinSession", { channelId: targetChannelId });
    const transportData = await emitAck<{
      transportId: string;
      iceParameters: unknown;
      iceCandidates: unknown[];
      dtlsParameters: unknown;
    }>(socket, "listener:createTransport", { channelId: targetChannelId });

    const recvTransport = device.createRecvTransport({
      id: transportData.transportId,
      iceParameters: transportData.iceParameters as never,
      iceCandidates: transportData.iceCandidates as never,
      dtlsParameters: transportData.dtlsParameters as never
    });
    activeRecvTransport = recvTransport;
    activeTransportId = transportData.transportId;

    recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await emitAck(socket, "transport:connect", { transportId: transportData.transportId, dtlsParameters });
        callback();
      } catch (error) {
        errback(error as Error);
      }
    });
    recvTransport.on("connectionstatechange", (connectionState) => {
      if (activeRecvTransport !== recvTransport) return;
      if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
        scheduleListenerReconnect(`transport ${connectionState}`);
      }
    });

    const consumeData = await emitAck<{
      consumerId: string;
      producerId: string;
      kind: "audio";
      rtpParameters: unknown;
    }>(socket, "listener:consume", {
      transportId: transportData.transportId,
      sessionId: get(app).listenerSessionId,
      channelId: targetChannelId,
      rtpCapabilities: device.rtpCapabilities
    });

    const consumer = await recvTransport.consume({
      id: consumeData.consumerId,
      producerId: consumeData.producerId,
      kind: consumeData.kind,
      rtpParameters: consumeData.rtpParameters as never
    });
    activeConsumer = consumer;
    consumer.track.addEventListener("ended", () => {
      if (activeConsumer !== consumer) return;
      scheduleListenerReconnect("track ended");
    });

    if (!listenerAudioEl) throw new Error("Audio element not available");
    listenerAudioEl.srcObject = new MediaStream([consumer.track]);
    await ensureAudioPlayback();
    if (activeLiveMode === "testtone") {
      void startTestToneWatchdog();
    } else {
      stopTestToneWatchdog();
    }

    await emitAck(socket, "consumer:resume", { consumerId: consumeData.consumerId });
    app.update((s) => ({ ...s, isListening: true, activeListeningChannelId: targetChannelId, listenerReconnectAttempts: 0 }));
    startListenerQualityWatchdog();
    updateMediaSessionMetadata();
    updateMediaSessionState("playing");
    setStatus("listener", tr("status.listener_live_audio"));
  } catch (error) {
    await stopListening({ preserveIntent: true, silent: true });
    updateMediaSessionState("paused");
    const message = (error as Error).message;
    if (get(app).listenerWantsListen) {
      scheduleListenerReconnect(message);
    } else {
      setStatus("listener", tr("status.error_prefix", { message }));
    }
  }
}

export async function toggleChannelPlayback(channelId: string): Promise<void> {
  const state = get(app);
  if (state.listenerWantsListen && state.activeListeningChannelId === channelId) {
    await stopListening();
    return;
  }
  await startListening(channelId);
}
  stopTestToneWatchdog();
  activeLiveMode = "none";
