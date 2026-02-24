import QRCode from "qrcode";
import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import { tr } from "../../i18n";
import { setStatus } from "../logging";

export async function generateJoin(silent = false): Promise<void> {
  const state = get(app);
  if (!state.selectedSessionId) {
    if (!silent) setStatus("broadcaster", tr("status.qr_select_session"));
    return;
  }
  if (!state.sessionCode || !/^\d{6}$/.test(state.sessionCode.trim())) {
    if (!silent) setStatus("broadcaster", tr("status.qr_set_token"));
    return;
  }

  try {
    const data = await fetchJson<{ joinUrl: string }>(`${apiUrl}/api/sessions/${state.selectedSessionId}/join-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        joinBaseUrl: state.joinBaseUrl.trim() || undefined,
        token: state.sessionCode.trim()
      })
    });

    const joinUrl = data.joinUrl;
    const joinQrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 360,
      color: { dark: "#0f172a", light: "#ffffff" }
    });

    app.update((s) => ({ ...s, joinUrl, joinQrDataUrl }));
    if (!silent) setStatus("broadcaster", tr("status.qr_generated"));
  } catch (error) {
    if (!silent) setStatus("broadcaster", tr("status.error_prefix", { message: (error as Error).message }));
  }
}
