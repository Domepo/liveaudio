import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import type { RateLimitRequestHandler } from "express-rate-limit";
import type { ZodSchema } from "zod";

type ValidateCodeInput = { code: string };

type JoinRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  joinLimiter: RateLimitRequestHandler;
  liveStateLimiter: RateLimitRequestHandler;
  validateCodeSchema: ZodSchema<ValidateCodeInput>;
  attempts: Map<string, { count: number; until: number }>;
  findActiveSessionByCode: (code: string) => Promise<{ id: string; name: string; description: string | null; imageUrl: string | null } | null>;
  fetchLiveChannelIds: (sessionId: string) => Promise<string[]>;
};

export function registerJoinRoutes(deps: JoinRoutesDeps): void {
  const { app, prisma, joinLimiter, liveStateLimiter, validateCodeSchema, attempts, findActiveSessionByCode, fetchLiveChannelIds } = deps;

  app.post("/api/join/validate-code", joinLimiter, async (req, res) => {
    const parsed = validateCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const ip = req.ip ?? "unknown";
    const attemptsKey = `${ip}:${parsed.data.code}`;
    const attemptState = attempts.get(attemptsKey);
    if (attemptState && attemptState.until > Date.now() && attemptState.count >= 10) {
      return res.status(429).json({ error: "Too many attempts" });
    }

    const session = await findActiveSessionByCode(parsed.data.code);
    if (!session) {
      const count = (attemptState?.count ?? 0) + 1;
      attempts.set(attemptsKey, { count, until: Date.now() + 5 * 60_000 });
      return res.status(401).json({ error: "Session invalid" });
    }

    attempts.delete(attemptsKey);
    const channels = await prisma.channel.findMany({
      where: { sessionId: session.id, isActive: true },
      orderBy: { name: "asc" }
    });
    const liveChannelIds = await fetchLiveChannelIds(session.id);

    return res.json({
      session: { id: session.id, name: session.name, description: session.description, imageUrl: session.imageUrl },
      channels,
      liveChannelIds
    });
  });

  app.post("/api/join/live-state", liveStateLimiter, async (req, res) => {
    const parsed = validateCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const session = await findActiveSessionByCode(parsed.data.code);
    if (!session) {
      return res.status(401).json({ error: "Session invalid" });
    }

    const liveChannelIds = await fetchLiveChannelIds(session.id);
    return res.json({ sessionId: session.id, liveChannelIds });
  });
}

