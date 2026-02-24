import type { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { MEDIA_ANNOUNCED_IP, MEDIA_LISTEN_IP } from "../config/media";
import { transports } from "../state/media-state";

export async function createWebRtcTransport(router: Router): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: "udp",
        ip: MEDIA_LISTEN_IP,
        announcedAddress: MEDIA_ANNOUNCED_IP
      },
      {
        protocol: "tcp",
        ip: MEDIA_LISTEN_IP,
        announcedAddress: MEDIA_ANNOUNCED_IP
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 300000,
    appData: {}
  } as any);

  transport.on("dtlsstatechange", (state) => {
    if (state === "closed") {
      transport.close();
      transports.delete(transport.id);
    }
  });

  transport.on("@close", () => {
    transports.delete(transport.id);
  });

  transports.set(transport.id, transport);
  return transport;
}

export function getTransportOrNull(transportId: string): WebRtcTransport | null {
  return transports.get(transportId) ?? null;
}

export async function connectTransport(transportId: string, dtlsParameters: unknown, clientId: string): Promise<"ok" | "not_found" | "forbidden"> {
  const transport = getTransportOrNull(transportId);
  if (!transport) return "not_found";
  const appData = (transport.appData as { clientId?: string } | undefined) ?? {};
  if (!appData.clientId || appData.clientId !== clientId) return "forbidden";
  await transport.connect({ dtlsParameters: dtlsParameters as any });
  return "ok";
}

export function disconnectClientTransports(clientId: string): number {
  const toClose: WebRtcTransport[] = [];
  for (const transport of transports.values()) {
    const transportClientId = (transport.appData as { clientId?: string } | undefined)?.clientId;
    if (transportClientId === clientId) {
      toClose.push(transport);
    }
  }

  for (const transport of toClose) {
    try {
      transport.close();
    } catch {
      // ignore cleanup failures
    }
  }

  return toClose.length;
}
