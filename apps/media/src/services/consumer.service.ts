import type { Consumer, RtpCapabilities } from "mediasoup/node/lib/types";
import { channelKey, consumers, producersByChannel, routersBySession } from "../state/media-state";
import { getTransportOrNull } from "./transport.service";

type ConsumeInput = {
  clientId: string;
  transportId: string;
  sessionId: string;
  channelId: string;
  rtpCapabilities: RtpCapabilities;
};

type ConsumeResult =
  | { type: "transport_not_found" }
  | { type: "forbidden" }
  | { type: "router_not_found" }
  | { type: "producer_not_found" }
  | { type: "incompatible" }
  | { type: "ok"; consumer: Consumer; producerId: string };

export async function createConsumer(input: ConsumeInput): Promise<ConsumeResult> {
  const transport = getTransportOrNull(input.transportId);
  if (!transport) return { type: "transport_not_found" };
  const appData = (transport.appData as { role?: string; clientId?: string; sessionId?: string; channelId?: string } | undefined) ?? {};
  if (appData.role !== "listener") return { type: "forbidden" };
  if (!appData.clientId || appData.clientId !== input.clientId) return { type: "forbidden" };
  if (!appData.sessionId || appData.sessionId !== input.sessionId) return { type: "forbidden" };
  if (!appData.channelId || appData.channelId !== input.channelId) return { type: "forbidden" };

  const router = routersBySession.get(input.sessionId);
  if (!router) return { type: "router_not_found" };

  const producer = producersByChannel.get(channelKey(input.sessionId, input.channelId));
  if (!producer) return { type: "producer_not_found" };

  if (!router.canConsume({ producerId: producer.id, rtpCapabilities: input.rtpCapabilities })) {
    return { type: "incompatible" };
  }

  const consumer = await transport.consume({
    producerId: producer.id,
    rtpCapabilities: input.rtpCapabilities,
    paused: true,
    appData: { clientId: input.clientId, sessionId: input.sessionId, channelId: input.channelId }
  });

  consumers.set(consumer.id, consumer);
  consumer.on("@close", () => {
    consumers.delete(consumer.id);
  });
  consumer.on("transportclose", () => {
    consumers.delete(consumer.id);
  });

  return { type: "ok", consumer, producerId: producer.id };
}

export async function resumeConsumer(consumerId: string, clientId: string): Promise<"ok" | "not_found" | "forbidden"> {
  const consumer = consumers.get(consumerId);
  if (!consumer) return "not_found";
  const appData = (consumer.appData as { clientId?: string } | undefined) ?? {};
  if (!appData.clientId || appData.clientId !== clientId) return "forbidden";
  await consumer.resume();
  return "ok";
}
