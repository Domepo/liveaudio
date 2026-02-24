import { get } from "svelte/store";

import { apiUrl } from "../lib/config";
import { fetchJson } from "../lib/http";
import { app } from "../stores/app";
import { tr } from "../i18n";
import type { ActiveChannelRecorder, SessionRecording } from "../types/recording";
import { broadcasterChannelStreams } from "./runtime";
import { setRecordingStatus } from "./logging";

let activeChannelRecorders: ActiveChannelRecorder[] = [];

export async function loadSessionRecordings(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) {
    app.update((s) => ({ ...s, sessionRecordings: [] }));
    return;
  }
  try {
    const recordings = await fetchJson<SessionRecording[]>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/recordings`);
    app.update((s) => ({ ...s, sessionRecordings: recordings }));
  } catch {
    app.update((s) => ({ ...s, sessionRecordings: [] }));
  }
}

async function uploadRecordingBlob(channelId: string, blob: Blob): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read recording"));
    reader.readAsDataURL(blob);
  });
  await fetchJson(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/recordings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId, dataUrl })
  });
}

export async function startRecording(): Promise<void> {
  const state = get(app);
  if (state.isRecording || !state.isBroadcasting || broadcasterChannelStreams.length === 0) return;
  if (!window.MediaRecorder) {
    setRecordingStatus(tr("status.recording_unsupported"));
    return;
  }
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const recorders: ActiveChannelRecorder[] = broadcasterChannelStreams.map((channelStream) => {
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const recorder = new MediaRecorder(channelStream.stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 0) {
          await uploadRecordingBlob(channelStream.channelId, blob);
        }
      } catch (error) {
        setRecordingStatus(tr("status.recording_error_channel", { channel: channelStream.channelName, message: (error as Error).message }));
      } finally {
        resolveDone();
      }
    };
    recorder.start(1000);
    return { channelId: channelStream.channelId, channelName: channelStream.channelName, recorder, chunks, done, resolveDone };
  });

  activeChannelRecorders = recorders;
  app.update((s) => ({ ...s, isRecording: true }));
  setRecordingStatus(tr("status.recording_running", { count: recorders.length }));
}

export async function stopRecording(): Promise<void> {
  if (!get(app).isRecording) return;
  app.update((s) => ({ ...s, isRecording: false }));
  const recorders = [...activeChannelRecorders];
  for (const recorderState of recorders) {
    if (recorderState.recorder.state !== "inactive") {
      recorderState.recorder.stop();
    }
  }
  await Promise.all(recorders.map((recorderState) => recorderState.done));
  activeChannelRecorders = [];
  await loadSessionRecordings();
  const status = get(app).recordingStatus.toLowerCase();
  if (!status.startsWith("fehler") && !status.startsWith("error")) {
    setRecordingStatus(tr("status.recording_saved"));
  }
}

export async function deleteRecording(recording: SessionRecording): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  const ok = state.settingsConfirmDestructiveActions ? window.confirm(tr("confirm.delete_recording")) : true;
  if (!ok) return;
  try {
    await fetchJson<{ ok: boolean }>(
      `${apiUrl}/api/admin/sessions/${state.selectedSessionId}/recordings/${encodeURIComponent(recording.channelId)}/${encodeURIComponent(recording.name)}`,
      { method: "DELETE" }
    );
    await loadSessionRecordings();
  } catch (error) {
    setRecordingStatus(tr("status.recording_delete_error", { message: (error as Error).message }));
  }
}
