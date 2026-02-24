import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import type { Channel } from "../../types/channel";
import type { SessionStats } from "../../types/stats";
import { syncChannelAssignments } from "../channels";
import { loadSessionAssignableUsers } from "../admin/users";
import { generateJoin } from "./qr";
import { loadSessionRecordings } from "../recording";
import { loadPreShowTracks } from "./preshow";

export async function loadSelectedSession(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;

  const data = await fetchJson<{
    session: {
      id: string;
      name: string;
      description?: string | null;
      imageUrl?: string | null;
      broadcastCode?: string | null;
      preShowAutoSwitchEnabled?: boolean;
      preShowAutoSwitchTime?: string | null;
    };
    channels: Channel[];
    stats: SessionStats;
    liveChannelIds: string[];
  }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}`);
  const owner = await fetchJson<{ occupied: boolean; occupiedByOther?: boolean; ownerName?: string; startedAt?: string }>(
    `${apiUrl}/api/admin/sessions/${state.selectedSessionId}/broadcast-owner`
  );

  app.update((s) => ({
    ...s,
    isHydratingSessionMeta: true,
    sessionName: data.session.name,
    sessionDescription: data.session.description ?? "",
    sessionImageUrl: data.session.imageUrl ?? "",
    sessionCode: data.session.broadcastCode ?? "",
    lastSavedSessionMeta: {
      name: data.session.name,
      description: data.session.description ?? "",
      imageUrl: data.session.imageUrl ?? ""
    },
    channels: data.channels,
    adminLiveChannelIds: data.liveChannelIds ?? [],
    sessionStats: data.stats,
    broadcastOccupiedByOther: Boolean(owner.occupied && owner.occupiedByOther),
    broadcastOwnerName: owner.ownerName ?? "",
    broadcastOwnerStartedAt: owner.startedAt ?? "",
    joinUrl: "",
    joinQrDataUrl: "",
    channelDbLevels: {},
    preShowAutoSwitchEnabled: Boolean(data.session.preShowAutoSwitchEnabled),
    preShowAutoSwitchTime: data.session.preShowAutoSwitchTime?.trim() || "10:00"
  }));

  syncChannelAssignments(data.channels);

  app.update((s) => ({ ...s, isHydratingSessionMeta: false }));
  await loadSessionRecordings();
  await loadPreShowTracks();
  await loadSessionAssignableUsers();
  await generateJoin(true);
}
