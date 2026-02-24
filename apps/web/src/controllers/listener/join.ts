import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { HttpError } from "../../lib/errors";
import { fetchJson } from "../../lib/http";
import { withRetries } from "../../lib/retry";
import { app } from "../../stores/app";
import type { Channel } from "../../types/channel";
import { tr } from "../../i18n";
import { setStatus } from "../logging";

type JoinValidationResponse = {
  session: { id: string; name: string; description?: string | null; imageUrl?: string | null };
  channels: Channel[];
  liveChannelIds: string[];
};

export async function validateJoin(): Promise<void> {
  try {
    const code = get(app).listenerCode.trim();
    const data = await withRetries(
      () =>
        fetchJson<JoinValidationResponse>(`${apiUrl}/api/join/validate-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code })
        }),
      {
        attempts: 5,
        baseDelayMs: 250,
        maxDelayMs: 4000,
        shouldRetry: (err) => {
          if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
          return err instanceof TypeError;
        }
      }
    );

    app.update((s) => ({
      ...s,
      listenerSessionId: data.session.id,
      listenerSessionName: data.session.name,
      listenerSessionDescription: data.session.description ?? "",
      listenerSessionImageUrl: data.session.imageUrl ?? "",
      listenerChannels: data.channels,
      listenerLiveChannelIds: data.liveChannelIds ?? [],
      selectedChannelId: data.channels[0]?.id ?? "",
      listenerPlaybackState: "idle",
      listenerPlaybackDetail: "",
      listenerMediaSessionPlaybackState: "none"
    }));
    const after = get(app);
    setStatus("listener", after.listenerChannels.length > 0 ? tr("status.listener_token_valid") : tr("status.listener_token_valid_no_channels"));
  } catch (error) {
    setStatus("listener", tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function enterWithToken(): Promise<void> {
  await validateJoin();
  if (!get(app).listenerSessionId) return;
  app.update((s) => ({ ...s, isQuickJoinMode: true }));
  history.replaceState({}, "", `/?token=${encodeURIComponent(get(app).listenerCode.trim())}`);
}
