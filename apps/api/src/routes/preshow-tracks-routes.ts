import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Role } from "@prisma/client";
import type { Express, Request, Response } from "express";
import type { ZodSchema } from "zod";

const MAX_PRESHOW_TRACK_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_PRESHOW_TRACKS = 10;

type PreShowTracksRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  createPreShowTrackSchema: ZodSchema<{ name: string; dataUrl: string }>;
  safeRecordingName: (value: string) => string;
  RECORDINGS_ROOT: string;
};

function contentTypeToExtension(contentType: string): string {
  const normalized = contentType.toLowerCase();
  const map: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac"
  };
  return map[normalized] ?? ".bin";
}

function isAllowedTrackFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return [".mp3", ".wav", ".ogg", ".webm", ".m4a", ".aac", ".flac"].includes(ext);
}

async function ensureSessionPreShowDir(RECORDINGS_ROOT: string, safeRecordingName: (value: string) => string, sessionId: string): Promise<string> {
  const sessionDir = path.join(RECORDINGS_ROOT, safeRecordingName(sessionId), "_preshow");
  await fs.mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

export function registerPreShowTracksRoutes(deps: PreShowTracksRoutesDeps): void {
  const { app, prisma, requireAuthenticated, requireRoles, ensureSessionAccessOr404, createPreShowTrackSchema, safeRecordingName, RECORDINGS_ROOT } = deps;

  app.get("/api/admin/sessions/:sessionId/preshow-tracks", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const dir = await ensureSessionPreShowDir(RECORDINGS_ROOT, safeRecordingName, sessionId);
    const entries = await fs.readdir(dir).catch(() => []);
    const tracks = await Promise.all(
      entries
        .filter((entry) => isAllowedTrackFile(entry))
        .map(async (entry) => {
          const stat = await fs.stat(path.join(dir, entry));
          const separatorIndex = entry.indexOf("__");
          const displayName = separatorIndex >= 0 ? entry.slice(separatorIndex + 2) : entry;
          return {
            id: entry,
            name: displayName,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
            mtimeMs: stat.mtimeMs
          };
        })
    );

    tracks.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return res.json(
      tracks.map(({ mtimeMs: _mtimeMs, ...track }) => ({
        ...track,
        url: `/api/admin/sessions/${encodeURIComponent(sessionId)}/preshow-tracks/${encodeURIComponent(track.id)}`
      }))
    );
  });

  app.post("/api/admin/sessions/:sessionId/preshow-tracks", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const parsed = createPreShowTrackSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

    const matched = parsed.data.dataUrl.match(/^data:(audio\/[\w.+-]+);base64,(.+)$/);
    if (!matched) return res.status(400).json({ error: "Invalid audio payload" });
    const contentType = matched[1];
    const binary = Buffer.from(matched[2], "base64");
    if (binary.length === 0) return res.status(400).json({ error: "Empty track" });
    if (binary.length > MAX_PRESHOW_TRACK_SIZE_BYTES) return res.status(413).json({ error: "Track too large" });

    const extension = contentTypeToExtension(contentType);
    if (extension === ".bin") return res.status(400).json({ error: "Unsupported audio format" });

    const dir = await ensureSessionPreShowDir(RECORDINGS_ROOT, safeRecordingName, sessionId);
    const existingTrackEntries = (await fs.readdir(dir).catch(() => [])).filter((entry) => isAllowedTrackFile(entry));
    if (existingTrackEntries.length >= MAX_PRESHOW_TRACKS) {
      return res.status(409).json({ error: `Track limit reached (${MAX_PRESHOW_TRACKS})` });
    }
    const originalSafeName = safeRecordingName(parsed.data.name);
    const fileName = `${randomUUID().slice(0, 8)}__${originalSafeName}${extension}`;
    const fullPath = path.join(dir, fileName);
    await fs.writeFile(fullPath, binary);
    const stat = await fs.stat(fullPath);

    return res.status(201).json({
      id: fileName,
      name: `${originalSafeName}${extension}`,
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      url: `/api/admin/sessions/${encodeURIComponent(sessionId)}/preshow-tracks/${encodeURIComponent(fileName)}`
    });
  });

  app.get("/api/admin/sessions/:sessionId/preshow-tracks/:trackId", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const trackId = safeRecordingName(String(req.params.trackId));
    if (!isAllowedTrackFile(trackId)) return res.status(400).json({ error: "Invalid file" });

    const fullPath = path.join(RECORDINGS_ROOT, safeRecordingName(sessionId), "_preshow", trackId);
    try {
      await fs.access(fullPath);
      const ext = path.extname(trackId).toLowerCase();
      const mimeByExt: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".flac": "audio/flac"
      };
      res.setHeader("Content-Type", mimeByExt[ext] ?? "application/octet-stream");
      return res.sendFile(fullPath);
    } catch {
      return res.status(404).json({ error: "Track not found" });
    }
  });

  app.delete("/api/admin/sessions/:sessionId/preshow-tracks/:trackId", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const trackId = safeRecordingName(String(req.params.trackId));
    if (!isAllowedTrackFile(trackId)) return res.status(400).json({ error: "Invalid file" });

    const fullPath = path.join(RECORDINGS_ROOT, safeRecordingName(sessionId), "_preshow", trackId);
    try {
      await fs.unlink(fullPath);
      return res.json({ ok: true });
    } catch {
      return res.status(404).json({ error: "Track not found" });
    }
  });
}
