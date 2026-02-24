import QRCode from "qrcode";
import { get } from "svelte/store";

import { tr } from "../../i18n";
import { app } from "../../stores/app";
import { setStatus } from "../logging";

export async function openListenerQrPopup(): Promise<void> {
  try {
    const token = get(app).listenerCode.trim();
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const listenerQrPopupTargetUrl = /^\d{6}$/.test(token) ? `${baseUrl}?token=${encodeURIComponent(token)}` : window.location.href;
    const listenerQrPopupDataUrl = await QRCode.toDataURL(listenerQrPopupTargetUrl, { margin: 1, width: 520 });
    app.update((s) => ({ ...s, listenerQrPopupTargetUrl, listenerQrPopupDataUrl, listenerQrPopupOpen: true }));
  } catch (error) {
    setStatus("listener", tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export function closeListenerQrPopup(): void {
  app.update((s) => ({ ...s, listenerQrPopupOpen: false }));
}
