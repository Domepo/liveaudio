import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import { tr } from "../../i18n";
import { setStatus } from "../logging";
import { goToAdminSession } from "../routing";
import { loadAdminSessions } from "../admin/sessions";
import { autoSaveSessionTimer, clearTimer, setAutoSaveSessionTimer } from "../runtime";

export async function createAdminSession(): Promise<void> {
  const state = get(app);
  try {
    const data = await fetchJson<{ id: string; name: string; broadcastCode: string }>(`${apiUrl}/api/admin/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.createSessionName,
        description: state.createSessionDescription || undefined,
        imageUrl: state.createSessionImageUrl || undefined
      })
    });

    app.update((s) => ({
      ...s,
      sessionCode: data.broadcastCode,
      createSessionName: "",
      createSessionDescription: "",
      createSessionImageUrl: ""
    }));
    await loadAdminSessions();
    goToAdminSession(data.id);
    setStatus("broadcaster", tr("status.session_created"));
  } catch (error) {
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function saveSessionMeta(silent = false): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  const normalizedSessionCode = state.sessionCode.trim();
  const sessionCodeChanged = normalizedSessionCode !== state.lastSavedSessionMeta.broadcastCode;
  if (
    state.sessionName === state.lastSavedSessionMeta.name &&
    state.sessionDescription === state.lastSavedSessionMeta.description &&
    state.sessionImageUrl === state.lastSavedSessionMeta.imageUrl &&
    !sessionCodeChanged
  ) {
    return;
  }
  if (sessionCodeChanged && !/^\d{6}$/.test(normalizedSessionCode)) {
    if (!silent) setStatus("broadcaster", tr("status.qr_set_token"));
    return;
  }
  try {
    await fetchJson(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.sessionName,
        description: state.sessionDescription,
        imageUrl: state.sessionImageUrl || undefined,
        ...(sessionCodeChanged ? { broadcastCode: normalizedSessionCode } : {})
      })
    });
    app.update((s) => ({
      ...s,
      lastSavedSessionMeta: { name: s.sessionName, description: s.sessionDescription, imageUrl: s.sessionImageUrl, broadcastCode: normalizedSessionCode }
    }));
    await loadAdminSessions();
    if (!silent) {
      setStatus("broadcaster", tr("status.session_saved"));
    }
  } catch (error) {
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export function scheduleAutoSaveSessionMeta(): void {
  const state = get(app);
  if (!state.selectedSessionId || state.isHydratingSessionMeta) return;
  if (autoSaveSessionTimer) {
    clearTimer(autoSaveSessionTimer);
  }
  setAutoSaveSessionTimer(
    setTimeout(() => {
      void saveSessionMeta(true);
    }, 550)
  );
}
