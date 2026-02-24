import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fileToDataUrl } from "../../lib/files";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import type { PreShowTrack } from "../../stores/app";

type ApiPreShowTrack = {
  id: string;
  name: string;
  url: string;
};

function toAbsoluteTrackUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${apiUrl}${url.startsWith("/") ? url : `/${url}`}`;
}

export async function loadPreShowTracks(): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) {
    app.update((s) => ({ ...s, preShowTracks: [], selectedPreShowTrackId: "" }));
    return;
  }
  try {
    const tracks = await fetchJson<ApiPreShowTrack[]>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/preshow-tracks`);
    app.update((s) => {
      const mapped: PreShowTrack[] = tracks.map((track) => ({ ...track, url: toAbsoluteTrackUrl(track.url) }));
      const selectedExists = mapped.some((track) => track.id === s.selectedPreShowTrackId);
      return {
        ...s,
        preShowTracks: mapped,
        selectedPreShowTrackId: selectedExists ? s.selectedPreShowTrackId : mapped[0]?.id ?? ""
      };
    });
  } catch {
    app.update((s) => ({ ...s, preShowTracks: [], selectedPreShowTrackId: "" }));
  }
}

export async function uploadPreShowTrack(file: File): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  const dataUrl = await fileToDataUrl(file);
  await fetchJson<ApiPreShowTrack>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/preshow-tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, dataUrl })
  });
  await loadPreShowTracks();
}

export async function deletePreShowTrack(trackId: string): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) return;
  await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/preshow-tracks/${encodeURIComponent(trackId)}`, {
    method: "DELETE"
  });
  await loadPreShowTracks();
}
