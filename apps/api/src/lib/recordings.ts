import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RECORDINGS_ROOT = path.join(process.cwd(), "recordings");
export const MAX_RECORDINGS_PER_SESSION = 10;

export function safeRecordingName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function ensureSessionRecordingsDir(sessionId: string): Promise<string> {
  const sessionDir = path.join(RECORDINGS_ROOT, safeRecordingName(sessionId));
  await fs.mkdir(sessionDir, { recursive: true });
  return sessionDir;
}

export async function ensureChannelRecordingsDir(sessionId: string, channelId: string): Promise<string> {
  const channelDir = path.join(await ensureSessionRecordingsDir(sessionId), safeRecordingName(channelId));
  await fs.mkdir(channelDir, { recursive: true });
  return channelDir;
}

export async function listSessionRecordings(sessionId: string): Promise<Array<{ channelId: string; name: string; size: number; createdAt: string }>> {
  const sessionDir = await ensureSessionRecordingsDir(sessionId);
  const entries = await fs.readdir(sessionDir, { withFileTypes: true }).catch(() => []);
  const byChannelFiles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (channelDirEntry) => {
        const channelId = channelDirEntry.name;
        const channelDirPath = path.join(sessionDir, channelId);
        const files = await fs.readdir(channelDirPath).catch(() => []);
        return Promise.all(
          files
            .filter((entry) => entry.endsWith(".mp3") || entry.endsWith(".webm"))
            .map(async (entry) => {
              const fullPath = path.join(channelDirPath, entry);
              const stat = await fs.stat(fullPath);
              return {
                channelId,
                name: entry,
                size: stat.size,
                createdAt: stat.birthtime.toISOString(),
                mtimeMs: stat.mtimeMs
              };
            })
        );
      })
  );

  const flatFiles = byChannelFiles.flat();
  flatFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return flatFiles.map(({ mtimeMs: _mtimeMs, ...rest }) => rest);
}

export async function pruneChannelRecordings(sessionId: string, channelId: string): Promise<void> {
  const channelDir = await ensureChannelRecordingsDir(sessionId, channelId);
  const entries = await fs.readdir(channelDir).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".mp3") || entry.endsWith(".webm"))
      .map(async (entry) => {
        const fullPath = path.join(channelDir, entry);
        const stat = await fs.stat(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      })
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toDelete = files.slice(MAX_RECORDINGS_PER_SESSION);
  await Promise.all(toDelete.map((file) => fs.unlink(file.fullPath).catch(() => undefined)));
}

export async function transcodeWebmToMp3(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "2",
    outputPath
  ]);
}

