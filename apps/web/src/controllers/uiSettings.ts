import { get } from "svelte/store";

import { tr } from "../i18n";
import { app } from "../stores/app";
import { setSettingsStatus } from "./logging";
import { normalizeRefreshSeconds, restartStatsInterval } from "./statsInterval";

export function loadUiSettings(): void {
  const raw = localStorage.getItem("livevoice-ui-settings");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as {
      autoRefreshSeconds?: number;
      autoGenerateQr?: boolean;
      showOfflineChannels?: boolean;
      confirmDestructiveActions?: boolean;
      defaultJoinBaseUrl?: string;
    };

    app.update((s) => ({
      ...s,
      settingsAutoRefreshSeconds: normalizeRefreshSeconds(parsed.autoRefreshSeconds ?? s.settingsAutoRefreshSeconds),
      settingsAutoGenerateQr: parsed.autoGenerateQr ?? s.settingsAutoGenerateQr,
      settingsShowOfflineChannels: parsed.showOfflineChannels ?? s.settingsShowOfflineChannels,
      settingsConfirmDestructiveActions: parsed.confirmDestructiveActions ?? s.settingsConfirmDestructiveActions,
      settingsDefaultJoinBaseUrl: String(parsed.defaultJoinBaseUrl ?? "").trim()
    }));
  } catch {
    // ignore invalid local settings
  }
}

export function saveUiSettings(): void {
  const state = get(app);
  const nextAutoRefreshSeconds = normalizeRefreshSeconds(state.settingsAutoRefreshSeconds);
  const nextDefaultJoinBaseUrl = state.settingsDefaultJoinBaseUrl.trim();

  app.update((s) => ({
    ...s,
    settingsAutoRefreshSeconds: nextAutoRefreshSeconds,
    settingsDefaultJoinBaseUrl: nextDefaultJoinBaseUrl,
    joinBaseUrl: nextDefaultJoinBaseUrl ? nextDefaultJoinBaseUrl : s.joinBaseUrl
  }));

  const saved = get(app);
  localStorage.setItem(
    "livevoice-ui-settings",
    JSON.stringify({
      autoRefreshSeconds: saved.settingsAutoRefreshSeconds,
      autoGenerateQr: saved.settingsAutoGenerateQr,
      showOfflineChannels: saved.settingsShowOfflineChannels,
      confirmDestructiveActions: saved.settingsConfirmDestructiveActions,
      defaultJoinBaseUrl: saved.settingsDefaultJoinBaseUrl
    })
  );

  restartStatsInterval();
  setSettingsStatus(tr("settings.saved"));
}

export function saveUiSettingsSilently(): void {
  const state = get(app);
  const nextAutoRefreshSeconds = normalizeRefreshSeconds(state.settingsAutoRefreshSeconds);
  const nextDefaultJoinBaseUrl = state.settingsDefaultJoinBaseUrl.trim();

  app.update((s) => ({
    ...s,
    settingsAutoRefreshSeconds: nextAutoRefreshSeconds,
    settingsDefaultJoinBaseUrl: nextDefaultJoinBaseUrl,
    joinBaseUrl: nextDefaultJoinBaseUrl ? nextDefaultJoinBaseUrl : s.joinBaseUrl
  }));

  const saved = get(app);
  localStorage.setItem(
    "livevoice-ui-settings",
    JSON.stringify({
      autoRefreshSeconds: saved.settingsAutoRefreshSeconds,
      autoGenerateQr: saved.settingsAutoGenerateQr,
      showOfflineChannels: saved.settingsShowOfflineChannels,
      confirmDestructiveActions: saved.settingsConfirmDestructiveActions,
      defaultJoinBaseUrl: saved.settingsDefaultJoinBaseUrl
    })
  );

  restartStatsInterval();
}

export function resetUiSettings(): void {
  app.update((s) => ({
    ...s,
    settingsAutoRefreshSeconds: 5,
    settingsAutoGenerateQr: true,
    settingsShowOfflineChannels: true,
    settingsConfirmDestructiveActions: true,
    settingsDefaultJoinBaseUrl: ""
  }));
  localStorage.removeItem("livevoice-ui-settings");
  restartStatsInterval();
  setSettingsStatus(tr("settings.reset"));
}
