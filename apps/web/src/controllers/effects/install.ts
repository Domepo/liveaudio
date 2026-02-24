import { get } from "svelte/store";

import { app } from "../../stores/app";
import { canAccessTab } from "../routing";
import { scheduleAutoSaveSessionMeta } from "../sessionDetail/meta";
import { autoQrTimer, clearTimer, setAutoQrTimer } from "../runtime";
import { generateJoin } from "../sessionDetail/qr";

export function installEffects(): () => void {
  let prevAutoSaveKey = "";
  let prevAutoQrKey = "";
  let prevAutoQrEnabled = get(app).settingsAutoGenerateQr;

  const unsubscribe = app.subscribe((s) => {
    // Auto-save session meta (matches original `$:` block).
    if (s.isAdminRoute && s.adminAuthenticated && canAccessTab("sessions") && s.adminView === "detail" && s.selectedSessionId && !s.isHydratingSessionMeta) {
      const key = `${s.selectedSessionId}|${s.sessionName}|${s.sessionDescription}|${s.sessionImageUrl}`;
      if (key !== prevAutoSaveKey) {
        prevAutoSaveKey = key;
        scheduleAutoSaveSessionMeta();
      }
    } else {
      prevAutoSaveKey = "";
    }

    // Auto-generate QR (matches original `$:` blocks).
    const autoQrCondition =
      s.settingsAutoGenerateQr && s.isAdminRoute && s.adminAuthenticated && s.adminView === "detail" && s.selectedSessionId && /^\d{6}$/.test(s.sessionCode.trim());

    if (autoQrCondition) {
      const key = `${s.selectedSessionId}|${s.sessionCode}|${s.joinBaseUrl}`;
      if (key !== prevAutoQrKey) {
        prevAutoQrKey = key;
        if (autoQrTimer) clearTimer(autoQrTimer);
        setAutoQrTimer(
          setTimeout(() => {
            void generateJoin(true);
          }, 250)
        );
      }
    } else {
      prevAutoQrKey = "";
    }

    if (!s.settingsAutoGenerateQr && prevAutoQrEnabled) {
      if (autoQrTimer) {
        clearTimer(autoQrTimer);
        setAutoQrTimer(null);
      }
    }
    prevAutoQrEnabled = s.settingsAutoGenerateQr;
  });

  return () => {
    unsubscribe();
  };
}
