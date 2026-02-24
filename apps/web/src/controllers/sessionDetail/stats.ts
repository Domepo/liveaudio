import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import type { SessionStats } from "../../types/stats";

export async function refreshSessionStats(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  try {
    const [data, owner] = await Promise.all([
      fetchJson<SessionStats & { liveChannelIds: string[] }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/stats`),
      fetchJson<{ occupied: boolean; occupiedByOther?: boolean; ownerName?: string; startedAt?: string }>(
        `${apiUrl}/api/admin/sessions/${state.selectedSessionId}/broadcast-owner`
      )
    ]);
    app.update((s) => ({
      ...s,
      sessionStats: data,
      adminLiveChannelIds: data.liveChannelIds ?? [],
      broadcastOccupiedByOther: Boolean(owner.occupied && owner.occupiedByOther),
      broadcastOwnerName: owner.ownerName ?? "",
      broadcastOwnerStartedAt: owner.startedAt ?? ""
    }));
  } catch {
    // Ignore background refresh errors
  }
}
