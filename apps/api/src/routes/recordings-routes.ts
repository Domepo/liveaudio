import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Role } from "@prisma/client";
import type { Express, Request, Response } from "express";
import type { ZodSchema } from "zod";

type RecordingsRoutesDeps = {
  app: Express;
  prisma: PrismaClient;
  requireAuthenticated: (req: Request, res: Response, next: (err?: any) => void) => void;
  requireRoles: (allowed: Role[]) => (req: Request, res: Response, next: (err?: any) => void) => void;
  ensureSessionAccessOr404: (req: Request, res: Response, sessionId: string) => Promise<boolean>;
  createRecordingSchema: ZodSchema<{ channelId: string; dataUrl: string }>;
  listSessionRecordings: (sessionId: string) => Promise<Array<{ channelId: string; name: string; size: number; createdAt: string }>>;
  ensureChannelRecordingsDir: (sessionId: string, channelId: string) => Promise<string>;
  transcodeWebmToMp3: (inputPath: string, outputPath: string) => Promise<void>;
  pruneChannelRecordings: (sessionId: string, channelId: string) => Promise<void>;
  safeRecordingName: (value: string) => string;
  RECORDINGS_ROOT: string;
};

export function registerRecordingRoutes(deps: RecordingsRoutesDeps): void {
  const {
    app,
    prisma,
    requireAuthenticated,
    requireRoles,
    ensureSessionAccessOr404,
    createRecordingSchema,
    listSessionRecordings,
    ensureChannelRecordingsDir,
    transcodeWebmToMp3,
    pruneChannelRecordings,
    safeRecordingName,
    RECORDINGS_ROOT
  } = deps;

  app.get("/api/admin/sessions/:sessionId/recordings", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json(await listSessionRecordings(sessionId));
  });

  app.post("/api/admin/sessions/:sessionId/recordings", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const parsed = createRecordingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

    const channel = await prisma.channel.findUnique({ where: { id: parsed.data.channelId }, select: { id: true, sessionId: true } });
    if (!channel || channel.sessionId !== sessionId) return res.status(404).json({ error: "Channel not found" });

    const matched = parsed.data.dataUrl.match(/^data:audio\/[\w.+-]+;base64,(.+)$/);
    if (!matched) return res.status(400).json({ error: "Invalid audio payload" });
    const binary = Buffer.from(matched[1], "base64");
    if (binary.length === 0) return res.status(400).json({ error: "Empty recording" });

    const channelDir = await ensureChannelRecordingsDir(sessionId, parsed.data.channelId);
    const baseName = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const webmPath = path.join(channelDir, `${baseName}.webm`);
    const mp3Path = path.join(channelDir, `${baseName}.mp3`);
    await fs.writeFile(webmPath, binary);

    let finalPath = mp3Path;
    let finalName = `${baseName}.mp3`;
    try {
      await transcodeWebmToMp3(webmPath, mp3Path);
      await fs.unlink(webmPath).catch(() => undefined);
    } catch (error) {
      finalPath = webmPath;
      finalName = `${baseName}.webm`;
      console.warn("Recording conversion failed, keeping webm file", error);
    }

    await pruneChannelRecordings(sessionId, parsed.data.channelId);
    const stat = await fs.stat(finalPath);
    return res.status(201).json({ channelId: parsed.data.channelId, name: finalName, size: stat.size, createdAt: stat.birthtime.toISOString() });
  });

  app.get("/api/admin/sessions/:sessionId/recordings/:channelId/:fileName", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER", "VIEWER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const channelId = safeRecordingName(String(req.params.channelId));
    const fileName = safeRecordingName(String(req.params.fileName));
    if (!fileName.endsWith(".mp3") && !fileName.endsWith(".webm")) return res.status(400).json({ error: "Invalid file" });
    const fullPath = path.join(RECORDINGS_ROOT, safeRecordingName(sessionId), channelId, fileName);
    try {
      await fs.access(fullPath);
      res.setHeader("Content-Type", fileName.endsWith(".mp3") ? "audio/mpeg" : "audio/webm");
      return res.sendFile(fullPath);
    } catch {
      return res.status(404).json({ error: "Recording not found" });
    }
  });

  app.delete("/api/admin/sessions/:sessionId/recordings/:channelId/:fileName", requireAuthenticated, requireRoles(["ADMIN", "BROADCASTER"]), async (req, res) => {
    const sessionId = String(req.params.sessionId);
    if (!(await ensureSessionAccessOr404(req, res, sessionId))) return;
    const channelId = safeRecordingName(String(req.params.channelId));
    const fileName = safeRecordingName(String(req.params.fileName));
    if (!fileName.endsWith(".mp3") && !fileName.endsWith(".webm")) return res.status(400).json({ error: "Invalid file" });
    const fullPath = path.join(RECORDINGS_ROOT, safeRecordingName(sessionId), channelId, fileName);
    try {
      await fs.unlink(fullPath);
      return res.json({ ok: true });
    } catch {
      return res.status(404).json({ error: "Recording not found" });
    }
  });
}

