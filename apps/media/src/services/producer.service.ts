import type { Producer } from "mediasoup/node/lib/types";
import { channelKey, producersByChannel } from "../state/media-state";
import { getTransportOrNull } from "./transport.service";

type ProduceInput = {
  clientId: string;
  transportId: string;
  sessionId: string;
  channelId: string;
  kind: "audio";
  rtpParameters: unknown;
};

type ProduceResult = { type: "ok"; producer: Producer } | { type: "transport_not_found" } | { type: "forbidden" };

export async function createProducer(input: ProduceInput): Promise<ProduceResult> {
  const transport = getTransportOrNull(input.transportId);
  if (!transport) return { type: "transport_not_found" };
  const appData = (transport.appData as { role?: string; clientId?: string; sessionId?: string; channelId?: string } | undefined) ?? {};
  if (appData.role !== "broadcaster") return { type: "forbidden" };
  if (!appData.clientId || appData.clientId !== input.clientId) return { type: "forbidden" };
  if (!appData.sessionId || appData.sessionId !== input.sessionId) return { type: "forbidden" };
  if (!appData.channelId || appData.channelId !== input.channelId) return { type: "forbidden" };

  const producer = await transport.produce({ kind: input.kind, rtpParameters: input.rtpParameters as any });
  const key = channelKey(input.sessionId, input.channelId);

  const oldProducer = producersByChannel.get(key);
  if (oldProducer) {
    oldProducer.close();
  }

  producersByChannel.set(key, producer);
  const clearProducerRef = () => {
    const current = producersByChannel.get(key);
    if (current?.id === producer.id) {
      producersByChannel.delete(key);
    }
  };
  producer.on("@close", clearProducerRef);
  producer.on("transportclose", clearProducerRef);

  return { type: "ok", producer };
}
