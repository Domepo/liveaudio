import os from "node:os";
import type { RouterRtpCodecCapability } from "mediasoup/node/lib/types";

export const MEDIA_PORT = Number(process.env.MEDIA_PORT ?? 4000);
export const MEDIA_HOST = process.env.MEDIA_HOST ?? "0.0.0.0";
export const MEDIA_LISTEN_IP = process.env.MEDIA_LISTEN_IP ?? "0.0.0.0";
export const RTC_MIN_PORT = Number(process.env.RTC_MIN_PORT ?? 40000);
export const RTC_MAX_PORT = Number(process.env.RTC_MAX_PORT ?? 49999);
export const MEDIA_INTERNAL_TOKEN = process.env.MEDIA_INTERNAL_TOKEN?.trim() || "";

function detectLanIp(): string {
  const nets = os.networkInterfaces();
  const isUsableIpv4 = (ip: string): boolean => {
    if (!ip || ip.startsWith("127.")) return false;
    if (ip.startsWith("169.254.")) return false;
    return true;
  };
  const scoreIp = (ip: string): number => {
    if (ip.startsWith("192.168.")) return 30;
    if (/^10\./.test(ip)) return 20;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 10;
    return 1;
  };
  let bestIp = "";
  let bestScore = -1;
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal && isUsableIpv4(net.address)) {
        const score = scoreIp(net.address);
        if (score > bestScore) {
          bestScore = score;
          bestIp = net.address;
        }
      }
    }
  }
  return bestIp || "127.0.0.1";
}

export const MEDIA_ANNOUNCED_IP = process.env.MEDIA_ANNOUNCED_IP || detectLanIp();

export const mediaCodecs: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
      usedtx: 1
    }
  }
];

export function assertMediaSecurityConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!MEDIA_INTERNAL_TOKEN || MEDIA_INTERNAL_TOKEN.length < 24) {
    // eslint-disable-next-line no-console
    console.error("[SECURITY] MEDIA_INTERNAL_TOKEN is missing/weak. Set a random token with at least 24 chars.");
    process.exit(1);
  }
}
