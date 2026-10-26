import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const media = vi.hoisted(() => ({ socket: null as any, transport: null as any, consumer: null as any }));
vi.mock("socket.io-client", () => ({ io: () => media.socket }));
vi.mock("mediasoup-client", () => ({ Device: class {
  rtpCapabilities = {};
  async load() {}
  createRecvTransport() { return media.transport; }
} }));
vi.mock("../../lib/socketAck", () => ({
  waitForSocketConnect: vi.fn().mockResolvedValue(undefined),
  emitAck: vi.fn(async (_socket, event) => event === "listener:createTransport" ? { transportId: "transport-1" } : {})
}));

let audio: HTMLAudioElement;
let playback: typeof import("./playback");
let store: typeof import("../../stores/app");
let get: typeof import("svelte/store").get;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  media.socket = Object.assign(new EventEmitter(), { connected: true, disconnect: vi.fn() });
  media.consumer = {
    id: "consumer-1", track: Object.assign(new EventTarget(), { readyState: "live" }), close: vi.fn(),
    getStats: vi.fn().mockResolvedValue(new Map([["inbound", { type: "inbound-rtp", kind: "audio", packetsReceived: 100 }]]))
  };
  media.transport = Object.assign(new EventEmitter(), { connectionState: "connected", consume: vi.fn().mockResolvedValue(media.consumer), close: vi.fn() });
  vi.stubGlobal("MediaStream", class { constructor(readonly tracks: unknown[]) {} });
  audio = document.createElement("audio");
  audio.play = vi.fn().mockResolvedValue(undefined);
  audio.pause = vi.fn();
  const refs = await import("../refs");
  refs.setListenerAudioEl(audio);
  store = await import("../../stores/app");
  ({ get } = await import("svelte/store"));
  store.app.update((state) => ({ ...state, listenerSessionId: "session-1", listenerCode: "123456", selectedChannelId: "channel-1" }));
  playback = await import("./playback");
  await playback.startListening();
  media.socket.emit("connect");
});

afterEach(async () => {
  await playback.stopListening();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the live media on transient signaling loss and rebuilds only after reconnect", () => {
  media.socket.emit("disconnect", "transport close");
  expect(get(store.app).isListening).toBe(true);
  expect(media.consumer.close).not.toHaveBeenCalled();
  expect(audio.pause).not.toHaveBeenCalled();
  media.socket.emit("connect");
  expect(media.consumer.close).toHaveBeenCalledOnce();
});

it("does not mistake background statistics failures for failed audio", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  media.consumer.getStats.mockRejectedValue(new Error("background statistics unavailable"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(media.consumer.getStats).not.toHaveBeenCalled();
  expect(media.consumer.close).not.toHaveBeenCalled();
  expect(get(store.app).isListening).toBe(true);
});

it("still recovers from confirmed reception failures while visible", async () => {
  media.consumer.getStats.mockRejectedValue(new Error("receiver failed"));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(media.consumer.close).toHaveBeenCalledOnce();
  expect(get(store.app).isListening).toBe(false);
});

it("ignores an in-flight statistics failure when the page becomes hidden", async () => {
  media.consumer.getStats.mockRejectedValue(new Error("statistics unavailable"));
  await vi.advanceTimersByTimeAsync(10_000);
  let rejectPending!: (error: Error) => void;
  media.consumer.getStats.mockImplementation(() => new Promise((_resolve, reject) => { rejectPending = reject; }));
  await vi.advanceTimersByTimeAsync(5_000);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  rejectPending(new Error("page went to sleep"));
  await vi.advanceTimersByTimeAsync(0);
  expect(media.consumer.close).not.toHaveBeenCalled();
});

it("does not keep media after a server-initiated disconnect", () => {
  media.socket.emit("disconnect", "io server disconnect");
  expect(media.consumer.close).toHaveBeenCalledOnce();
  expect(audio.pause).toHaveBeenCalledOnce();
});
