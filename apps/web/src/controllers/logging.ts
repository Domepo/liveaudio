import { app } from "../stores/app";

export function debugLog(scope: string, message: string, isError = false): void {
  if (!message.trim()) return;
  const text = `[${scope}] ${message}`;
  if (isError) console.error(text);
  else console.log(text);
}

export function setAdminStatus(message: string): void {
  app.update((s) => ({ ...s, adminStatus: message }));
  const normalized = message.toLowerCase();
  debugLog("admin", message, normalized.startsWith("fehler") || normalized.startsWith("error"));
}

export function setRecordingStatus(message: string): void {
  app.update((s) => ({ ...s, recordingStatus: message }));
  const normalized = message.toLowerCase();
  debugLog("recording", message, normalized.startsWith("fehler") || normalized.startsWith("error"));
}

export function setSettingsStatus(message: string): void {
  app.update((s) => ({ ...s, settingsStatus: message }));
  const normalized = message.toLowerCase();
  debugLog("settings", message, normalized.startsWith("fehler") || normalized.startsWith("error"));
}

export function setStatus(type: "broadcaster" | "listener", message: string): void {
  app.update((s) => (type === "broadcaster" ? { ...s, broadcasterStatus: message } : { ...s, listenerStatus: message }));
  const normalized = message.toLowerCase();
  debugLog(type, message, normalized.startsWith("fehler") || normalized.startsWith("error"));
}
