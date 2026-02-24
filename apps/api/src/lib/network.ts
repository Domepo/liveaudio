import os from "node:os";
import type { Request } from "express";

export function detectLanIp(): string {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

export function buildJoinBaseUrl(req: Request, override?: string): string {
  if (override) {
    try {
      const parsed = new URL(override);
      if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
        parsed.port = "";
      }
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return override;
    }
  }
  if (process.env.PUBLIC_JOIN_URL) return process.env.PUBLIC_JOIN_URL.replace(/\/$/, "");

  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = typeof protoHeader === "string" ? protoHeader.split(",")[0] : req.protocol || "http";
  const hostHeader = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost:3001";
  const hostToken = hostHeader.split(",")[0].trim() || "localhost";
  const [hostname] = hostToken.split(":");
  const webPort = process.env.PUBLIC_WEB_PORT ?? "5173";
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
  const usePort = isLocal ? webPort : process.env.PUBLIC_WEB_PORT;
  const hasDefaultPort = (proto === "https" && usePort === "443") || (proto === "http" && usePort === "80");
  const portPart = usePort && !hasDefaultPort ? `:${usePort}` : "";
  return `${proto}://${hostname}${portPart}`;
}

