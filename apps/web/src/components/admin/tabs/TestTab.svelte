<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Device } from "mediasoup-client";
  import { io, type Socket } from "socket.io-client";
  import { apiUrl } from "../../../lib/config";
  import { wsUrl } from "../../../lib/config";
  import { fetchJson } from "../../../lib/http";
  import { emitAck, waitForSocketConnect } from "../../../lib/socketAck";
  import { app } from "../../../stores/app";
  import { t } from "../../../i18n";
  import { loadSelectedSession } from "../../../controllers/sessionDetail/load";
  import { startTestToneBroadcast, stopBroadcast } from "../../../controllers/broadcaster/broadcast";
  import DropdownSelect from "../../ui/DropdownSelect.svelte";

  type DebugRun = {
    id: string;
    type: "load" | "webrtc";
    status: "queued" | "running" | "stopping" | "finished" | "failed";
    startedAt: string;
    endedAt: string | null;
    summary: Record<string, unknown>;
    events: Array<{
      at: string;
      message: string;
      level?: "info" | "warn" | "error";
      category?: string;
      clientId?: string;
      code?: string;
      data?: Record<string, unknown>;
    }>;
  };

  let statusMessage = "";
  let runs: DebugRun[] = [];
  let activeRun: DebugRun | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  let loadTargetUrl = `${apiUrl}/health`;
  let loadVus = 25;
  let loadDurationSec = 60;
  let loadRampUpSec = 10;
  let loadRequestIntervalMs = 250;

  let webrtcSessionId = "";
  let webrtcChannelId = "";
  let webrtcClients = 30;
  let webrtcRampUpSec = 30;
  let webrtcReconnect = true;
  let selectedRunId = "";
  let selectedRunEvents: DebugRun["events"] = [];
  let watchdog = { totalClients: 0, hearing: 0, lost: 0, events: [] as Array<{ at: string; clientId: string; channelId: string; state: "hearing" | "lost" }> };
  let simClientTarget = 5;
  let simClientsRunning = false;
  let simClientsStarting = false;
  let simClientsConnected = 0;
  let simClientsWithAudio = 0;
  let simClientsStarted = 0;
  let simClientsFailed = 0;
  let simClientsStatus = "";
  let simToneChannelId = "";
  let simDuration = "1h";
  let simChurnEnabled = false;
  let simChurnIntervalSec = 30;
  let simChurnLeavePercent = 10;
  let simChurnRejoinDelayMinMs = 500;
  let simChurnRejoinDelayMaxMs = 5000;
  let simDurationTimer: ReturnType<typeof setTimeout> | null = null;
  let simChurnTimer: ReturnType<typeof setInterval> | null = null;
  let simRunSessionId = "";
  let simRunSessionCode = "";
  let simRunChannelId = "";
  let simClientSerial = 0;
  let simAvailableChannels: Array<{ id: string; name: string; isLive: boolean }> = [];
  let producerStatus: {
    sessionId: string;
    liveMode: "none" | "mic" | "preshow" | "testtone";
    channels: Array<{ id: string; name: string; producerPresent: boolean }>;
  } | null = null;

  type SimClient = {
    id: string;
    socket: Socket;
    recvTransport: ReturnType<Device["createRecvTransport"]> | null;
    consumer: Awaited<ReturnType<ReturnType<Device["createRecvTransport"]>["consume"]>> | null;
    audioContext: AudioContext | null;
    analyser: AnalyserNode | null;
    sinkGain: GainNode | null;
    freqData: Float32Array | null;
    byteFreqData: Uint8Array | null;
    timeData: Float32Array | null;
    timer: ReturnType<typeof setInterval> | null;
    liveMode: "none" | "mic" | "preshow" | "testtone";
    lastState: "hearing" | "lost" | null;
    stateSinceMs: number;
    reportedState: "hearing" | "lost" | null;
    sessionId: string;
    channelId: string;
    rtpCapabilities: unknown | null;
    transportId: string;
    debugRms: number;
    debugHasTone: boolean;
    debugHasLevel: boolean;
    debugHasFlow: boolean;
    debugBytesDelta: number;
    debugHz: number;
    hzHistory: number[];
    debugState: "hearing" | "lost";
    lastBytesReceived: number;
  };
  let simClients: SimClient[] = [];

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

  function detectDominantHz(byteFreqData: Uint8Array, sampleRate: number): number {
    const nyquist = sampleRate / 2;
    const binHz = nyquist / byteFreqData.length;
    const fromBin = Math.max(2, Math.round(80 / binHz));
    const toBin = Math.min(byteFreqData.length - 2, Math.round(5000 / binHz));
    let peakValue = 0;
    let peakBin = 0;
    for (let i = fromBin; i <= toBin; i += 1) {
      const value = byteFreqData[i];
      if (value > peakValue) {
        peakValue = value;
        peakBin = i;
      }
    }
    if (peakBin === 0 || peakValue < 8) return 0;
    return Math.round(peakBin * binHz);
  }

  function detectHzZeroCrossing(timeData: Float32Array, sampleRate: number): number {
    let lastCrossing = -1;
    let periodSum = 0;
    let periodCount = 0;
    for (let i = 1; i < timeData.length; i += 1) {
      const prev = timeData[i - 1];
      const curr = timeData[i];
      if (prev <= 0 && curr > 0) {
        if (lastCrossing >= 0) {
          periodSum += i - lastCrossing;
          periodCount += 1;
        }
        lastCrossing = i;
      }
    }
    if (periodCount < 2) return 0;
    const avgPeriodSamples = periodSum / periodCount;
    if (avgPeriodSamples <= 0) return 0;
    const hz = sampleRate / avgPeriodSamples;
    if (!Number.isFinite(hz) || hz < 50 || hz > 5000) return 0;
    return Math.round(hz);
  }

  function hzSeriesToPolyline(series: number[], width = 220, height = 34, maxHz = 1200): string {
    if (series.length === 0) return "";
    if (series.length === 1) {
      const y = height - Math.max(0, Math.min(height, (series[0] / maxHz) * height));
      return `0,${y.toFixed(1)}`;
    }
    const points: string[] = [];
    const step = width / Math.max(1, series.length - 1);
    for (let i = 0; i < series.length; i += 1) {
      const clamped = Math.max(0, Math.min(maxHz, series[i]));
      const x = i * step;
      const y = height - (clamped / maxHz) * height;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(" ");
  }

  function parseDurationToSeconds(input: string): number | null {
    const raw = String(input ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const sec = Number(raw);
      if (!Number.isFinite(sec) || sec <= 0) return null;
      return Math.floor(sec);
    }
    const tokenRegex = /(\d+)\s*(h|m|s)/g;
    let consumed = "";
    let totalSec = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(raw)) !== null) {
      const value = Number(match[1]);
      const unit = match[2];
      if (!Number.isFinite(value) || value <= 0) return null;
      if (unit === "h") totalSec += value * 3600;
      if (unit === "m") totalSec += value * 60;
      if (unit === "s") totalSec += value;
      consumed += match[0];
    }
    if (totalSec <= 0) return null;
    if (consumed.replace(/\s+/g, "") !== raw.replace(/\s+/g, "")) return null;
    return totalSec;
  }

  $: if (!webrtcSessionId && $app.adminSessions.length > 0) {
    webrtcSessionId = $app.selectedSessionId || $app.adminSessions[0].id;
  }
  $: webrtcSessionOptions = $app.adminSessions.map((session) => ({ value: session.id, label: session.name }));
  $: simToneChannelOptions =
    simAvailableChannels.length === 0
      ? [{ value: "", label: "Keine Channels gefunden" }]
      : simAvailableChannels.map((channel) => ({
          value: channel.id,
          label: `${channel.name} (${channel.id})${channel.isLive ? " - LIVE" : ""}`
        }));
  $: runOptions =
    runs.length === 0
      ? [{ value: "", label: "Keine Runs" }]
      : runs.map((run) => ({ value: run.id, label: `${run.type.toUpperCase()} | ${run.status} | ${run.id}` }));
  $: if ($app.adminView === "detail" && $app.selectedSessionId && webrtcSessionId !== $app.selectedSessionId) {
    webrtcSessionId = $app.selectedSessionId;
  }
  $: if (selectedRunId) {
    void loadRunEvents(selectedRunId);
  }

  async function loadState(): Promise<void> {
    try {
      const data = await fetchJson<{ runs: DebugRun[]; active: DebugRun | null }>(`${apiUrl}/api/admin/debug/tests/history`);
      runs = data.runs ?? [];
      activeRun = data.active;
      if (!selectedRunId && runs.length > 0) selectedRunId = runs[0].id;
      if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
        selectedRunId = runs[0]?.id ?? "";
        selectedRunEvents = [];
      }
      const watchSessionId = webrtcSessionId || $app.selectedSessionId || $app.adminSessions[0]?.id || "";
      if (watchSessionId) {
        watchdog = await fetchJson<{ totalClients: number; hearing: number; lost: number; events: Array<{ at: string; clientId: string; channelId: string; state: "hearing" | "lost" }> }>(
          `${apiUrl}/api/admin/debug/audio-watchdog?sessionId=${encodeURIComponent(watchSessionId)}`
        );
        const detail = await fetchJson<{
          channels: Array<{ id: string; name: string }>;
          liveChannelIds?: string[];
        }>(`${apiUrl}/api/admin/sessions/${encodeURIComponent(watchSessionId)}`);
        const liveIds = new Set(Array.isArray(detail.liveChannelIds) ? detail.liveChannelIds : []);
        simAvailableChannels = detail.channels.map((channel) => ({ id: channel.id, name: channel.name, isLive: liveIds.has(channel.id) }));
        if (!simToneChannelId && simAvailableChannels.length > 0) {
          simToneChannelId = (simAvailableChannels.find((c) => c.isLive)?.id ?? simAvailableChannels[0].id) || "";
        }
        if (simToneChannelId && !simAvailableChannels.some((channel) => channel.id === simToneChannelId)) {
          simToneChannelId = (simAvailableChannels.find((c) => c.isLive)?.id ?? simAvailableChannels[0]?.id) || "";
        }
        producerStatus = await fetchJson<{
          sessionId: string;
          liveMode: "none" | "mic" | "preshow" | "testtone";
          channels: Array<{ id: string; name: string; producerPresent: boolean }>;
        }>(`${apiUrl}/api/admin/debug/producer-status?sessionId=${encodeURIComponent(watchSessionId)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Status konnte nicht geladen werden.";
      statusMessage = message;
    }
  }

  async function loadRunEvents(runId: string): Promise<void> {
    if (!runId) {
      selectedRunEvents = [];
      return;
    }
    try {
      const data = await fetchJson<{ events: DebugRun["events"] }>(
        `${apiUrl}/api/admin/debug/tests/${encodeURIComponent(runId)}/events?limit=300`
      );
      selectedRunEvents = data.events ?? [];
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "Events konnten nicht geladen werden.";
      selectedRunEvents = [];
    }
  }

  async function toggleTestToneFromDebug(): Promise<void> {
    try {
      const sessionId = webrtcSessionId || $app.selectedSessionId || "";
      if (!sessionId) throw new Error("Keine Session ausgewaehlt.");
      if ($app.selectedSessionId !== sessionId) {
        app.update((s) => ({ ...s, selectedSessionId: sessionId }));
      }
      await loadSelectedSession();
      if ($app.isTestToneActive) {
        await stopBroadcast();
      } else {
        await startTestToneBroadcast();
      }
      await loadState();
    } catch (error) {
      simClientsStatus = `Testton-Fehler: ${error instanceof Error ? error.message : "unbekannt"}`;
    }
  }

  function cleanupSimClient(client: SimClient): void {
    if (client.timer) clearInterval(client.timer);
    client.timer = null;
    if (client.consumer) {
      try {
        client.consumer.close();
      } catch {
        // ignore cleanup error
      }
    }
    client.consumer = null;
    if (client.recvTransport) {
      try {
        client.recvTransport.close();
      } catch {
        // ignore cleanup error
      }
    }
    client.recvTransport = null;
    try {
      client.socket.disconnect();
    } catch {
      // ignore cleanup error
    }
    if (client.audioContext) {
      void client.audioContext.close().catch(() => undefined);
    }
    client.audioContext = null;
    client.analyser = null;
    try {
      client.sinkGain?.disconnect();
    } catch {
      // ignore cleanup error
    }
    client.sinkGain = null;
    client.freqData = null;
    client.byteFreqData = null;
    client.timeData = null;
  }

  function updateSimConnectedCount(): void {
    simClientsConnected = simClients.filter((c) => c.socket.connected).length;
    simClientsWithAudio = simClients.filter((c) => c.consumer !== null).length;
  }

  function refreshSimClientDebugView(): void {
    simClients = [...simClients];
  }

  async function getInboundAudioBytesDelta(client: SimClient): Promise<number> {
    if (!client.consumer) return 0;
    try {
      const stats = await client.consumer.getStats();
      let bytesReceived = 0;
      const values: Array<Record<string, unknown>> = [];
      if (typeof (stats as { forEach?: unknown }).forEach === "function") {
        (stats as { forEach: (cb: (value: unknown) => void) => void }).forEach((value) => {
          if (value && typeof value === "object") values.push(value as Record<string, unknown>);
        });
      } else if (Array.isArray(stats)) {
        for (const maybe of stats) {
          if (maybe && typeof maybe === "object") values.push(maybe as Record<string, unknown>);
        }
      }
      for (const stat of values) {
        const type = String(stat.type ?? "");
        const media = String(stat.kind ?? stat.mediaType ?? "");
        if (type === "inbound-rtp" && media === "audio") {
          bytesReceived += Number(stat.bytesReceived ?? 0);
        }
      }
      const delta = Math.max(0, bytesReceived - client.lastBytesReceived);
      client.lastBytesReceived = bytesReceived;
      return delta;
    } catch {
      return 0;
    }
  }

  function startToneWatchdog(client: SimClient, channelId: string): void {
    if (!client.analyser || !client.freqData || !client.byteFreqData || !client.timeData || !client.audioContext) return;
    if (client.timer) clearInterval(client.timer);
    client.timer = setInterval(async () => {
      if (!client.analyser || !client.freqData || !client.byteFreqData || !client.timeData || !client.audioContext) return;
      client.analyser.getFloatFrequencyData(client.freqData);
      client.analyser.getByteFrequencyData(client.byteFreqData);
      client.analyser.getFloatTimeDomainData(client.timeData);
      let sum = 0;
      for (const sample of client.timeData) sum += sample * sample;
      const rms = Math.sqrt(sum / Math.max(1, client.timeData.length));
      const hasLevel = rms > 0.002;
      const hasTone = detectTestTone400(client.freqData, client.audioContext.sampleRate);
      const bytesDelta = await getInboundAudioBytesDelta(client);
      const hasFlow = bytesDelta > 128;
      const hzSpectrum = detectDominantHz(client.byteFreqData, client.audioContext.sampleRate);
      const hzTimeDomain = detectHzZeroCrossing(client.timeData, client.audioContext.sampleRate);
      let hz = hzSpectrum > 0 ? hzSpectrum : hzTimeDomain;
      if (hz === 0 && hasFlow && client.liveMode === "testtone") hz = 400;
      const hearingNow = hasTone || hasLevel || hasFlow;
      client.debugRms = Number(rms.toFixed(5));
      client.debugHasTone = hasTone;
      client.debugHasLevel = hasLevel;
      client.debugHasFlow = hasFlow;
      client.debugBytesDelta = Math.round(bytesDelta);
      client.debugHz = hz;
      client.hzHistory.push(hz);
      if (client.hzHistory.length > 80) client.hzHistory.shift();
      client.debugState = hearingNow ? "hearing" : "lost";
      refreshSimClientDebugView();
      const candidate: "hearing" | "lost" = hearingNow ? "hearing" : "lost";
      const now = Date.now();
      if (client.lastState !== candidate) {
        client.lastState = candidate;
        client.stateSinceMs = now;
        return;
      }
      if (now - client.stateSinceMs < 1200) return;
      if (client.reportedState === candidate) return;
      client.reportedState = candidate;
      client.socket.emit("listener:testToneState", { channelId, state: candidate });
    }, 450);
  }

  async function waitForProducerSignal(socket: Socket, channelId: string, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);
      const onAvailable = (payload: { channelId?: string } | undefined) => {
        if ((payload?.channelId ?? "") !== channelId) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("channel:producerAvailable", onAvailable);
      };
      socket.on("channel:producerAvailable", onAvailable);
    });
  }

  async function consumeWithRetry(
    socket: Socket,
    sessionId: string,
    channelId: string,
    transportId: string,
    rtpCapabilities: unknown,
    maxWaitMs = 10000
  ): Promise<{ consumerId: string; producerId: string; kind: "audio"; rtpParameters: unknown }> {
    const deadline = Date.now() + maxWaitMs;
    let lastMessage = "Consume failed";
    while (Date.now() < deadline) {
      try {
        return await emitAck<{
          consumerId: string;
          producerId: string;
          kind: "audio";
          rtpParameters: unknown;
        }>(socket, "listener:consume", {
          transportId,
          sessionId,
          channelId,
          rtpCapabilities
        });
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "Consume failed";
        await waitForProducerSignal(socket, channelId, 900);
      }
    }
    throw new Error(`${lastMessage}. Kein aktiver Audio-Producer auf dem Channel.`);
  }

  async function attachConsumerWhenAvailable(client: SimClient): Promise<void> {
    while (simClientsRunning && client.socket.connected) {
      if (client.consumer) return;
      if (!client.recvTransport || !client.rtpCapabilities || !client.transportId) return;
      try {
        const consumeData = await consumeWithRetry(
          client.socket,
          client.sessionId,
          client.channelId,
          client.transportId,
          client.rtpCapabilities,
          8000
        );
        const consumer = await client.recvTransport.consume({
          id: consumeData.consumerId,
          producerId: consumeData.producerId,
          kind: consumeData.kind,
          rtpParameters: consumeData.rtpParameters as never
        });
        client.consumer = consumer;
        await emitAck(client.socket, "consumer:resume", { consumerId: consumeData.consumerId });

        const audioContext = new AudioContext();
        if (audioContext.state === "suspended") await audioContext.resume();
        const stream = new MediaStream([consumer.track]);
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.2;
        const sinkGain = audioContext.createGain();
        sinkGain.gain.value = 0;
        source.connect(analyser);
        analyser.connect(sinkGain);
        sinkGain.connect(audioContext.destination);
        client.audioContext = audioContext;
        client.analyser = analyser;
        client.sinkGain = sinkGain;
        client.freqData = new Float32Array(analyser.frequencyBinCount);
        client.byteFreqData = new Uint8Array(analyser.frequencyBinCount);
        client.timeData = new Float32Array(analyser.fftSize);
        startToneWatchdog(client, client.channelId);
        updateSimConnectedCount();
        return;
      } catch {
        if (client.reportedState !== "lost") {
          client.reportedState = "lost";
          client.debugState = "lost";
          client.socket.emit("listener:testToneState", { channelId: client.channelId, state: "lost" });
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async function createSimClient(index: number, sessionId: string, sessionCode: string, channelId: string): Promise<void> {
    const socket = io(wsUrl, {
      withCredentials: true,
      auth: { role: "LISTENER", sessionCode },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 300,
      reconnectionDelayMax: 5000,
      timeout: 15000
    });
    const client: SimClient = {
      id: `sim-${index}`,
      socket,
      recvTransport: null,
      consumer: null,
      audioContext: null,
      analyser: null,
      sinkGain: null,
      freqData: null,
      byteFreqData: null,
      timeData: null,
      timer: null,
      liveMode: "none",
      lastState: null,
      stateSinceMs: 0,
      reportedState: null,
      sessionId,
      channelId,
      rtpCapabilities: null,
      transportId: "",
      debugRms: 0,
      debugHasTone: false,
      debugHasLevel: false,
      debugHasFlow: false,
      debugBytesDelta: 0,
      debugHz: 0,
      hzHistory: [],
      debugState: "lost",
      lastBytesReceived: 0
    };
    simClients = [...simClients, client];

    socket.on("connect", () => {
      updateSimConnectedCount();
    });
    socket.on("disconnect", () => {
      updateSimConnectedCount();
    });
    socket.on("broadcast:liveModeChanged", (payload: { mode?: "none" | "mic" | "preshow" | "testtone" } | undefined) => {
      client.liveMode = payload?.mode ?? "none";
      if (client.liveMode !== "testtone") client.reportedState = null;
    });

    await waitForSocketConnect(socket, 20000);
    const caps = await emitAck<{ rtpCapabilities: unknown }>(socket, "session:getRtpCapabilities", {});
    const device = new Device();
    await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });
    client.rtpCapabilities = device.rtpCapabilities;
    await emitAck(socket, "listener:joinSession", { channelId });
    const transportData = await emitAck<{
      transportId: string;
      iceParameters: unknown;
      iceCandidates: unknown[];
      dtlsParameters: unknown;
    }>(socket, "listener:createTransport", { channelId });
    client.transportId = transportData.transportId;

    const recvTransport = device.createRecvTransport({
      id: transportData.transportId,
      iceParameters: transportData.iceParameters as never,
      iceCandidates: transportData.iceCandidates as never,
      dtlsParameters: transportData.dtlsParameters as never
    });
    client.recvTransport = recvTransport;

    recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await emitAck(socket, "transport:connect", { transportId: transportData.transportId, dtlsParameters });
        callback();
      } catch (error) {
        errback(error as Error);
      }
    });

    void attachConsumerWhenAvailable(client);
  }

  function clearSimSchedulers(): void {
    if (simDurationTimer) clearTimeout(simDurationTimer);
    if (simChurnTimer) clearInterval(simChurnTimer);
    simDurationTimer = null;
    simChurnTimer = null;
  }

  async function startOneSimClientDelayed(delayMs: number): Promise<void> {
    const delay = Math.max(0, delayMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (!simClientsRunning || !simRunSessionId || !simRunSessionCode || !simRunChannelId) return;
    try {
      simClientSerial += 1;
      await createSimClient(simClientSerial, simRunSessionId, simRunSessionCode, simRunChannelId);
      simClientsStarted += 1;
      updateSimConnectedCount();
    } catch {
      simClientsFailed += 1;
    }
  }

  function runSimChurnCycle(): void {
    if (!simClientsRunning || !simChurnEnabled || simClients.length === 0) return;
    const leaveCount = Math.max(1, Math.floor((simClients.length * simChurnLeavePercent) / 100));
    const selected = [...simClients].sort(() => Math.random() - 0.5).slice(0, leaveCount);
    if (!selected.length) return;
    const minDelay = Math.max(0, Math.floor(simChurnRejoinDelayMinMs));
    const maxDelay = Math.max(minDelay, Math.floor(simChurnRejoinDelayMaxMs));
    for (const client of selected) {
      cleanupSimClient(client);
      simClients = simClients.filter((item) => item !== client);
      const jitter = maxDelay > minDelay ? Math.floor(Math.random() * (maxDelay - minDelay + 1)) : 0;
      void startOneSimClientDelayed(minDelay + jitter);
    }
    updateSimConnectedCount();
    simClientsStatus = `Churn aktiv: ${selected.length} Clients rotiert (${simClients.length} aktuell aktiv).`;
  }

  async function startSimClients(): Promise<void> {
    if (simClientsRunning || simClientsStarting) return;
    simClientsStatus = "";
    try {
      clearSimSchedulers();
      const durationSec = parseDurationToSeconds(simDuration);
      if (!durationSec) throw new Error("Ungueltige Dauer. Beispiel: 1h, 30m oder 1800.");
      const sessionId = webrtcSessionId || $app.selectedSessionId || "";
      if (!sessionId) throw new Error("Keine Session ausgewaehlt.");
      const detail = await fetchJson<{
        session: { broadcastCode?: string | null };
        channels: Array<{ id: string; name: string }>;
        liveChannelIds?: string[];
      }>(
        `${apiUrl}/api/admin/sessions/${encodeURIComponent(sessionId)}`
      );
      const sessionCode = String(detail.session.broadcastCode ?? "").trim();
      if (!sessionCode) throw new Error("Session hat keinen Broadcast-Code.");
      const liveChannelIds = Array.isArray(detail.liveChannelIds) ? detail.liveChannelIds : [];
      const requestedChannelId = simToneChannelId.trim();
      const detailChannelIds = detail.channels.map((channel) => channel.id);
      let channelId = requestedChannelId || liveChannelIds[0] || detail.channels[0]?.id || "";
      channelId = channelId.trim();
      if (!channelId) throw new Error("Kein Channel fuer die simulierten Clients verfuegbar.");
      if (!detailChannelIds.includes(channelId)) {
        throw new Error(`Channel ${channelId} gehoert nicht zur gewaehlten Session ${sessionId}. Bitte Session im Dropdown pruefen.`);
      }
      if (!requestedChannelId && liveChannelIds.length > 0 && !liveChannelIds.includes(channelId)) {
        channelId = liveChannelIds[0];
      }
      simToneChannelId = channelId;
      simRunSessionId = sessionId;
      simRunSessionCode = sessionCode;
      simRunChannelId = channelId;
      simClientsRunning = true;
      simClientsStarting = true;
      simClientsStarted = 0;
      simClientsFailed = 0;
      simClientSerial = 0;
      simClientsStatus =
        liveChannelIds.length === 0
          ? `Starte simulierte Clients auf ${channelId} (Live-Liste leer, nutze manuelle/erste Auswahl)...`
          : `Starte simulierte Clients auf Live-Channel ${channelId}...`;
      const jobs = Array.from({ length: simClientTarget }, (_, i) => i).map(async (i) => {
        try {
          simClientSerial += 1;
          await Promise.race([
            createSimClient(simClientSerial, sessionId, sessionCode, channelId),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Start-Timeout")), 20000))
          ]);
          simClientsStarted += 1;
          simClientsStatus = `Starte Clients... ${simClientsStarted}/${simClientTarget}`;
        } catch {
          simClientsFailed += 1;
        }
      });
      await Promise.allSettled(jobs);
      simClientsStarting = false;
      updateSimConnectedCount();
      if (simClientsStarted === 0) {
        throw new Error("Kein Sim-Client konnte starten. Pruefe ob der Channel wirklich Audio sendet.");
      }
      simDurationTimer = setTimeout(() => {
        void stopSimClients({ message: `Dauer erreicht (${simDuration}). Sim-Clients gestoppt.` });
      }, durationSec * 1000);
      if (simChurnEnabled) {
        simChurnTimer = setInterval(() => runSimChurnCycle(), Math.max(5, Math.floor(simChurnIntervalSec)) * 1000);
      }
      simClientsStatus = `${simClientsStarted} gestartet, ${simClientsFailed} fehlgeschlagen. Dauer ${simDuration}${simChurnEnabled ? ", Churn aktiv." : "."}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulierte Clients konnten nicht gestartet werden.";
      await stopSimClients({ message: `Start fehlgeschlagen: ${message}` });
    }
  }

  async function stopSimClients(options?: { message?: string }): Promise<void> {
    clearSimSchedulers();
    for (const client of simClients.splice(0, simClients.length)) {
      cleanupSimClient(client);
    }
    simClients = [];
    simClientsRunning = false;
    simClientsStarting = false;
    simClientsConnected = 0;
    simClientsWithAudio = 0;
    simClientsStarted = 0;
    simClientsFailed = 0;
    simRunSessionId = "";
    simRunSessionCode = "";
    simRunChannelId = "";
    simClientsStatus = options?.message ?? "Simulierte Clients gestoppt.";
  }

  async function startLoad(): Promise<void> {
    statusMessage = "";
    try {
      await fetchJson(`${apiUrl}/api/admin/debug/tests/load/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUrl: loadTargetUrl,
          vus: loadVus,
          durationSec: loadDurationSec,
          rampUpSec: loadRampUpSec,
          requestIntervalMs: loadRequestIntervalMs
        })
      });
      await loadState();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "Loadtest konnte nicht gestartet werden.";
    }
  }

  async function startWebRtc(): Promise<void> {
    statusMessage = "";
    try {
      await fetchJson(`${apiUrl}/api/admin/debug/tests/webrtc/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: webrtcSessionId,
          channelId: webrtcChannelId,
          clients: webrtcClients,
          duration: "5m",
          rampUpSec: webrtcRampUpSec,
          reconnect: webrtcReconnect,
          churnEnabled: false
        })
      });
      await loadState();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "WebRTC-Test konnte nicht gestartet werden.";
    }
  }

  async function stopActiveRun(): Promise<void> {
    if (!activeRun) return;
    statusMessage = "";
    try {
      await fetchJson(`${apiUrl}/api/admin/debug/tests/${encodeURIComponent(activeRun.id)}/stop`, {
        method: "POST"
      });
      await loadState();
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : "Test konnte nicht gestoppt werden.";
    }
  }

  onMount(() => {
    void loadState();
    refreshTimer = setInterval(() => void loadState(), 2000);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
    void stopSimClients();
  });
</script>

<div class="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
  <div>
    <h3 class="text-xl font-black text-slate-900 dark:text-slate-100">{$t("common.test")}</h3>
    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Debug-only: Loadtest, WebRTC-Verbindungstest und Audio-Hoeren/Melden-Test direkt im Dashboard.</p>
  </div>

  {#if activeRun}
    <div class="rounded-xl border border-orange-300 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950/40">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-sm font-semibold text-orange-800 dark:text-orange-200">Aktiver Test: {activeRun.type.toUpperCase()} ({activeRun.status})</p>
          <p class="text-xs text-orange-700 dark:text-orange-300">Run ID: {activeRun.id}</p>
        </div>
        <button class="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700" type="button" onclick={stopActiveRun}>Stoppen</button>
      </div>
      <pre class="mt-3 overflow-x-auto rounded-lg bg-white/80 p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">{JSON.stringify(activeRun.summary, null, 2)}</pre>
    </div>
  {/if}

  <div class="grid gap-4 lg:grid-cols-2">
    <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
      <h4 class="text-base font-black text-slate-900 dark:text-slate-100">Loadtest</h4>
      <div class="mt-3 grid gap-3">
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Target URL
          <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" bind:value={loadTargetUrl} />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            VUs
            <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="1" max="300" bind:value={loadVus} />
          </label>
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dauer (s)
            <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="10" max="3600" bind:value={loadDurationSec} />
          </label>
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ramp-up (s)
            <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="0" max="600" bind:value={loadRampUpSec} />
          </label>
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Intervall (ms)
            <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="50" max="5000" bind:value={loadRequestIntervalMs} />
          </label>
        </div>
        <button
          class="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
          type="button"
          disabled={Boolean(activeRun)}
          onclick={startLoad}
        >
          Loadtest starten
        </button>
      </div>
    </section>

    <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
      <h4 class="text-base font-black text-slate-900 dark:text-slate-100">WebRTC Verbindungstest</h4>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Nur Verbindungsstabilitaet. Audio-Hoeren/Melden steuerst du unten bei den simulierten Audio-Clients.</p>
      <div class="mt-3 grid gap-3">
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Session
          <div class="mt-1">
            <DropdownSelect options={webrtcSessionOptions} bind:value={webrtcSessionId} triggerClass="h-10 px-3 py-2 text-sm bg-white dark:bg-slate-900" />
          </div>
        </label>
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Channel ID (optional)
          <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" bind:value={webrtcChannelId} placeholder="leer = erster aktiver Channel" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Clients
            <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="1" max="500" bind:value={webrtcClients} />
          </label>
          <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Ramp-up (s)
            <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="0" max="1200" bind:value={webrtcRampUpSec} />
          </label>
          <label class="flex items-center gap-2 pt-6 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" bind:checked={webrtcReconnect} />
            Auto-Reconnect
          </label>
        </div>
        <button
          class="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500"
          type="button"
          disabled={Boolean(activeRun) || !webrtcSessionId}
          onclick={startWebRtc}
        >
          WebRTC-Test starten
        </button>
      </div>
    </section>
  </div>

  <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
    <h4 class="text-base font-black text-slate-900 dark:text-slate-100">Simulierte Audio-Clients (hoeren + melden)</h4>
    <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">Hier laufen Dauer- und Churn-Tests fuer echtes Audio-Hoeren und Watchdog-Meldungen.</p>
    <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Anzahl
        <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" type="number" min="1" max="50" bind:value={simClientTarget} />
      </label>
      <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Dauer
        <input class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" bind:value={simDuration} placeholder="1h oder 30m" />
      </label>
      <label class="text-xs font-semibold uppercase tracking-wide text-slate-500 lg:col-span-1">
        Channel
        <div class="mt-1">
          <DropdownSelect options={simToneChannelOptions} bind:value={simToneChannelId} triggerClass="h-10 px-3 py-2 text-sm bg-white dark:bg-slate-900" />
        </div>
      </label>
      <div class="flex items-end sm:col-span-2 lg:col-span-3">
        {#if !simClientsRunning}
          <button class="w-full rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800" type="button" onclick={startSimClients}>Clients starten</button>
        {:else}
          <button class="w-full rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20" type="button" onclick={stopSimClients}>Clients stoppen</button>
        {/if}
      </div>
    </div>
    <div class="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <label class="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
        <input type="checkbox" bind:checked={simChurnEnabled} />
        Churn-Modus (simulierte Abbrueche + Rejoins)
      </label>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Churn-Intervall (s)
          <input
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
            type="number"
            min="5"
            max="3600"
            bind:value={simChurnIntervalSec}
            disabled={!simChurnEnabled}
          />
        </label>
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Leave-Quote (%)
          <input
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
            type="number"
            min="1"
            max="90"
            bind:value={simChurnLeavePercent}
            disabled={!simChurnEnabled}
          />
        </label>
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Rejoin Delay Min (ms)
          <input
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
            type="number"
            min="0"
            max="120000"
            bind:value={simChurnRejoinDelayMinMs}
            disabled={!simChurnEnabled}
          />
        </label>
        <label class="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Rejoin Delay Max (ms)
          <input
            class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
            type="number"
            min="0"
            max="120000"
            bind:value={simChurnRejoinDelayMaxMs}
            disabled={!simChurnEnabled}
          />
        </label>
      </div>
    </div>
    <div class="mt-3 grid gap-2 sm:grid-cols-3">
      <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p class="text-xs text-slate-500 dark:text-slate-400">Gestartet</p>
        <p class="text-xl font-black text-slate-900 dark:text-slate-100">{simClients.length}</p>
      </div>
      <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p class="text-xs text-slate-500 dark:text-slate-400">Verbunden</p>
        <p class="text-xl font-black text-slate-900 dark:text-slate-100">{simClientsConnected}</p>
      </div>
      <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p class="text-xs text-slate-500 dark:text-slate-400">Mit Audio</p>
        <p class="text-xl font-black text-slate-900 dark:text-slate-100">{simClientsWithAudio}</p>
      </div>
      <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p class="text-xs text-slate-500 dark:text-slate-400">Status</p>
        <p class="text-sm font-semibold text-slate-900 dark:text-slate-100">{simClientsStarting ? "Startet..." : simClientsRunning ? "Aktiv" : "Inaktiv"}</p>
      </div>
    </div>
    {#if simClientsStatus}
      <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">{simClientsStatus}</p>
    {/if}
    <div class="mt-3 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
      <p class="font-semibold text-slate-800 dark:text-slate-100">Sim-Client Debug</p>
      {#if simClients.length === 0}
        <p class="mt-1 text-slate-500 dark:text-slate-400">Keine Sim-Clients aktiv.</p>
      {:else}
        <div class="mt-2 max-h-56 space-y-1 overflow-auto">
          {#each simClients as client}
            <div class="grid grid-cols-[auto_auto_auto_auto_auto_auto_auto_auto_1fr] items-center gap-2 rounded border border-slate-200 px-2 py-1 dark:border-slate-700">
              <span class="truncate text-slate-700 dark:text-slate-200">{client.id}</span>
              <span class={client.debugState === "hearing" ? "font-semibold text-emerald-600 dark:text-emerald-300" : "font-semibold text-red-600 dark:text-red-300"}>{client.debugState}</span>
              <span class="text-slate-600 dark:text-slate-300">rms {client.debugRms}</span>
              <span class="text-slate-600 dark:text-slate-300">tone {client.debugHasTone ? "1" : "0"}</span>
              <span class="text-slate-600 dark:text-slate-300">lvl {client.debugHasLevel ? "1" : "0"}</span>
              <span class="text-slate-600 dark:text-slate-300">flow {client.debugHasFlow ? "1" : "0"}</span>
              <span class="text-slate-600 dark:text-slate-300">bytes {client.debugBytesDelta}</span>
              <span class="text-slate-700 dark:text-slate-200">{client.debugHz}Hz</span>
              <svg viewBox="0 0 220 34" class="h-8 w-full min-w-[170px]">
                <line x1="0" y1="22.7" x2="220" y2="22.7" stroke="currentColor" class="text-slate-300 dark:text-slate-700" stroke-width="1" />
                <polyline
                  points={hzSeriesToPolyline(client.hzHistory, 220, 34, 1200)}
                  fill="none"
                  stroke="currentColor"
                  class={client.debugState === "hearing" ? "text-emerald-500 dark:text-emerald-300" : "text-slate-400 dark:text-slate-600"}
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
    <h4 class="text-base font-black text-slate-900 dark:text-slate-100">Historie</h4>
    {#if runs.length === 0}
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Noch keine Testlaeufe vorhanden.</p>
    {:else}
      <div class="mt-2 space-y-2">
        {#each runs as run}
          <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            <p class="font-semibold text-slate-900 dark:text-slate-100">{run.type.toUpperCase()} | {run.status}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{run.startedAt} {run.endedAt ? `-> ${run.endedAt}` : ""}</p>
            <pre class="mt-2 overflow-x-auto rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-800">{JSON.stringify(run.summary, null, 2)}</pre>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
    <h4 class="text-base font-black text-slate-900 dark:text-slate-100">Run-Events</h4>
    <div class="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <DropdownSelect options={runOptions} bind:value={selectedRunId} triggerClass="h-10 px-3 py-2 text-sm bg-white dark:bg-slate-900" />
      <button
        class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        type="button"
        onclick={() => void loadRunEvents(selectedRunId)}
        disabled={!selectedRunId}
      >
        Aktualisieren
      </button>
      <a
        class={`rounded-lg border px-3 py-2 text-sm font-semibold ${
          selectedRunId
            ? "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            : "pointer-events-none border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-600"
        }`}
        href={selectedRunId ? `${apiUrl}/api/admin/debug/tests/${encodeURIComponent(selectedRunId)}/export?format=json` : undefined}
        target="_blank"
        rel="noreferrer"
      >
        Export JSON
      </a>
      <a
        class={`rounded-lg border px-3 py-2 text-sm font-semibold ${
          selectedRunId
            ? "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            : "pointer-events-none border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-600"
        }`}
        href={selectedRunId ? `${apiUrl}/api/admin/debug/tests/${encodeURIComponent(selectedRunId)}/export?format=csv` : undefined}
        target="_blank"
        rel="noreferrer"
      >
        Export CSV
      </a>
    </div>
    <div class="mt-3 max-h-64 space-y-2 overflow-auto">
      {#if selectedRunEvents.length === 0}
        <p class="text-sm text-slate-500 dark:text-slate-400">Keine Events fuer den ausgewaehlten Run.</p>
      {:else}
        {#each selectedRunEvents as event}
          <div class="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class={`rounded px-2 py-0.5 font-semibold ${
                  event.level === "error"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : event.level === "warn"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {(event.level ?? "info").toUpperCase()}
              </span>
              <span class="font-semibold text-slate-700 dark:text-slate-200">{event.category ?? "event"}</span>
              <span class="text-slate-500 dark:text-slate-400">{event.at}</span>
              {#if event.clientId}
                <span class="text-slate-600 dark:text-slate-300">Client: {event.clientId}</span>
              {/if}
              {#if event.code}
                <span class="text-slate-600 dark:text-slate-300">Code: {event.code}</span>
              {/if}
            </div>
            <p class="mt-1 text-slate-700 dark:text-slate-200">{event.message}</p>
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
    <h4 class="text-base font-black text-slate-900 dark:text-slate-100">400Hz Audio-Watchdog</h4>
    <div class="mt-2 grid gap-2 sm:grid-cols-3">
      <div class="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p class="text-xs text-slate-500 dark:text-slate-400">Clients</p>
        <p class="text-xl font-black text-slate-900 dark:text-slate-100">{watchdog.totalClients}</p>
      </div>
      <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
        <p class="text-xs text-emerald-700 dark:text-emerald-300">Hearing</p>
        <p class="text-xl font-black text-emerald-800 dark:text-emerald-200">{watchdog.hearing}</p>
      </div>
      <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950/40">
        <p class="text-xs text-red-700 dark:text-red-300">Lost</p>
        <p class="text-xl font-black text-red-800 dark:text-red-200">{watchdog.lost}</p>
      </div>
    </div>
    <div class="mt-3 max-h-56 space-y-2 overflow-auto">
      {#if watchdog.events.length === 0}
        <p class="text-sm text-slate-500 dark:text-slate-400">Noch keine Watchdog-Events.</p>
      {:else}
        {#each watchdog.events as event}
          <div class="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
            <span class={event.state === "lost" ? "font-semibold text-red-600 dark:text-red-300" : "font-semibold text-emerald-600 dark:text-emerald-300"}>{event.state.toUpperCase()}</span>
            <span class="ml-2 text-slate-500 dark:text-slate-400">{event.at}</span>
            <div class="mt-1 text-slate-600 dark:text-slate-300">Client: {event.clientId} | Channel: {event.channelId || "-"}</div>
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <section class="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/60">
    <h4 class="text-base font-black text-slate-900 dark:text-slate-100">Producer-Status</h4>
    <div class="mt-2">
      <button
        class={`rounded-lg px-3 py-2 text-sm font-semibold ${
          $app.isTestToneActive
            ? "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
            : "bg-orange-500 text-white hover:bg-orange-600"
        }`}
        type="button"
        onclick={toggleTestToneFromDebug}
      >
        {$app.isTestToneActive ? "400Hz stoppen" : "400Hz starten (diese Session)"}
      </button>
      {#if $app.broadcasterStatus}
        <p class="mt-2 text-xs text-slate-600 dark:text-slate-300">{$app.broadcasterStatus}</p>
      {/if}
    </div>
    {#if !producerStatus}
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Keine Producer-Daten geladen.</p>
    {:else}
      <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">LiveMode: <span class="font-semibold">{producerStatus.liveMode}</span></p>
      <div class="mt-3 space-y-2">
        {#each producerStatus.channels as channel}
          <div class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <span class="text-slate-800 dark:text-slate-100">{channel.name}</span>
            <span class={channel.producerPresent ? "font-semibold text-emerald-600 dark:text-emerald-300" : "font-semibold text-red-600 dark:text-red-300"}>
              {channel.producerPresent ? "Producer da" : "Kein Producer"}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if statusMessage}
    <p class="text-sm text-red-600 dark:text-red-400">{statusMessage}</p>
  {/if}
</div>
