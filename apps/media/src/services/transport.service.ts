import type { Router, WebRtcTransport } from "mediasoup/node/lib/types";
import { MEDIA_ANNOUNCED_IP, MEDIA_LISTEN_IP } from "../config/media";
import { consumers, transports } from "../state/media-state";
import { hasConnectedMedia, retainConnectedListener } from "./detached-listener";

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
    iceConsentTimeout: 30,
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

export function closeTransport(transportId: string, clientId: string): "ok" | "not_found" | "forbidden" {
  const transport = getTransportOrNull(transportId);
  if (!transport) return "not_found";
  const appData = (transport.appData as { clientId?: string } | undefined) ?? {};
  if (!appData.clientId || appData.clientId !== clientId) return "forbidden";
  transport.close();
  transports.delete(transportId);
  return "ok";
}

export function disconnectClientTransports(clientId: string, preserveConnectedListeners = false): number {
  const toClose: WebRtcTransport[] = [];
  for (const transport of transports.values()) {
    const transportClientId = (transport.appData as { clientId?: string } | undefined)?.clientId;
    if (transportClientId === clientId) {
      if (preserveConnectedListeners && transport.appData.role === "listener" && hasConnectedMedia(transport)) {
        const consumer = [...consumers.values()].find((item) => !item.closed && item.appData.transportId === transport.id);
        if (consumer) {
          retainConnectedListener(transport, consumer);
          continue;
        }
      }
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
