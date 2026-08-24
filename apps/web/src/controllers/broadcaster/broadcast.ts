import { Device } from "mediasoup-client";
import { io } from "socket.io-client";
import { get } from "svelte/store";

import { apiUrl, wsUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { tr } from "../../i18n";
import { emitAck, waitForSocketConnect } from "../../lib/socketAck";
import { getUserMediaWithTimeout } from "../../lib/media";
import { app } from "../../stores/app";
import { setStatus } from "../logging";
import { attachLevelMeter, stopLevelMeters } from "./levelMeters";
import { refreshAudioInputs } from "./audioInputs";
import {
  BROADCASTER_HEALTH_BAD_SAMPLES_BEFORE_RECOVERY,
  BROADCASTER_HEALTH_POLL_MS,
  BROADCASTER_WATCHDOG_MAX_RELOADS_PER_WINDOW,
  BROADCASTER_WATCHDOG_RECOVERIES_BEFORE_RELOAD,
  BROADCASTER_WATCHDOG_RECOVERY_WINDOW_MS,
  BROADCASTER_WATCHDOG_RELOAD_WINDOW_MS,
  calculateOutboundAudioMetrics,
  evaluateOutboundAudioHealth,
  snapshotOutboundAudioStats,
  summarizeOutboundAudioQuality,
  type OutboundAudioMetrics,
  type OutboundAudioSnapshot
} from "./healthWatchdog";
import { loadSessionRecordings, startRecording, stopRecording } from "../recording";
import { refreshSessionStats } from "../sessionDetail/stats";
import {
  broadcasterChannelStreams,
  broadcasterReconnectTimer,
  broadcasterSocket,
  clearTimer,
  setBroadcasterChannelStreams,
  setBroadcasterReconnectTimer,
  setBroadcasterSocket
} from "../runtime";

let preShowAudioElement: HTMLAudioElement | null = null;
let preShowLiveTracks: MediaStreamTrack[] = [];
let preShowEndedHandler: (() => void) | null = null;
let preShowAudioContext: AudioContext | null = null;
let preShowGraphCleanup: (() => void) | null = null;
let preShowBufferSource: AudioBufferSourceNode | null = null;
let preShowAutoSwitchTimer: ReturnType<typeof setTimeout> | null = null;
let testToneAudioContext: AudioContext | null = null;
let testToneCleanup: (() => void) | null = null;
const SWITCH_SETTLE_MS = 250;
type ActiveOutputMode = "mic" | "preshow" | "testtone";
type SendTransport = ReturnType<Device["createSendTransport"]>;
type MediaProducer = Awaited<ReturnType<SendTransport["produce"]>>;
type SendBinding = { transportId: string; transport: SendTransport; producer: MediaProducer };

const activeChannelTracks = new Map<string, MediaStreamTrack>();
const activeSendBindings = new Map<string, SendBinding>();
let broadcasterRecoveryInFlight = false;
let broadcasterHealthTimer: ReturnType<typeof setInterval> | null = null;
let broadcasterHealthCheckInFlight = false;
let watchdogRecoveryTimes: number[] = [];
let broadcasterAlertClearTimer: ReturnType<typeof setTimeout> | null = null;
const channelHealthSnapshots = new Map<string, OutboundAudioSnapshot>();
const channelBadHealthSamples = new Map<string, number>();
const WATCHDOG_RELOAD_INTENT_KEY = "livevoice-broadcaster-watchdog-reload-intent";
const WATCHDOG_RELOAD_HISTORY_KEY = "livevoice-broadcaster-watchdog-reload-history";

type WatchdogReloadIntent = {
  sessionId: string;
  mode: ActiveOutputMode;
  selectedPreShowTrackId: string;
  reason: string;
  expiresAt: number;
};

function clearBroadcasterAlertTimer(): void {
  if (!broadcasterAlertClearTimer) return;
  clearTimeout(broadcasterAlertClearTimer);
  broadcasterAlertClearTimer = null;
}

function showBroadcasterAlert(
  level: "warning" | "critical" | "success",
  title: string,
  message: string,
  action?: string,
  clearAfterMs?: number
): void {
  clearBroadcasterAlertTimer();
  app.update((state) => ({
    ...state,
    broadcasterAlert: { level, title, message, action, at: new Date().toISOString() }
  }));
  if (clearAfterMs) {
    broadcasterAlertClearTimer = setTimeout(() => {
      broadcasterAlertClearTimer = null;
      app.update((state) => ({ ...state, broadcasterAlert: null }));
    }, clearAfterMs);
  }
}

function showBroadcasterWarning(reason: string): void {
  if (get(app).broadcasterAlert?.level === "critical") return;
  showBroadcasterAlert(
    "warning",
    "Audioverbindung instabil",
    `Der Audio-Watchdog hat eine Störung erkannt: ${reason}.`,
    "Die Verbindung wird automatisch repariert. Bitte die Senderseite geöffnet lassen."
  );
}

function clearBroadcasterAlert(): void {
  clearBroadcasterAlertTimer();
  app.update((state) => ({ ...state, broadcasterAlert: null }));
}

async function waitForSwitchSettle(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, SWITCH_SETTLE_MS));
}

function clearPreShowAutoSwitchTimer(): void {
  if (!preShowAutoSwitchTimer) return;
  clearTimer(preShowAutoSwitchTimer);
  preShowAutoSwitchTimer = null;
}

function computeNextSwitchAt(timeValue: string): Date | null {
  const match = timeValue.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

function armPreShowAutoSwitchTimer(): void {
  clearPreShowAutoSwitchTimer();
  const state = get(app);
  if (!state.preShowAutoSwitchEnabled || !state.isPreshowMusicActive) return;
  const nextAt = computeNextSwitchAt(state.preShowAutoSwitchTime);
  if (!nextAt) return;
  const delay = Math.max(0, nextAt.getTime() - Date.now());
  preShowAutoSwitchTimer = setTimeout(() => {
    preShowAutoSwitchTimer = null;
    if (!get(app).isPreshowMusicActive) return;
    setStatus("broadcaster", `Auto-Switch auf Mic um ${nextAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    void startBroadcast();
  }, delay);
}

export function refreshPreShowAutoSwitchSchedule(): void {
  armPreShowAutoSwitchTimer();
}

function applyOccupiedState(payload: { ownerName?: string; startedAt?: string }): void {
  app.update((s) => ({
    ...s,
    broadcastOccupiedByOther: true,
    broadcastOwnerName: payload.ownerName ?? "",
    broadcastOwnerStartedAt: payload.startedAt ?? ""
  }));
}

async function ensureBroadcastOwnership(sessionId: string): Promise<boolean> {
  const owner = await fetchJson<{ occupied: boolean; occupiedByOther?: boolean; ownerName?: string; startedAt?: string }>(
    `${apiUrl}/api/admin/sessions/${encodeURIComponent(sessionId)}/broadcast-owner`
  );
  if (!owner.occupied || !owner.occupiedByOther) {
    app.update((s) => ({ ...s, broadcastOccupiedByOther: false, broadcastOwnerName: "", broadcastOwnerStartedAt: "" }));
    return true;
  }

  const startedAtLabel = owner.startedAt ? new Date(owner.startedAt).toLocaleString() : "-";
  applyOccupiedState({ ownerName: owner.ownerName, startedAt: owner.startedAt });
  const confirmed = window.confirm(
    tr("broadcast.takeover_confirm", {
      owner: owner.ownerName ?? tr("broadcast.unknown_owner"),
      since: startedAtLabel
    })
  );
  if (!confirmed) {
    setStatus("broadcaster", tr("broadcast.occupied_no_takeover"));
    return false;
  }

  setStatus("broadcaster", tr("broadcast.takeover_requested"));
  await fetchJson<{ ok: boolean; takenOver: boolean }>(`${apiUrl}/api/admin/sessions/${encodeURIComponent(sessionId)}/takeover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true })
  });
  app.update((s) => ({ ...s, broadcastOccupiedByOther: false, broadcastOwnerName: "", broadcastOwnerStartedAt: "" }));
  setStatus("broadcaster", tr("broadcast.takeover_success_starting"));
  return true;
}

function getCapturedAudioStream(audio: HTMLAudioElement): MediaStream | null {
  const capture = (audio as HTMLAudioElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream }).captureStream;
  if (typeof capture === "function") return capture.call(audio);
  const mozCapture = (audio as HTMLAudioElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream;
  if (typeof mozCapture === "function") return mozCapture.call(audio);
  return null;
}

async function waitForAudioTrack(stream: MediaStream, timeoutMs = 2500): Promise<MediaStreamTrack | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const track = stream.getAudioTracks()[0];
    if (track) return track;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return stream.getAudioTracks()[0] ?? null;
}

async function waitForAudioBuffered(audio: HTMLAudioElement, timeoutMs = 6000): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("loadeddata", onReady);
      window.clearTimeout(timer);
      resolve();
    };
    const onReady = () => finish();
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener("canplaythrough", onReady, { once: true });
    audio.addEventListener("loadeddata", onReady, { once: true });
  });
}

async function createLoopingPreShowTrackFromUrl(url: string): Promise<MediaStreamTrack> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Pre-show Datei konnte nicht geladen werden (${response.status})`);

  const data = await response.arrayBuffer();
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  const audioBuffer = await ctx.decodeAudioData(data.slice(0));
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  const destination = ctx.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(destination);
  source.start(0);

  preShowAudioContext = ctx;
  preShowBufferSource = source;
  preShowGraphCleanup = () => {
    try {
      source.stop();
    } catch {
      // ignore cleanup error
    }
    source.disconnect();
    gain.disconnect();
  };

  const track = destination.stream.getAudioTracks()[0];
  if (!track) throw new Error(tr("broadcast.no_preshow_audio_track"));
  return track;
}

async function createBroadcasterSocket(sessionId: string, sessionCode: string) {
  await fetchJson<{ authenticated: boolean }>(`${apiUrl}/api/admin/me`);
  const wsAuth = await fetchJson<{ token: string }>(`${apiUrl}/api/admin/ws-auth?sessionId=${encodeURIComponent(sessionId)}`);

  const socket = io(wsUrl, {
    withCredentials: true,
    auth: {
      role: "BROADCASTER",
      sessionId,
      sessionCode,
      adminWsToken: wsAuth.token
    },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 300,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });
  setBroadcasterSocket(socket);

  socket.on("disconnect", (reason) => {
    const s = get(app);
    if (!s.broadcasterWantsBroadcast) return;
    if (reason === "io server disconnect") {
      void stopAllOutput(true);
      setStatus("broadcaster", tr("broadcast.taken_over_by_other"));
      return;
    }
    if (s.isBroadcasting) {
      setStatus("broadcaster", tr("broadcast.signaling_disconnected_live", { reason: String(reason) }));
      scheduleBroadcasterRecovery(String(reason));
      return;
    }
    if (s.isPreshowMusicActive) {
      setStatus("broadcaster", tr("broadcast.signaling_disconnected_preshow", { reason: String(reason) }));
      scheduleBroadcasterRecovery(String(reason));
      return;
    }
    if (s.isTestToneActive) {
      scheduleBroadcasterRecovery(String(reason));
    }
  });

  socket.on("connect_error", (error) => {
    const message = String(error?.message ?? "");
    if (message.startsWith("TAKEOVER_REQUIRED:")) {
      try {
        const raw = message.slice("TAKEOVER_REQUIRED:".length);
        const payload = JSON.parse(raw) as { ownerName?: string; startedAt?: string };
        applyOccupiedState(payload);
        const startedAtLabel = payload.startedAt ? new Date(payload.startedAt).toLocaleString() : "-";
        setStatus(
          "broadcaster",
          tr("broadcast.occupied_with_owner", {
            owner: payload.ownerName ?? tr("broadcast.unknown_owner"),
            since: startedAtLabel
          })
        );
        return;
      } catch {
        // fall through to generic status
      }
    }
    setStatus("broadcaster", tr("broadcast.signaling_error", { message: message || tr("broadcast.unknown_error") }));
  });

  socket.on("connect", () => {
    const s = get(app);
    if (!s.broadcasterWantsBroadcast) return;
    app.update((prev) => ({ ...prev, broadcastOccupiedByOther: false, broadcastOwnerName: "", broadcastOwnerStartedAt: "" }));
    if (s.isBroadcasting) {
      setStatus("broadcaster", tr("broadcast.signaling_connected"));
      scheduleBroadcasterRecovery("signaling reconnected");
      return;
    }
    if (s.isPreshowMusicActive) {
      setStatus("broadcaster", tr("broadcast.preshow_connected"));
      scheduleBroadcasterRecovery("signaling reconnected");
      return;
    }
    if (s.isTestToneActive) {
      scheduleBroadcasterRecovery("signaling reconnected");
    }
  });

  await waitForSocketConnect(socket, 25_000);
  return socket;
}

async function loadDeviceForSocket(socket: ReturnType<typeof io>): Promise<Device> {
  const caps = await emitAck<{ rtpCapabilities: unknown }>(socket, "session:getRtpCapabilities", {});
  const device = new Device();
  await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });
  return device;
}

async function setLiveMode(mode: "none" | "mic" | "preshow" | "testtone"): Promise<void> {
  const socket = broadcasterSocket;
  const sessionId = get(app).selectedSessionId;
  if (!socket || !sessionId) return;
  try {
    await emitAck(socket, "broadcast:setLiveMode", { sessionId, mode });
  } catch {
    // ignore signaling race during switches
  }
}

function getActiveOutputMode(): ActiveOutputMode | null {
  const state = get(app);
  if (state.isBroadcasting) return "mic";
  if (state.isPreshowMusicActive) return "preshow";
  if (state.isTestToneActive) return "testtone";
  return null;
}

function closeSendBinding(binding: SendBinding): void {
  const socket = broadcasterSocket;
  if (socket?.connected) {
    void emitAck(socket, "transport:close", { transportId: binding.transportId }).catch(() => undefined);
  }
  try {
    binding.producer.close();
  } catch {
    // ignore cleanup error
  }
  try {
    binding.transport.close();
  } catch {
    // ignore cleanup error
  }
}

function replaceActiveSendBinding(channelId: string, binding: SendBinding): void {
  const previous = activeSendBindings.get(channelId);
  activeSendBindings.set(channelId, binding);
  channelHealthSnapshots.delete(channelId);
  channelBadHealthSamples.delete(channelId);
  if (previous) closeSendBinding(previous);
}

function closeActiveSendBindings(): void {
  const bindings = [...activeSendBindings.values()];
  activeSendBindings.clear();
  bindings.forEach(closeSendBinding);
}

function stopBroadcasterHealthWatchdog(): void {
  if (broadcasterHealthTimer) {
    clearInterval(broadcasterHealthTimer);
    broadcasterHealthTimer = null;
  }
  broadcasterHealthCheckInFlight = false;
  watchdogRecoveryTimes = [];
  channelHealthSnapshots.clear();
  channelBadHealthSamples.clear();
  app.update((state) => ({
    ...state,
    broadcasterQuality: {
      state: "idle",
      packetLossPercent: null,
      jitterMs: null,
      roundTripMs: null,
      updatedAt: ""
    }
  }));
}

function readWatchdogReloadHistory(): number[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(WATCHDOG_RELOAD_HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  } catch {
    return [];
  }
}

function requestWatchdogReload(reason: string): boolean {
  const state = get(app);
  const mode = getActiveOutputMode();
  if (!state.broadcasterWantsBroadcast || !state.selectedSessionId || !mode) return false;

  const now = Date.now();
  const recentReloads = readWatchdogReloadHistory().filter((at) => now - at < BROADCASTER_WATCHDOG_RELOAD_WINDOW_MS);
  if (recentReloads.length >= BROADCASTER_WATCHDOG_MAX_RELOADS_PER_WINDOW) {
    setStatus("broadcaster", `Audio-Watchdog: automatischer Reload begrenzt (${reason}). Verbindung wird weiter repariert …`);
    showBroadcasterAlert(
      "critical",
      "Audio weiterhin gestört",
      `Mehrere automatische Neustarts waren nötig: ${reason}.`,
      "Die Verbindung wird weiter repariert. Falls die Warnung bleibt, bitte Mikrofon, Browser und Netzwerk prüfen."
    );
    return false;
  }

  const intent: WatchdogReloadIntent = {
    sessionId: state.selectedSessionId,
    mode,
    selectedPreShowTrackId: state.selectedPreShowTrackId,
    reason,
    expiresAt: now + 2 * 60_000
  };
  try {
    sessionStorage.setItem(WATCHDOG_RELOAD_HISTORY_KEY, JSON.stringify([...recentReloads, now]));
    sessionStorage.setItem(WATCHDOG_RELOAD_INTENT_KEY, JSON.stringify(intent));
  } catch {
    return false;
  }

  setStatus("broadcaster", `Audio-Watchdog lädt die Senderseite neu (${reason}) …`);
  showBroadcasterAlert(
    "critical",
    "Automatischer Sender-Neustart",
    `Die Audioverbindung ist wiederholt ausgefallen: ${reason}.`,
    "Die Senderseite lädt jetzt neu und startet den Stream automatisch wieder."
  );
  history.replaceState({}, "", `/login/sessions/${encodeURIComponent(state.selectedSessionId)}`);
  window.setTimeout(() => window.location.reload(), 100);
  return true;
}

function requestWatchdogRecovery(reason: string): void {
  if (broadcasterReconnectTimer || broadcasterRecoveryInFlight) return;
  const now = Date.now();
  watchdogRecoveryTimes = watchdogRecoveryTimes.filter((at) => now - at < BROADCASTER_WATCHDOG_RECOVERY_WINDOW_MS);
  watchdogRecoveryTimes.push(now);

  if (watchdogRecoveryTimes.length >= BROADCASTER_WATCHDOG_RECOVERIES_BEFORE_RELOAD && requestWatchdogReload(reason)) {
    return;
  }
  scheduleBroadcasterRecovery(`Audio-Watchdog: ${reason}`);
}

async function checkBroadcasterAudioHealth(): Promise<void> {
  if (broadcasterHealthCheckInFlight) return;
  const state = get(app);
  if (!state.broadcasterWantsBroadcast || !getActiveOutputMode()) return;

  broadcasterHealthCheckInFlight = true;
  try {
    const bindings = [...activeSendBindings.entries()];
    if (bindings.length === 0) {
      requestWatchdogRecovery("kein aktiver Audiotransport");
      return;
    }

    const findings = await Promise.all(
      bindings.map(async ([channelId, binding]) => {
        const track = activeChannelTracks.get(channelId);
        if (!track || track.readyState === "ended") {
          return { channelId, unhealthy: true, reason: "Mikrofon-Track beendet", immediate: true };
        }
        if (track.muted || !track.enabled) {
          return { channelId, unhealthy: true, reason: "Mikrofon-Track liefert keine Daten", immediate: false };
        }

        try {
          const previous = channelHealthSnapshots.get(channelId) ?? null;
          const snapshot = snapshotOutboundAudioStats(await binding.producer.getStats());
          const health = evaluateOutboundAudioHealth(previous, snapshot);
          const metrics = calculateOutboundAudioMetrics(previous, snapshot);
          channelHealthSnapshots.set(channelId, snapshot);
          return { channelId, unhealthy: health.state !== "healthy", reason: health.reason, immediate: false, metrics };
        } catch {
          return { channelId, unhealthy: true, reason: "WebRTC-Statistik nicht erreichbar", immediate: false };
        }
      })
    );

    const metrics = findings
      .map((finding) => ("metrics" in finding ? finding.metrics : null))
      .filter((sample): sample is OutboundAudioMetrics => sample !== null);
    const quality = summarizeOutboundAudioQuality(metrics);
    app.update((current) => ({
      ...current,
      broadcasterQuality: {
        ...quality,
        state: findings.some((finding) => finding.unhealthy) ? "poor" : quality.state,
        packetLossPercent: quality.packetLossPercent === null ? null : Number(quality.packetLossPercent.toFixed(1)),
        jitterMs: quality.jitterMs === null ? null : Math.round(quality.jitterMs),
        roundTripMs: quality.roundTripMs === null ? null : Math.round(quality.roundTripMs),
        updatedAt: new Date().toISOString()
      }
    }));

    for (const finding of findings) {
      if (!finding.unhealthy) {
        channelBadHealthSamples.set(finding.channelId, 0);
        continue;
      }

      const badSamples = finding.immediate ? BROADCASTER_HEALTH_BAD_SAMPLES_BEFORE_RECOVERY : (channelBadHealthSamples.get(finding.channelId) ?? 0) + 1;
      channelBadHealthSamples.set(finding.channelId, badSamples);
      if (badSamples >= BROADCASTER_HEALTH_BAD_SAMPLES_BEFORE_RECOVERY) {
        channelBadHealthSamples.set(finding.channelId, 0);
        requestWatchdogRecovery(finding.reason);
        break;
      }
    }
  } finally {
    broadcasterHealthCheckInFlight = false;
  }
}

function startBroadcasterHealthWatchdog(): void {
  if (broadcasterHealthTimer) return;
  app.update((state) => ({
    ...state,
    broadcasterQuality: {
      state: "measuring",
      packetLossPercent: null,
      jitterMs: null,
      roundTripMs: null,
      updatedAt: new Date().toISOString()
    }
  }));
  broadcasterHealthTimer = setInterval(() => {
    void checkBroadcasterAudioHealth();
  }, BROADCASTER_HEALTH_POLL_MS);
}

function scheduleBroadcasterRecovery(reason: string): void {
  const state = get(app);
  if (!state.broadcasterWantsBroadcast || !getActiveOutputMode() || broadcasterReconnectTimer || broadcasterRecoveryInFlight) return;
  const delay = Math.min(5_000, 250 * 2 ** Math.min(state.broadcasterReconnectAttempts, 5));
  setStatus("broadcaster", `Verbindung wird wiederhergestellt (${reason}) …`);
  showBroadcasterWarning(reason);
  app.update((current) => ({
    ...current,
    broadcasterQuality: { ...current.broadcasterQuality, state: "poor", updatedAt: new Date().toISOString() }
  }));
  setBroadcasterReconnectTimer(
    setTimeout(() => {
      setBroadcasterReconnectTimer(null);
      void recoverBroadcasterOutput(reason);
    }, delay)
  );
}

async function captureMicTrack(channel: { id: string; name: string }): Promise<MediaStreamTrack> {
  const selectedDeviceId = get(app).channelInputAssignments[channel.id] ?? "";
  const constraints: MediaTrackConstraints = selectedDeviceId
    ? { deviceId: { exact: selectedDeviceId }, autoGainControl: true, noiseSuppression: true, echoCancellation: true }
    : { autoGainControl: true, noiseSuppression: true, echoCancellation: true };
  const stream = await getUserMediaWithTimeout({ audio: constraints, video: false });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("Kein Audio-Track vorhanden.");
  setBroadcasterChannelStreams([...broadcasterChannelStreams, { channelId: channel.id, channelName: channel.name, stream }]);
  activeChannelTracks.set(channel.id, track);
  await attachLevelMeter(channel.id, stream);
  return track;
}

async function createChannelSendBinding(
  socket: ReturnType<typeof io>,
  device: Device,
  channel: { id: string; name: string },
  track: MediaStreamTrack
): Promise<SendBinding> {
  const transportData = await emitAck<{
    transportId: string;
    iceParameters: unknown;
    iceCandidates: unknown[];
    dtlsParameters: unknown;
  }>(socket, "broadcaster:createTransport", { sessionId: get(app).selectedSessionId, channelId: channel.id });

  const sendTransport = device.createSendTransport({
    id: transportData.transportId,
    iceParameters: transportData.iceParameters as never,
    iceCandidates: transportData.iceCandidates as never,
    dtlsParameters: transportData.dtlsParameters as never
  });
  sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
    try {
      await emitAck(socket, "transport:connect", { transportId: transportData.transportId, dtlsParameters });
      callback();
    } catch (error) {
      errback(error as Error);
    }
  });
  sendTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
    try {
      const response = await emitAck<{ producerId: string }>(socket, "broadcaster:produce", {
        transportId: transportData.transportId,
        sessionId: get(app).selectedSessionId,
        channelId: channel.id,
        kind,
        rtpParameters
      });
      callback({ id: response.producerId });
    } catch (error) {
      errback(error as Error);
    }
  });
  sendTransport.on("connectionstatechange", (connectionState) => {
    if (connectionState === "failed" || connectionState === "disconnected") {
      scheduleBroadcasterRecovery(`transport ${connectionState}`);
    }
  });

  try {
    const producer = await sendTransport.produce({ track, stopTracks: false });
    return { transportId: transportData.transportId, transport: sendTransport, producer };
  } catch (error) {
    sendTransport.close();
    throw error;
  }
}

async function recoverBroadcasterOutput(reason: string): Promise<void> {
  if (broadcasterRecoveryInFlight) return;
  const initialState = get(app);
  const mode = getActiveOutputMode();
  if (!initialState.broadcasterWantsBroadcast || !mode) return;

  broadcasterRecoveryInFlight = true;
  let shouldRetry = false;
  try {
    const socket = broadcasterSocket;
    if (!socket?.connected) throw new Error("Signaling noch nicht verbunden");
    const device = await loadDeviceForSocket(socket);
    const failed: string[] = [];
    let recovered = 0;

    for (const channel of get(app).channels) {
      try {
        let track = activeChannelTracks.get(channel.id);
        if ((!track || track.readyState === "ended") && mode === "mic") {
          track = await captureMicTrack(channel);
        }
        if (!track || track.readyState === "ended") throw new Error("Audio-Track nicht verfügbar");
        const binding = await createChannelSendBinding(socket, device, channel, track);
        replaceActiveSendBinding(channel.id, binding);
        recovered += 1;
      } catch {
        failed.push(channel.name);
      }
    }

    if (recovered === 0 || failed.length > 0) {
      throw new Error(failed.length > 0 ? `Kanäle fehlgeschlagen: ${failed.join(", ")}` : "Kein Kanal konnte wiederhergestellt werden");
    }

    await setLiveMode(mode);
    app.update((state) => ({ ...state, broadcasterReconnectAttempts: 0 }));
    setStatus("broadcaster", `Verbindung wiederhergestellt (${recovered} Kanal/Kanäle).`);
    showBroadcasterAlert(
      "success",
      "Audioverbindung wiederhergestellt",
      `${recovered} Kanal/Kanäle senden wieder stabil.`,
      undefined,
      10_000
    );
    app.update((current) => ({
      ...current,
      broadcasterQuality: {
        state: "measuring",
        packetLossPercent: null,
        jitterMs: null,
        roundTripMs: null,
        updatedAt: new Date().toISOString()
      }
    }));
    await refreshSessionStats();
  } catch (error) {
    shouldRetry = get(app).broadcasterWantsBroadcast && Boolean(getActiveOutputMode());
    app.update((state) => ({ ...state, broadcasterReconnectAttempts: state.broadcasterReconnectAttempts + 1 }));
    setStatus("broadcaster", `Wiederherstellung fehlgeschlagen: ${(error as Error).message}`);
    showBroadcasterWarning(`${reason}; Wiederherstellung fehlgeschlagen: ${(error as Error).message}`);
  } finally {
    broadcasterRecoveryInFlight = false;
    if (shouldRetry) scheduleBroadcasterRecovery(reason);
  }
}

type ProduceResult = { produced: string[]; failed: string[] };

async function produceMicToChannels(socket: ReturnType<typeof io>, device: Device): Promise<ProduceResult> {
  const produced: string[] = [];
  const failed: string[] = [];

  for (const channel of get(app).channels) {
    try {
      const track = await captureMicTrack(channel);
      const binding = await createChannelSendBinding(socket, device, channel, track);
      replaceActiveSendBinding(channel.id, binding);
      produced.push(channel.name);
    } catch (error) {
      failed.push(`${channel.name}: ${(error as Error).message || "unbekannter Fehler"}`);
    }
  }

  return { produced, failed };
}

async function producePreShowToChannels(socket: ReturnType<typeof io>, device: Device, baseTrack: MediaStreamTrack): Promise<ProduceResult> {
  const produced: string[] = [];
  const failed: string[] = [];

  for (const channel of get(app).channels) {
    try {
      const track = baseTrack.clone();
      preShowLiveTracks.push(track);
      activeChannelTracks.set(channel.id, track);
      // Feed the same pre-show signal into the channel meter, so output level is visible in channel cards.
      await attachLevelMeter(channel.id, new MediaStream([track.clone()]));
      const binding = await createChannelSendBinding(socket, device, channel, track);
      replaceActiveSendBinding(channel.id, binding);
      produced.push(channel.name);
    } catch {
      failed.push(channel.name);
    }
  }

  return { produced, failed };
}

async function createTestToneTrack(frequencyHz = 400): Promise<MediaStreamTrack> {
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = frequencyHz;
  const gain = ctx.createGain();
  gain.gain.value = 0.12;
  const destination = ctx.createMediaStreamDestination();
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  testToneAudioContext = ctx;
  testToneCleanup = () => {
    try {
      oscillator.stop();
    } catch {
      // ignore cleanup error
    }
    oscillator.disconnect();
    gain.disconnect();
  };
  const track = destination.stream.getAudioTracks()[0];
  if (!track) throw new Error("Testton Track konnte nicht erstellt werden.");
  return track;
}

async function stopAllOutput(silent = false): Promise<void> {
  clearPreShowAutoSwitchTimer();
  stopBroadcasterHealthWatchdog();
  clearBroadcasterAlert();
  app.update((s) => ({ ...s, broadcasterWantsBroadcast: false, broadcasterReconnectAttempts: 0 }));

  if (broadcasterReconnectTimer) {
    clearTimer(broadcasterReconnectTimer);
    setBroadcasterReconnectTimer(null);
  }

  if (get(app).isRecording) {
    await stopRecording();
  }

  const socket = broadcasterSocket;
  const sessionId = get(app).selectedSessionId;
  await setLiveMode("none");
  if (socket?.connected && sessionId) {
    try {
      await emitAck(socket, "broadcaster:stop", { sessionId });
    } catch {
      // The server-side disconnect grace period remains as fallback cleanup.
    }
  }
  closeActiveSendBindings();
  socket?.disconnect();
  setBroadcasterSocket(null);

  for (const channelStream of broadcasterChannelStreams) {
    channelStream.stream.getTracks().forEach((track) => track.stop());
  }
  setBroadcasterChannelStreams([]);
  activeChannelTracks.clear();

  for (const track of preShowLiveTracks) {
    try {
      track.stop();
    } catch {
      // ignore cleanup error
    }
  }
  preShowLiveTracks = [];

  if (preShowAudioElement) {
    if (preShowEndedHandler) {
      preShowAudioElement.removeEventListener("ended", preShowEndedHandler);
      preShowEndedHandler = null;
    }
    try {
      preShowAudioElement.pause();
    } catch {
      // ignore cleanup error
    }
    preShowAudioElement.src = "";
    preShowAudioElement = null;
  }
  if (preShowGraphCleanup) {
    try {
      preShowGraphCleanup();
    } catch {
      // ignore cleanup error
    }
    preShowGraphCleanup = null;
  }
  if (preShowAudioContext) {
    try {
      void preShowAudioContext.close();
    } catch {
      // ignore cleanup error
    }
    preShowAudioContext = null;
  }
  preShowBufferSource = null;

  if (testToneCleanup) {
    try {
      testToneCleanup();
    } catch {
      // ignore cleanup error
    }
    testToneCleanup = null;
  }
  if (testToneAudioContext) {
    try {
      void testToneAudioContext.close();
    } catch {
      // ignore cleanup error
    }
    testToneAudioContext = null;
  }

  stopLevelMeters();

  app.update((s) => ({ ...s, isBroadcasting: false, isPreshowMusicActive: false, isTestToneActive: false }));

  if (!silent) {
    setStatus("broadcaster", tr("broadcast.stopped"));
  }

  await refreshSessionStats();
  await loadSessionRecordings();
}

export async function startBroadcast(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId || !state.sessionCode) {
    setStatus("broadcaster", tr("broadcast.session_and_token_required"));
    return;
  }
  if (state.isBroadcasting) {
    await stopBroadcast();
    return;
  }
  if (state.channels.length === 0) {
    setStatus("broadcaster", tr("broadcast.need_at_least_one_channel"));
    return;
  }

  stopLevelMeters();

  try {
    const ownershipGranted = await ensureBroadcastOwnership(state.selectedSessionId);
    if (!ownershipGranted) return;

    if (state.isPreshowMusicActive) {
      await stopPreShowMusic(true);
      await waitForSwitchSettle();
    }
    if (state.isTestToneActive) {
      await stopBroadcast();
      await waitForSwitchSettle();
    }

    app.update((s) => ({ ...s, broadcasterWantsBroadcast: true }));

    if (state.audioInputs.length === 0) {
      const microphoneReady = await refreshAudioInputs(true);
      if (!microphoneReady) {
        throw new Error("Mikrofon nicht freigegeben. Bitte die Browser-Berechtigung prüfen und erneut auf Live drücken.");
      }
    }

    const socket = await createBroadcasterSocket(state.selectedSessionId, state.sessionCode);
    const device = await loadDeviceForSocket(socket);
    const result = await produceMicToChannels(socket, device);

    if (result.produced.length === 0) {
      throw new Error(result.failed.length > 0 ? `${tr("broadcast.no_channel_started")} ${result.failed.join("; ")}` : tr("broadcast.no_channel_started"));
    }

    app.update((s) => ({ ...s, isBroadcasting: true, isPreshowMusicActive: false, isTestToneActive: false }));
    await setLiveMode("mic");
    startBroadcasterHealthWatchdog();
    await startRecording();

    setStatus(
      "broadcaster",
      result.failed.length > 0
        ? tr("broadcast.live_with_failures", { count: result.produced.length, failed: result.failed.join(", ") })
        : tr("broadcast.live_started", { count: result.produced.length })
    );

    await refreshSessionStats();
  } catch (error) {
    app.update((s) => ({ ...s, broadcasterWantsBroadcast: false }));
    await stopAllOutput(true);
    const message = (error as Error).message ?? tr("broadcast.unknown_error");
    if (message.startsWith("TAKEOVER_REQUIRED:")) {
      try {
        const raw = message.slice("TAKEOVER_REQUIRED:".length);
        const payload = JSON.parse(raw) as { ownerName?: string; startedAt?: string };
        const startedAtLabel = payload.startedAt ? new Date(payload.startedAt).toLocaleString() : "-";
        setStatus(
          "broadcaster",
          tr("broadcast.occupied_confirm_takeover", {
            owner: payload.ownerName ?? tr("broadcast.unknown_owner"),
            since: startedAtLabel
          })
        );
        return;
      } catch {
        // fall through to generic message
      }
    }
    setStatus("broadcaster", tr("status.error_prefix", { message }));
  }
}

export async function startPreShowMusic(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId || !state.sessionCode) {
    setStatus("broadcaster", tr("broadcast.session_and_token_required"));
    return;
  }
  if (state.isPreshowMusicActive) {
    await stopPreShowMusic();
    return;
  }
  if (state.isBroadcasting) {
    await stopBroadcast();
    await waitForSwitchSettle();
  }
  if (state.isTestToneActive) {
    await stopBroadcast();
    await waitForSwitchSettle();
  }
  if (state.channels.length === 0) {
    setStatus("broadcaster", tr("broadcast.need_at_least_one_channel"));
    return;
  }

  const selectedTrack = state.preShowTracks.find((track) => track.id === state.selectedPreShowTrackId) ?? null;
  const musicUrl = selectedTrack?.url?.trim() ?? "";
  if (!musicUrl) {
    setStatus("broadcaster", tr("broadcast.select_preshow_first"));
    return;
  }

  let audio: HTMLAudioElement | null = null;
  let baseTrack: MediaStreamTrack | null = null;
  let sourceStream: MediaStream | null = null;

  try {
    const ownershipGranted = await ensureBroadcastOwnership(state.selectedSessionId);
    if (!ownershipGranted) return;

    app.update((s) => ({ ...s, broadcasterWantsBroadcast: true }));

    const socket = await createBroadcasterSocket(state.selectedSessionId, state.sessionCode);
    const device = await loadDeviceForSocket(socket);

    // Preferred path: decode once and loop from memory to avoid initial buffering stutter after switching.
    try {
      baseTrack = await createLoopingPreShowTrackFromUrl(musicUrl);
    } catch {
      // Fallback path for codecs/browsers that fail decodeAudioData.
      audio = new Audio(musicUrl);
      audio.loop = true;
      audio.preload = "auto";
      audio.crossOrigin = "use-credentials";
      audio.muted = false;
      audio.volume = 1;
      preShowEndedHandler = () => {
        if (!get(app).isPreshowMusicActive) return;
        audio!.currentTime = 0;
        void audio!.play();
      };
      audio.addEventListener("ended", preShowEndedHandler);
      audio.load();

      try {
        const ctx = new AudioContext();
        preShowAudioContext = ctx;
        if (ctx.state === "suspended") await ctx.resume();
        const source = ctx.createMediaElementSource(audio);
        const destination = ctx.createMediaStreamDestination();
        source.connect(destination);
        preShowGraphCleanup = () => {
          source.disconnect();
        };
        sourceStream = destination.stream;
      } catch {
        sourceStream = getCapturedAudioStream(audio);
        if (!sourceStream) throw new Error(tr("broadcast.preshow_capture_not_supported"));
      }

      await waitForAudioBuffered(audio);
      await audio.play();
      baseTrack = await waitForAudioTrack(sourceStream);
      if (!baseTrack) throw new Error(tr("broadcast.no_preshow_audio_track"));
    }

    const result = await producePreShowToChannels(socket, device, baseTrack);
    if (result.produced.length === 0) throw new Error(tr("broadcast.preshow_no_channel_started"));

    preShowAudioElement = audio;
    app.update((s) => ({ ...s, isPreshowMusicActive: true, isBroadcasting: false, isTestToneActive: false }));
    await setLiveMode("preshow");
    startBroadcasterHealthWatchdog();
    armPreShowAutoSwitchTimer();

    setStatus(
      "broadcaster",
      result.failed.length > 0
        ? tr("broadcast.preshow_active_with_failures", { count: result.produced.length, failed: result.failed.join(", ") })
        : tr("broadcast.preshow_active", { count: result.produced.length })
    );

    await refreshSessionStats();
  } catch (error) {
    if (baseTrack) {
      try {
        baseTrack.stop();
      } catch {
        // ignore cleanup error
      }
    }
    if (audio) {
      if (preShowEndedHandler) {
        audio.removeEventListener("ended", preShowEndedHandler);
        preShowEndedHandler = null;
      }
      try {
        audio.pause();
      } catch {
        // ignore cleanup error
      }
      audio.src = "";
    }
    if (preShowGraphCleanup) {
      try {
        preShowGraphCleanup();
      } catch {
        // ignore cleanup error
      }
      preShowGraphCleanup = null;
    }
    if (preShowAudioContext) {
      try {
        void preShowAudioContext.close();
      } catch {
        // ignore cleanup error
      }
      preShowAudioContext = null;
    }

    app.update((s) => ({ ...s, broadcasterWantsBroadcast: false }));
    await stopAllOutput(true);
    const message = (error as Error).message ?? tr("broadcast.unknown_error");
    setStatus("broadcaster", tr("broadcast.preshow_error", { message }));
  }
}

export async function stopPreShowMusic(silent = false): Promise<void> {
  if (!get(app).isPreshowMusicActive && !broadcasterSocket && preShowLiveTracks.length === 0 && !preShowAudioElement) return;
  await stopAllOutput(true);
  if (!silent) {
    setStatus("broadcaster", tr("broadcast.preshow_stopped"));
  }
}

export async function stopBroadcast(): Promise<void> {
  if (!get(app).isBroadcasting && !get(app).isPreshowMusicActive && !get(app).isTestToneActive && !broadcasterSocket && broadcasterChannelStreams.length === 0) return;
  await stopAllOutput(true);
  setStatus("broadcaster", tr("broadcast.stopped"));
}

export async function startTestToneBroadcast(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId || !state.sessionCode) {
    setStatus("broadcaster", tr("broadcast.session_and_token_required"));
    return;
  }
  if (state.isTestToneActive) {
    await stopBroadcast();
    return;
  }
  if (state.channels.length === 0) {
    setStatus("broadcaster", tr("broadcast.need_at_least_one_channel"));
    return;
  }
  if (state.isBroadcasting || state.isPreshowMusicActive) {
    await stopBroadcast();
    await waitForSwitchSettle();
  }

  try {
    const ownershipGranted = await ensureBroadcastOwnership(state.selectedSessionId);
    if (!ownershipGranted) return;

    app.update((s) => ({ ...s, broadcasterWantsBroadcast: true }));
    const socket = await createBroadcasterSocket(state.selectedSessionId, state.sessionCode);
    const device = await loadDeviceForSocket(socket);
    const toneTrack = await createTestToneTrack(400);
    const result = await producePreShowToChannels(socket, device, toneTrack);
    if (result.produced.length === 0) throw new Error(tr("broadcast.no_channel_started"));

    app.update((s) => ({ ...s, isBroadcasting: false, isPreshowMusicActive: false, isTestToneActive: true }));
    await setLiveMode("testtone");
    startBroadcasterHealthWatchdog();
    setStatus("broadcaster", `400Hz Testton aktiv auf ${result.produced.length} Kanal/Kanaelen.`);
    await refreshSessionStats();
  } catch (error) {
    app.update((s) => ({ ...s, broadcasterWantsBroadcast: false }));
    await stopAllOutput(true);
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message ?? tr("broadcast.unknown_error") }));
  }
}

export async function resumeBroadcastAfterWatchdogReload(): Promise<void> {
  let intent: WatchdogReloadIntent | null = null;
  try {
    const raw = sessionStorage.getItem(WATCHDOG_RELOAD_INTENT_KEY);
    sessionStorage.removeItem(WATCHDOG_RELOAD_INTENT_KEY);
    if (raw) intent = JSON.parse(raw) as WatchdogReloadIntent;
  } catch {
    return;
  }

  const state = get(app);
  if (!intent || intent.expiresAt < Date.now() || intent.sessionId !== state.selectedSessionId || !state.adminAuthenticated) return;

  setStatus("broadcaster", "Audio-Watchdog: Sender wird nach dem Reload automatisch wieder gestartet …");
  showBroadcasterAlert(
    "warning",
    "Sender wurde automatisch neu geladen",
    `Auslöser: ${intent.reason || "instabile Audioverbindung"}.`,
    "Der Stream wird jetzt ohne Eingriff automatisch wieder gestartet."
  );
  if (intent.selectedPreShowTrackId) {
    app.update((current) => ({ ...current, selectedPreShowTrackId: intent!.selectedPreShowTrackId }));
  }

  if (intent.mode === "mic") await startBroadcast();
  if (intent.mode === "preshow") await startPreShowMusic();
  if (intent.mode === "testtone") await startTestToneBroadcast();

  const resumedState = get(app);
  const resumed = resumedState.isBroadcasting || resumedState.isPreshowMusicActive || resumedState.isTestToneActive;
  if (!resumed) {
    setStatus("broadcaster", "Automatischer Neustart fehlgeschlagen – bitte einmal Live drücken.");
    showBroadcasterAlert(
      "critical",
      "Automatischer Neustart fehlgeschlagen",
      "Der Stream konnte nach dem Reload nicht automatisch gestartet werden.",
      "Bitte einmal auf Live drücken und Mikrofon sowie Netzwerk prüfen."
    );
  } else {
    showBroadcasterAlert(
      "success",
      "Sender erfolgreich neu gestartet",
      "Der Stream ist nach dem automatischen Reload wieder live.",
      undefined,
      10_000
    );
  }
}

