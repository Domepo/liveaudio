import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import type { Channel } from "../../types/channel";
import { tr } from "../../i18n";
import { syncChannelAssignments } from "../channels";
import { setStatus } from "../logging";
import { refreshSessionStats } from "./stats";

export async function rotateSessionCode(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  try {
    const data = await fetchJson<{ broadcastCode: string }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/rotate-code`, {
      method: "POST"
    });
    app.update((s) => ({ ...s, sessionCode: data.broadcastCode }));
    setStatus("broadcaster", tr("status.channel_token_rotated"));
  } catch (error) {
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function createChannel(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  try {
    const data = await fetchJson<Channel>(`${apiUrl}/api/sessions/${state.selectedSessionId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.channelName, languageCode: state.channelLanguage || undefined })
    });
    app.update((s) => ({ ...s, channels: [...s.channels, data] }));
    syncChannelAssignments(get(app).channels);
    await refreshSessionStats();
    setStatus("broadcaster", tr("status.channel_created", { name: data.name }));
  } catch (error) {
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function deleteChannel(channelId: string): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  const confirmDelete = state.settingsConfirmDestructiveActions ? window.confirm(tr("confirm.delete_channel")) : true;
  if (!confirmDelete) return;

  try {
    await fetchJson<{ ok: boolean }>(`${apiUrl}/api/sessions/${state.selectedSessionId}/channels/${channelId}`, { method: "DELETE" });
    app.update((s) => {
      const nextAssignments = { ...s.channelInputAssignments };
      const nextLevels = { ...s.channelDbLevels };
      delete nextAssignments[channelId];
      delete nextLevels[channelId];
      return {
        ...s,
        channels: s.channels.filter((c) => c.id !== channelId),
        adminLiveChannelIds: s.adminLiveChannelIds.filter((id) => id !== channelId),
        channelInputAssignments: nextAssignments,
        channelDbLevels: nextLevels
      };
    });
    await refreshSessionStats();
    setStatus("broadcaster", tr("status.channel_deleted"));
  } catch (error) {
    setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}
