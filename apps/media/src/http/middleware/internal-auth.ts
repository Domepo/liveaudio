import type { NextFunction, Request, Response } from "express";
import { MEDIA_INTERNAL_TOKEN } from "../../config/media";

function unauthorized(res: Response): void {
  res.status(401).json({ error: "Unauthorized" });
}

export function requireInternalApiToken(req: Request, res: Response, next: NextFunction): void {
  // In development, allow running without token to avoid local env drift between workspaces.
  if (process.env.NODE_ENV !== "production" && !MEDIA_INTERNAL_TOKEN) return next();
  const authHeader = req.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return unauthorized(res);
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token !== MEDIA_INTERNAL_TOKEN) return unauthorized(res);
  next();
}
