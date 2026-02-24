import { get } from "svelte/store";

import { apiUrl } from "../lib/config";
import { fetchJson } from "../lib/http";
import { app } from "../stores/app";
import { initLocale } from "../i18n";
import { applyTheme } from "./theme";
import { loadUiSettings } from "./uiSettings";
import { loadBrandingLogo } from "./branding";
import { syncRoute, canAccessTab } from "./routing";
import { loadAdminSession } from "./admin/me";
import { loadAdminSessions } from "./admin/sessions";
import { loadAdminRoles, loadAdminUsers } from "./admin/users";
import { loadBroadcastLog } from "./statistics";
import { loadSelectedSession } from "./sessionDetail";
import { refreshAudioInputs } from "./broadcaster/audioInputs";
import { restartStatsInterval } from "./statsInterval";
import { validateJoin } from "./listener/join";
import {
  autoQrTimer,
  autoSaveSessionTimer,
  clearIntervalTimer,
  clearTimer,
  setAutoQrTimer,
  setAutoSaveSessionTimer,
  setStatsIntervalTimer,
  statsIntervalTimer
} from "./runtime";

import { installEffects } from "./effects/install";

export async function initApp(): Promise<() => void> {
  initLocale();

  const savedTheme = localStorage.getItem("livevoice-theme") as "light" | "dark" | null;
  if (savedTheme === "light" || savedTheme === "dark") {
    applyTheme(savedTheme);
  } else {
    applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  loadUiSettings();
  await loadBrandingLogo();

  syncRoute();
  const onPopState = () => syncRoute();
  window.addEventListener("popstate", onPopState);

  // Mobile-only: tune admin navigation defaults on small screens.
  if (get(app).isAdminRoute && window.matchMedia("(max-width: 768px)").matches) {
    app.update((s) => ({ ...s, mobileAdminMenuOpen: false }));
  }

  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token")?.trim() ?? "";
  if (!get(app).isAdminRoute && tokenFromUrl) {
    app.update((s) => ({ ...s, listenerCode: tokenFromUrl, isQuickJoinMode: true }));
    await validateJoin();
  }

  await refreshAudioInputs(false);

  try {
    const net = await fetchJson<{ suggestedJoinBaseUrl: string }>(`${apiUrl}/api/network`);
    const s = get(app);
    if (s.settingsDefaultJoinBaseUrl) {
      app.update((st) => ({ ...st, joinBaseUrl: st.settingsDefaultJoinBaseUrl }));
    } else if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      app.update((st) => ({ ...st, joinBaseUrl: net.suggestedJoinBaseUrl }));
    } else {
      app.update((st) => ({ ...st, joinBaseUrl: window.location.origin }));
    }
  } catch {
    const s = get(app);
    if (s.settingsDefaultJoinBaseUrl) {
      app.update((st) => ({ ...st, joinBaseUrl: st.settingsDefaultJoinBaseUrl }));
    } else {
      app.update((st) => ({
        ...st,
        joinBaseUrl:
          window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
            ? `${window.location.protocol}//${window.location.hostname}:5173`
            : window.location.origin
      }));
    }
  }

  if (get(app).isAdminRoute) {
    await loadAdminSession();
    if (get(app).adminAuthenticated) {
      await loadAdminSessions();
      if (get(app).authenticatedRole === "ADMIN") {
        await loadAdminRoles();
        await loadAdminUsers();
      } else {
        app.update((s) => ({ ...s, adminUsers: [] }));
      }
      if (!canAccessTab(get(app).dashboardTab)) {
        app.update((s) => ({ ...s, dashboardTab: canAccessTab("sessions") ? "sessions" : "statistics" }));
      }
      if (get(app).dashboardTab === "statistics") await loadBroadcastLog();
      if (get(app).adminView === "detail" && get(app).selectedSessionId && canAccessTab("sessions")) {
        await loadSelectedSession();
      }
    }
  }

  let mediaDeviceChangeCleanup: (() => void) | null = null;
  if (navigator.mediaDevices?.addEventListener) {
    const onDeviceChange = async () => {
      await refreshAudioInputs(false);
    };
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    mediaDeviceChangeCleanup = () => {
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
    };
  }

  restartStatsInterval();

  const removeEffects = installEffects();

  return () => {
    window.removeEventListener("popstate", onPopState);
    mediaDeviceChangeCleanup?.();
    removeEffects();

    if (statsIntervalTimer) {
      clearIntervalTimer(statsIntervalTimer);
      setStatsIntervalTimer(null);
    }
    if (autoSaveSessionTimer) {
      clearTimer(autoSaveSessionTimer);
      setAutoSaveSessionTimer(null);
    }
    if (autoQrTimer) {
      clearTimer(autoQrTimer);
      setAutoQrTimer(null);
    }
  };
}
