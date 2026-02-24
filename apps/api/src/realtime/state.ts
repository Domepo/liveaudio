export type ListenerSocketAuth = { role: "LISTENER"; sessionId: string };
export type BroadcasterSocketAuth = { role: "BROADCASTER"; sessionId: string };
export type SocketAuthPayload = ListenerSocketAuth | BroadcasterSocketAuth;
export type BroadcastOwner = { socketId: string; userId?: string; userName: string; connectedAt: number };
export type SessionLiveMode = "none" | "mic" | "preshow" | "testtone";

export const attempts = new Map<string, { count: number; until: number }>();
export const listenerSocketsBySession = new Map<string, Set<string>>();
export const broadcasterSocketsBySession = new Map<string, Set<string>>();
export const listenerStateBySocket = new Map<string, { sessionId: string; channelId?: string; joinedAt?: number }>();
export const broadcastOwnerBySession = new Map<string, BroadcastOwner>();
export const liveModeBySession = new Map<string, SessionLiveMode>();
export const liveListenerCountsBySessionChannel = new Map<string, Map<string, number>>();
export const sessionLiveSeries = new Map<string, Array<{ ts: number; total: number; channels: Record<string, number> }>>();
const MAX_LIVE_POINTS = 180;

export function isListenerAuth(auth: SocketAuthPayload): auth is ListenerSocketAuth {
  return auth.role === "LISTENER";
}

export function addSocketToRoleMap(map: Map<string, Set<string>>, sessionId: string, socketId: string): void {
  const set = map.get(sessionId) ?? new Set<string>();
  set.add(socketId);
  map.set(sessionId, set);
}

export function removeSocketFromRoleMap(map: Map<string, Set<string>>, sessionId: string, socketId: string): void {
  const set = map.get(sessionId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) map.delete(sessionId);
}

export function changeLiveListenerCount(sessionId: string, channelId: string, delta: number): void {
  const channelMap = liveListenerCountsBySessionChannel.get(sessionId) ?? new Map<string, number>();
  const prev = channelMap.get(channelId) ?? 0;
  const next = Math.max(0, prev + delta);
  if (next <= 0) {
    channelMap.delete(channelId);
  } else {
    channelMap.set(channelId, next);
  }
  if (channelMap.size === 0) {
    liveListenerCountsBySessionChannel.delete(sessionId);
  } else {
    liveListenerCountsBySessionChannel.set(sessionId, channelMap);
  }
}

export function getLiveListenerChannelCounts(sessionId: string): Record<string, number> {
  const channelMap = liveListenerCountsBySessionChannel.get(sessionId);
  if (!channelMap) return {};
  const out: Record<string, number> = {};
  for (const [channelId, count] of channelMap.entries()) {
    out[channelId] = count;
  }
  return out;
}

export function getLiveListenerTotal(sessionId: string): number {
  const channelMap = liveListenerCountsBySessionChannel.get(sessionId);
  if (!channelMap) return 0;
  let total = 0;
  for (const count of channelMap.values()) total += count;
  return total;
}

export function recordLiveSnapshot(sessionId: string): void {
  const history = sessionLiveSeries.get(sessionId) ?? [];
  const channels = getLiveListenerChannelCounts(sessionId);
  history.push({
    ts: Date.now(),
    total: Object.values(channels).reduce((sum, value) => sum + value, 0),
    channels
  });
  while (history.length > MAX_LIVE_POINTS) history.shift();
  sessionLiveSeries.set(sessionId, history);
}

export function clearSessionAnalyticsState(sessionId: string): void {
  sessionLiveSeries.delete(sessionId);
  recordLiveSnapshot(sessionId);
}

export function getBroadcastOwner(sessionId: string): BroadcastOwner | null {
  return broadcastOwnerBySession.get(sessionId) ?? null;
}

export function setBroadcastOwner(sessionId: string, owner: BroadcastOwner): void {
  broadcastOwnerBySession.set(sessionId, owner);
}

export function clearBroadcastOwner(sessionId: string): void {
  broadcastOwnerBySession.delete(sessionId);
}

export function getSessionLiveMode(sessionId: string): SessionLiveMode {
  return liveModeBySession.get(sessionId) ?? "none";
}

export function setSessionLiveMode(sessionId: string, mode: SessionLiveMode): void {
  liveModeBySession.set(sessionId, mode);
}

export function clearSessionLiveMode(sessionId: string): void {
  liveModeBySession.delete(sessionId);
}
