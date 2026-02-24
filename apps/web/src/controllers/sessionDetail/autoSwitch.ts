import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";

export async function savePreShowAutoSwitchSettings(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  await fetchJson<{ ok: boolean; enabled: boolean; time: string }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/preshow-auto-switch`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: state.preShowAutoSwitchEnabled,
      time: state.preShowAutoSwitchTime
    })
  });
}
