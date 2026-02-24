import type { Express } from "express";
import { resumeConsumer } from "../../services/consumer.service";

type ResumeBody = { consumerId: string };

export function registerConsumerRoutes(app: Express): void {
  app.post("/consumers/resume", async (req, res) => {
    const body = req.body as ResumeBody & { clientId?: string };
    if (!body.clientId || typeof body.clientId !== "string") {
      return res.status(400).json({ error: "clientId is required" });
    }
    const resumed = await resumeConsumer(body.consumerId, body.clientId);
    if (resumed === "not_found") {
      return res.status(404).json({ error: "Consumer not found" });
    }
    if (resumed === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({ ok: true });
  });
}
