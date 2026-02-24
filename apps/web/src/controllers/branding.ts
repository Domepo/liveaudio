import { get } from "svelte/store";

import { apiUrl } from "../lib/config";
import { fileToDataUrl } from "../lib/files";
import { fetchJson } from "../lib/http";
import { app } from "../stores/app";
import { tr } from "../i18n";
import { setSettingsStatus } from "./logging";

type BrandingResponse = {
  logoUrl: string;
  version: string;
};

function applyLogoUrl(url: string, version: string): void {
  if (url.startsWith("data:")) {
    app.update((s) => ({ ...s, appLogoUrl: url }));
    return;
  }
  const separator = url.includes("?") ? "&" : "?";
  app.update((s) => ({ ...s, appLogoUrl: `${url}${separator}v=${encodeURIComponent(version || "0")}` }));
}

export async function loadBrandingLogo(): Promise<void> {
  try {
    const branding = await fetchJson<BrandingResponse>(`${apiUrl}/api/public/branding`);
    applyLogoUrl(branding.logoUrl || "/logo.png", branding.version || "0");
  } catch {
    app.update((s) => ({ ...s, appLogoUrl: "/logo.png" }));
  }
}

export async function handleSettingsLogoUpload(file: File): Promise<void> {
  if (!file) return;
  try {
    const dataUrl = await fileToDataUrl(file);
    const updated = await fetchJson<BrandingResponse & { ok: boolean }>(`${apiUrl}/api/admin/settings/logo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoDataUrl: dataUrl })
    });
    applyLogoUrl(updated.logoUrl || dataUrl, updated.version || String(Date.now()));
    setSettingsStatus(tr("status.logo_saved"));
  } catch (error) {
    setSettingsStatus(tr("status.logo_save_error", { message: (error as Error).message }));
  }
}

export async function resetAppLogo(): Promise<void> {
  try {
    const updated = await fetchJson<BrandingResponse & { ok: boolean }>(`${apiUrl}/api/admin/settings/logo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logoDataUrl: null })
    });
    applyLogoUrl(updated.logoUrl || "/logo.png", updated.version || "default");
    setSettingsStatus(tr("status.logo_reset"));
  } catch (error) {
    setSettingsStatus(tr("status.logo_reset_error", { message: (error as Error).message }));
  }
}

export function onSettingsLogoInputChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  void handleSettingsLogoUpload(file);
  target.value = "";
}
