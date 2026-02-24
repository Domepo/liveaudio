import type { Express } from "express";
import { connectTransport, disconnectClientTransports } from "../../services/transport.service";

type DisconnectBody = { clientId?: string };
type ConnectBody = { clientId?: string; transportId: string; dtlsParameters: unknown };

export function registerTransportRoutes(app: Express): void {
  app.post("/clients/disconnect", async (req, res) => {
    const { clientId } = req.body as DisconnectBody;
    if (!clientId || typeof clientId !== "string") {
      return res.status(400).json({ error: "clientId is required" });
    }

    const closedTransports = disconnectClientTransports(clientId);
    return res.json({ ok: true, closedTransports });
  });

  app.post("/transports/connect", async (req, res) => {
    const { clientId, transportId, dtlsParameters } = req.body as ConnectBody;
    if (!clientId || typeof clientId !== "string") {
      return res.status(400).json({ error: "clientId is required" });
    }
    const connected = await connectTransport(transportId, dtlsParameters, clientId);
    if (connected === "not_found") {
      return res.status(404).json({ error: "Transport not found" });
    }
    if (connected === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    return res.json({ ok: true });
  });
}
