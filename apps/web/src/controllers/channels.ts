import { get } from "svelte/store";

import type { Channel } from "../types/channel";
import { app } from "../stores/app";

export function syncChannelAssignments(nextChannels: Channel[]): void {
  const state = get(app);
  const next: Record<string, string> = {};
  for (const [index, channel] of nextChannels.entries()) {
    const previous = state.channelInputAssignments[channel.id];
    if (previous !== undefined) {
      next[channel.id] = previous;
    } else {
      next[channel.id] = state.audioInputs[index]?.deviceId ?? "";
    }
  }
  app.update((s) => ({ ...s, channelInputAssignments: next }));
}

export function channelIsLive(channelId: string, mode: "admin" | "listener"): boolean {
  const state = get(app);
  return (mode === "admin" ? state.adminLiveChannelIds : state.listenerLiveChannelIds).includes(channelId);
}

export function channelDbToPercent(db: number): number {
  const minDb = -60;
  const maxDb = 0;
  const clamped = Math.max(minDb, Math.min(maxDb, db));
  return ((clamped - minDb) / (maxDb - minDb)) * 100;
}

export function meterBarClass(db: number): string {
  if (db > -12) return "bg-gradient-to-r from-amber-400 to-emerald-500";
  if (db > -24) return "bg-gradient-to-r from-orange-400 to-lime-500";
  return "bg-gradient-to-r from-rose-500 to-amber-400";
}

