import type { PrismaClient } from "@prisma/client";

export async function recordAnalyticsPoint(
  prisma: PrismaClient,
  input: { sessionId: string; metric: string; value: number; channelId?: string; ts?: Date }
): Promise<void> {
  await prisma.analyticsPoint
    .create({
      data: {
        sessionId: input.sessionId,
        channelId: input.channelId,
        metric: input.metric,
        value: input.value,
        ts: input.ts ?? new Date()
      }
    })
    .catch(() => undefined);
}

export async function recordAnalyticsPoints(
  prisma: PrismaClient,
  points: Array<{ sessionId: string; metric: string; value: number; channelId?: string; ts?: Date }>
): Promise<void> {
  if (points.length === 0) return;
  await prisma.analyticsPoint
    .createMany({
      data: points.map((point) => ({
        sessionId: point.sessionId,
        channelId: point.channelId,
        metric: point.metric,
        value: point.value,
        ts: point.ts ?? new Date()
      }))
    })
    .catch(() => undefined);
}

export function parseAnalyticsWindow(input: { from?: string; to?: string }): { from: Date; to: Date } {
  const now = new Date();
  const parsedTo = input.to ? new Date(input.to) : now;
  const parsedFrom = input.from ? new Date(input.from) : new Date(parsedTo.getTime() - 24 * 60 * 60 * 1000);
  const to = Number.isNaN(parsedTo.getTime()) ? now : parsedTo;
  const from = Number.isNaN(parsedFrom.getTime()) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : parsedFrom;
  if (from.getTime() > to.getTime()) return { from: to, to: from };
  return { from, to };
}

export async function cleanupAnalyticsRawData(prisma: PrismaClient, retentionDays: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await prisma.analyticsPoint.deleteMany({ where: { ts: { lt: cutoff } } }).catch(() => undefined);
}

export async function bootstrapTimescaleIfAvailable(prisma: PrismaClient): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.startsWith("postgres")) return;
  try {
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);
    await prisma.$executeRawUnsafe(`SELECT create_hypertable('\"AnalyticsPoint\"', 'ts', if_not_exists => TRUE);`);
  } catch {
    // optional extension
  }
}

