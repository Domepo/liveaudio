import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import { tr } from "../../i18n";
import type { AdminSessionSummary } from "../../types/admin-session";
import { setStatus } from "../logging";
import { goToAdminList } from "../routing";

export async function loadAdminSessions(): Promise<void> {
  const sessions = await fetchJson<AdminSessionSummary[]>(`${apiUrl}/api/admin/sessions`);

  app.update((s) => ({ ...s, adminSessions: sessions }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const state = get(app);
  const confirmDelete = state.settingsConfirmDestructiveActions
    ? window.confirm(tr("confirm.delete_session"))
    : true;
  if (!confirmDelete) return;
  try {
    await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/sessions/${sessionId}`, { method: "DELETE" });
    if (get(app).selectedSessionId === sessionId) {
      goToAdminList();
    }
    await loadAdminSessions();
    setStatus("broadcaster", tr("status.session_deleted"));
  } catch (error) {
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}
