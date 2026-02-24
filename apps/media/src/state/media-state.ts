import type { Consumer, Producer, Router, WebRtcTransport } from "mediasoup/node/lib/types";

export const routersBySession = new Map<string, Router>();
export const transports = new Map<string, WebRtcTransport>();
export const producersByChannel = new Map<string, Producer>();
export const consumers = new Map<string, Consumer>();

export function channelKey(sessionId: string, channelId: string): string {
  return `${sessionId}:${channelId}`;
}

export function activeProducerChannelsForSession(sessionId: string): number {
  let count = 0;
  for (const [key, producer] of producersByChannel.entries()) {
    if (producer.closed) {
      producersByChannel.delete(key);
      continue;
    }
    if (key.startsWith(`${sessionId}:`)) count += 1;
  }
  return count;
}

export function activeChannelIdsForSession(sessionId: string): string[] {
  const ids: string[] = [];
  for (const [key, producer] of producersByChannel.entries()) {
    if (producer.closed) {
      producersByChannel.delete(key);
      continue;
    }
    if (!key.startsWith(`${sessionId}:`)) continue;
    const [, channelId] = key.split(":");
    if (channelId) ids.push(channelId);
  }
  return ids;
}

