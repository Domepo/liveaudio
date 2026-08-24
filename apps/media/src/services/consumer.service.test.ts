import { beforeEach, describe, expect, it, vi } from "vitest";

import { channelKey, consumers, producersByChannel, routersBySession } from "../state/media-state";
import { closeConsumer, createConsumer } from "./consumer.service";
import { getTransportOrNull } from "./transport.service";

vi.mock("./transport.service", () => ({
  getTransportOrNull: vi.fn()
}));

describe("consumer lifecycle", () => {
  beforeEach(() => {
    consumers.clear();
    producersByChannel.clear();
    routersBySession.clear();
    vi.clearAllMocks();
  });

  it("removes a consumer reference when its producer closes", async () => {
    const handlers = new Map<string, () => void>();
    const consumer = {
      id: "consumer-1",
      kind: "audio",
      rtpParameters: {},
      type: "simple",
      appData: { clientId: "listener-1" },
      on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
      close: vi.fn()
    };
    vi.mocked(getTransportOrNull).mockReturnValue({
      appData: { role: "listener", clientId: "listener-1", sessionId: "session-1", channelId: "channel-1" },
      consume: vi.fn().mockResolvedValue(consumer)
    } as any);
    routersBySession.set("session-1", { canConsume: vi.fn(() => true) } as any);
    producersByChannel.set(channelKey("session-1", "channel-1"), { id: "producer-1" } as any);

    const result = await createConsumer({
      clientId: "listener-1",
      transportId: "transport-1",
      sessionId: "session-1",
      channelId: "channel-1",
      rtpCapabilities: {} as any
    });

    expect(result.type).toBe("ok");
    expect(consumers.has("consumer-1")).toBe(true);
    handlers.get("producerclose")?.();
    expect(consumers.has("consumer-1")).toBe(false);
  });

  it("only lets the owning listener close a consumer", () => {
    const consumer = {
      id: "consumer-1",
      appData: { clientId: "listener-1" },
      close: vi.fn()
    };
    consumers.set("consumer-1", consumer as any);

    expect(closeConsumer("consumer-1", "listener-2")).toBe("forbidden");
    expect(closeConsumer("consumer-1", "listener-1")).toBe("ok");
    expect(consumer.close).toHaveBeenCalledOnce();
    expect(consumers.has("consumer-1")).toBe(false);
  });
});
