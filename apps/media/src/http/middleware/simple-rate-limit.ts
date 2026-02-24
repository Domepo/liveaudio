import type { NextFunction, Request, Response } from "express";

type WindowCounter = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, WindowCounter>();

export function createSimpleRateLimit(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || now >= current.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (current.count >= limit) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    current.count += 1;
    next();
  };
}
