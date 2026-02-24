import { get } from "svelte/store";

import { HttpError } from "../../lib/errors";
import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import { app } from "../../stores/app";
import { tr } from "../../i18n";
import { setAdminStatus } from "../logging";
import { goToAdminList } from "../routing";
import { stopBroadcast } from "../broadcaster/broadcast";

import { loadAdminRoles, loadAdminUsers } from "./users";
import { loadAdminSession } from "./me";
import { loadAdminSessions } from "./sessions";
import { loadSelectedSession } from "../sessionDetail";
import { canAccessTab } from "../routing";

export async function adminLogin(): Promise<void> {
  const state = get(app);
  if (state.adminLoginInFlight) return;

  app.update((s) => ({ ...s, adminLoginInFlight: true }));
  try {
    setAdminStatus(tr("status.admin_logging_in"));
    const current = get(app);
    await fetchJson<{ ok: boolean; mustChangePassword?: boolean }>(`${apiUrl}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: current.adminName, password: current.adminPassword })
    });

    app.update((s) => ({ ...s, adminName: "", adminPassword: "" }));

    await loadAdminSession();
    const afterLogin = get(app);
    if (afterLogin.mustChangeAdminPassword) {
      setAdminStatus("Passwortwechsel erforderlich. Bitte direkt neues Passwort setzen.");
      return;
    }
    await loadAdminSessions();

    const after = get(app);
    if (after.authenticatedRole === "ADMIN") {
      await loadAdminUsers();
      await loadAdminRoles();
    }
    if (after.authenticatedRole !== "ADMIN") {
      app.update((s) => ({ ...s, adminUsers: [] }));
    }
    if (!canAccessTab(after.dashboardTab)) {
      app.update((s) => ({ ...s, dashboardTab: canAccessTab("sessions") ? "sessions" : "statistics" }));
    }
    if (after.selectedSessionId) {
      await loadSelectedSession();
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      setAdminStatus(tr("status.too_many_logins"));
    } else {
      setAdminStatus(tr("status.error_prefix", { message: (error as Error).message }));
    }
  } finally {
    app.update((s) => ({ ...s, adminLoginInFlight: false }));
  }
}

export async function adminChangePassword(payload: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<void> {
  const state = get(app);
  if (state.adminPasswordChangeInFlight) return;

  app.update((s) => ({ ...s, adminPasswordChangeInFlight: true }));
  try {
    await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    app.update((s) => ({
      ...s,
      adminAuthenticated: false,
      adminAuthenticatedName: "",
      authenticatedRole: "VIEWER",
      mustChangeAdminPassword: false,
      sessionAssignableUsers: [],
      sessionUsersStatus: "",
      sessionRecordings: []
    }));
    setAdminStatus("Passwort geaendert. Bitte mit dem neuen Passwort anmelden.");
    await stopBroadcast();
    goToAdminList();
  } catch (error) {
    setAdminStatus(tr("status.error_prefix", { message: (error as Error).message }));
  } finally {
    app.update((s) => ({ ...s, adminPasswordChangeInFlight: false }));
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/logout`, { method: "POST" });
  } finally {
    app.update((s) => ({
      ...s,
      adminAuthenticated: false,
      adminAuthenticatedName: "",
      authenticatedRole: "VIEWER",
      mustChangeAdminPassword: false,
      sessionAssignableUsers: [],
      sessionUsersStatus: "",
      sessionRecordings: []
    }));
    setAdminStatus(tr("status.admin_logged_out"));
    await stopBroadcast();
    goToAdminList();
  }
}
