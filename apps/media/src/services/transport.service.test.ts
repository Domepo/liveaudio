import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumers, transports } from "../state/media-state";
import { disconnectClientTransports } from "./transport.service";

function transport(id = "transport-1", role = "listener") {
  const events = new EventEmitter();
  const observer = new EventEmitter();
  const value = Object.assign(events, {
    id, observer, closed: false, iceState: "completed", dtlsState: "connected",
    appData: { role, clientId: "client-1" },
    close: vi.fn(() => {
      value.closed = true;
      transports.delete(id);
      events.emit("@close");
      observer.emit("close");
    })
  });
  transports.set(id, value as any);
  const consumer = { appData: { clientId: "client-1", transportId: id }, observer: new EventEmitter() };
  consumers.set(`consumer-${id}`, consumer as any);
  return { value, consumer };
}

describe("listener signaling disconnect", () => {
  beforeEach(() => { vi.useFakeTimers(); transports.clear(); consumers.clear(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("keeps a connected listener receiving after transient signaling loss", async () => {
    const { value } = transport();
    expect(disconnectClientTransports("client-1", true)).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(value.close).not.toHaveBeenCalled();
  });

  it("closes on explicit stop even when the media is connected", () => {
    const { value } = transport();
    expect(disconnectClientTransports("client-1")).toBe(1);
    expect(value.close).toHaveBeenCalledOnce();
  });

  it("does not retain senders or unfinished listener connections", () => {
    const sender = transport("sender", "broadcaster").value;
    const unfinished = transport("unfinished").value;
    unfinished.dtlsState = "connecting";
    expect(disconnectClientTransports("client-1", true)).toBe(2);
    expect(sender.close).toHaveBeenCalledOnce();
    expect(unfinished.close).toHaveBeenCalledOnce();
  });

  it("closes an abandoned listener after ICE consent expires", async () => {
    const { value } = transport();
    disconnectClientTransports("client-1", true);
    value.iceState = "disconnected";
    value.emit("icestatechange", "disconnected");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(value.close).toHaveBeenCalledOnce();
  });

  it("keeps media when ICE recovers within the grace period", async () => {
    const { value } = transport();
    disconnectClientTransports("client-1", true);
    value.iceState = "disconnected";
    value.emit("icestatechange", "disconnected");
    await vi.advanceTimersByTimeAsync(5_000);
    value.iceState = "completed";
    value.emit("icestatechange", "completed");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(value.close).not.toHaveBeenCalled();
  });

  it("closes retained media when its producer/consumer ends", () => {
    const { value, consumer } = transport();
    disconnectClientTransports("client-1", true);
    consumer.observer.emit("close");
    expect(value.close).toHaveBeenCalledOnce();
  });

  it("cannot disconnect another listener's transport", () => {
    const { value } = transport();
    expect(disconnectClientTransports("client-2", true)).toBe(0);
    expect(value.close).not.toHaveBeenCalled();
  });
});
