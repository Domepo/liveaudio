import { get } from "svelte/store";

import { app } from "../stores/app";
import { setStatsIntervalTimer, statsIntervalTimer } from "./runtime";

import { loadBroadcastLog } from "./statistics";
import { refreshSessionStats } from "./sessionDetail";
import { refreshListenerLiveState } from "./listener/liveState";
import { canAccessTab } from "./routing";

export function normalizeRefreshSeconds(value: number): number {
  return Math.max(2, Math.min(60, Number.isFinite(value) ? Math.floor(value) : 5));
}

export function restartStatsInterval(): void {
  if (statsIntervalTimer) {
    clearInterval(statsIntervalTimer);
  }

  const state = get(app);
  const intervalMs = normalizeRefreshSeconds(state.settingsAutoRefreshSeconds) * 1000;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const timer = setInterval(() => {
    const s = get(app);
    if (s.isAdminRoute && s.adminAuthenticated && canAccessTab("sessions") && s.adminView === "detail" && s.selectedSessionId) {
      void refreshSessionStats();
    }
    if (s.isAdminRoute && s.adminAuthenticated && s.adminView === "dashboard" && s.dashboardTab === "statistics") {
      void loadBroadcastLog();
    }
    if (!s.isAdminRoute && s.listenerSessionId && s.listenerCode.trim()) {
      if (Date.now() >= s.listenerLiveStateBackoffUntilMs) {
        void refreshListenerLiveState();
      }
    }
  }, intervalMs);

  setStatsIntervalTimer(timer);
}
