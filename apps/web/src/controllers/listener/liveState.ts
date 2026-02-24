import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { HttpError } from "../../lib/errors";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";

export async function refreshListenerLiveState(): Promise<void> {
  const state = get(app);
  if (!state.listenerCode.trim()) return;
  try {
    const data = await fetchJson<{ sessionId: string; liveChannelIds: string[] }>(`${apiUrl}/api/join/live-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: state.listenerCode.trim() })
    });
    if (data.sessionId === get(app).listenerSessionId) {
      app.update((s) => ({ ...s, listenerLiveChannelIds: data.liveChannelIds }));
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) {
      app.update((s) => ({ ...s, listenerLiveStateBackoffUntilMs: Date.now() + 30_000 }));
    }
  }
}

