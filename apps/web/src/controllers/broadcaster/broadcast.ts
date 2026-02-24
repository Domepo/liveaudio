import { Device } from "mediasoup-client";
import { io } from "socket.io-client";
import { get } from "svelte/store";

import { apiUrl, wsUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { tr } from "../../i18n";
import { emitAck, waitForSocketConnect } from "../../lib/socketAck";
import { app } from "../../stores/app";
import { setStatus } from "../logging";
import { attachLevelMeter, stopLevelMeters } from "./levelMeters";
import { refreshAudioInputs } from "./audioInputs";
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
      return;
    }
    if (s.isPreshowMusicActive) {
      setStatus("broadcaster", tr("broadcast.signaling_disconnected_preshow", { reason: String(reason) }));
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
      return;
    }
    if (s.isPreshowMusicActive) {
      setStatus("broadcaster", tr("broadcast.preshow_connected"));
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

type ProduceResult = { produced: string[]; failed: string[] };

async function produceMicToChannels(socket: ReturnType<typeof io>, device: Device): Promise<ProduceResult> {
  const produced: string[] = [];
  const failed: string[] = [];
  const streams = [...broadcasterChannelStreams];

  for (const channel of get(app).channels) {
    try {
      const selectedDeviceId = get(app).channelInputAssignments[channel.id] ?? "";
      const constraints: MediaTrackConstraints = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId }, autoGainControl: true, noiseSuppression: true, echoCancellation: true }
        : { autoGainControl: true, noiseSuppression: true, echoCancellation: true };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      streams.push({ channelId: channel.id, channelName: channel.name, stream });
      setBroadcasterChannelStreams(streams);

      await attachLevelMeter(channel.id, stream);
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("Kein Audio-Track vorhanden.");

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
          const producerResponse = await emitAck<{ producerId: string }>(socket, "broadcaster:produce", {
            transportId: transportData.transportId,
            sessionId: get(app).selectedSessionId,
            channelId: channel.id,
            kind,
            rtpParameters
          });
          callback({ id: producerResponse.producerId });
        } catch (error) {
          errback(error as Error);
        }
      });

      await sendTransport.produce({ track });
      produced.push(channel.name);
    } catch {
      failed.push(channel.name);
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
      // Feed the same pre-show signal into the channel meter, so output level is visible in channel cards.
      await attachLevelMeter(channel.id, new MediaStream([track.clone()]));

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
          const producerResponse = await emitAck<{ producerId: string }>(socket, "broadcaster:produce", {
            transportId: transportData.transportId,
            sessionId: get(app).selectedSessionId,
            channelId: channel.id,
            kind,
            rtpParameters
          });
          callback({ id: producerResponse.producerId });
        } catch (error) {
          errback(error as Error);
        }
      });

      await sendTransport.produce({ track });
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
  app.update((s) => ({ ...s, broadcasterWantsBroadcast: false, broadcasterReconnectAttempts: 0 }));

  if (broadcasterReconnectTimer) {
    clearTimer(broadcasterReconnectTimer);
    setBroadcasterReconnectTimer(null);
  }

  if (get(app).isRecording) {
    await stopRecording();
  }

  broadcasterSocket?.disconnect();
  setBroadcasterSocket(null);

  for (const channelStream of broadcasterChannelStreams) {
    channelStream.stream.getTracks().forEach((track) => track.stop());
  }
  setBroadcasterChannelStreams([]);

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
  await setLiveMode("none");

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
      await refreshAudioInputs(true);
    }

    const socket = await createBroadcasterSocket(state.selectedSessionId, state.sessionCode);
    const device = await loadDeviceForSocket(socket);
    const result = await produceMicToChannels(socket, device);

    if (result.produced.length === 0) throw new Error(tr("broadcast.no_channel_started"));

    app.update((s) => ({ ...s, isBroadcasting: true, isPreshowMusicActive: false, isTestToneActive: false }));
    await setLiveMode("mic");
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
    setStatus("broadcaster", `400Hz Testton aktiv auf ${result.produced.length} Kanal/Kanaelen.`);
    await refreshSessionStats();
  } catch (error) {
    app.update((s) => ({ ...s, broadcasterWantsBroadcast: false }));
    await stopAllOutput(true);
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message ?? tr("broadcast.unknown_error") }));
  }
}

