import type { Socket } from "socket.io-client";

import type { BroadcasterChannelStream } from "../types/recording";

export let autoSaveSessionTimer: ReturnType<typeof setTimeout> | null = null;
export let autoQrTimer: ReturnType<typeof setTimeout> | null = null;
export let statsIntervalTimer: ReturnType<typeof setInterval> | null = null;
export let listenerReconnectTimer: ReturnType<typeof setTimeout> | null = null;
export let broadcasterReconnectTimer: ReturnType<typeof setTimeout> | null = null;

export let broadcasterSocket: Socket | null = null;
export let listenerSocket: Socket | null = null;

export let broadcasterChannelStreams: BroadcasterChannelStream[] = [];

export let meterAudioContext: AudioContext | null = null;
export let meterAnimationId: number | null = null;
export const channelAnalyzers = new Map<string, { analyser: AnalyserNode; dataArray: Uint8Array; source: MediaStreamAudioSourceNode }>();

export function setMeterAudioContext(ctx: AudioContext | null): void {
  meterAudioContext = ctx;
}

export function setMeterAnimationId(id: number | null): void {
  meterAnimationId = id;
}

export function setAutoSaveSessionTimer(timer: ReturnType<typeof setTimeout> | null): void {
  autoSaveSessionTimer = timer;
}

export function setAutoQrTimer(timer: ReturnType<typeof setTimeout> | null): void {
  autoQrTimer = timer;
}

export function setStatsIntervalTimer(timer: ReturnType<typeof setInterval> | null): void {
  statsIntervalTimer = timer;
}

export function setListenerReconnectTimer(timer: ReturnType<typeof setTimeout> | null): void {
  listenerReconnectTimer = timer;
}

export function setBroadcasterReconnectTimer(timer: ReturnType<typeof setTimeout> | null): void {
  broadcasterReconnectTimer = timer;
}

export function setBroadcasterSocket(socket: Socket | null): void {
  broadcasterSocket = socket;
}

export function setListenerSocket(socket: Socket | null): void {
  listenerSocket = socket;
}

export function setBroadcasterChannelStreams(streams: BroadcasterChannelStream[]): void {
  broadcasterChannelStreams = streams;
}

export function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (!timer) return;
  clearTimeout(timer);
}

export function clearIntervalTimer(timer: ReturnType<typeof setInterval> | null): void {
  if (!timer) return;
  clearInterval(timer);
}
