import { get } from "svelte/store";

import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import type { AdminRole, AdminUser, SessionAssignableUser } from "../../types/admin";
import { app } from "../../stores/app";
import { tr } from "../../i18n";
import { setAdminStatus } from "../logging";
import { loadAdminSessions } from "./sessions";

export async function loadAdminRoles(): Promise<void> {
  try {
    const data = await fetchJson<{ roles: AdminRole[] }>(`${apiUrl}/api/admin/roles`);
    if (Array.isArray(data.roles) && data.roles.length > 0) {
      app.update((s) => ({
        ...s,
        adminRoles: data.roles,
        createUserRole: data.roles.includes(s.createUserRole) ? s.createUserRole : (data.roles[0] ?? "VIEWER")
      }));
    }
  } catch {
    app.update((s) => ({ ...s, adminRoles: ["ADMIN", "BROADCASTER", "VIEWER"] }));
  }
}

export async function loadAdminUsers(): Promise<void> {
  try {
    const users = await fetchJson<AdminUser[]>(`${apiUrl}/api/admin/users`);
    app.update((s) => ({ ...s, adminUsers: users }));
  } catch (error) {
    setAdminStatus(tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function loadSessionAssignableUsers(): Promise<void> {
  const state = get(app);
  if (state.authenticatedRole !== "ADMIN" || !state.selectedSessionId) {
    app.update((s) => ({ ...s, sessionAssignableUsers: [] }));
    return;
  }
  try {
    const data = await fetchJson<{ users: SessionAssignableUser[] }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/users`);
    app.update((s) => ({ ...s, sessionAssignableUsers: Array.isArray(data.users) ? data.users : [], sessionUsersStatus: "" }));
  } catch (error) {
    app.update((s) => ({ ...s, sessionAssignableUsers: [], sessionUsersStatus: tr("status.error_prefix", { message: (error as Error).message }) }));
  }
}

export async function createAdminUser(): Promise<void> {
  const state = get(app);
  try {
    await fetchJson<AdminUser>(`${apiUrl}/api/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: state.createUserName,
        password: state.createUserPassword,
        role: state.createUserRole
      })
    });
    app.update((s) => ({
      ...s,
      createUserName: "",
      createUserPassword: "",
      createUserRole: (s.adminRoles[0] ?? "VIEWER") as AdminRole
    }));
    setAdminStatus(tr("status.user_created"));
    await loadAdminUsers();
  } catch (error) {
    setAdminStatus(tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function updateAdminUser(payload: { userId: string; name: string; role: AdminRole; password?: string }): Promise<void> {
  try {
    await fetchJson<AdminUser>(`${apiUrl}/api/admin/users/${encodeURIComponent(payload.userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        role: payload.role,
        ...(payload.password ? { password: payload.password } : {})
      })
    });
    setAdminStatus(tr("status.user_updated"));
    await loadAdminUsers();
  } catch (error) {
    setAdminStatus(tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function deleteAdminUser(payload: { userId: string; name: string }): Promise<void> {
  const state = get(app);
  const confirmDelete = state.settingsConfirmDestructiveActions ? window.confirm(tr("confirm.delete_user", { name: payload.name })) : true;
  if (!confirmDelete) return;
  try {
    await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/users/${encodeURIComponent(payload.userId)}`, { method: "DELETE" });
    setAdminStatus(tr("status.user_deleted"));
    await loadAdminUsers();
    if (get(app).selectedSessionId) {
      await loadSessionAssignableUsers();
    }
  } catch (error) {
    setAdminStatus(tr("status.error_prefix", { message: (error as Error).message }));
  }
}

export async function setSessionUserAssignment(userId: string, assigned: boolean): Promise<void> {
  const state = get(app);
  if (state.authenticatedRole !== "ADMIN" || !state.selectedSessionId) return;
  try {
    await fetchJson<{ ok: boolean; assigned: boolean }>(`${apiUrl}/api/admin/sessions/${state.selectedSessionId}/users/${encodeURIComponent(userId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned })
    });
    app.update((s) => ({
      ...s,
      sessionAssignableUsers: s.sessionAssignableUsers.map((u) => (u.id === userId ? { ...u, assigned } : u)),
      sessionUsersStatus: ""
    }));
    await loadAdminSessions();
  } catch (error) {
    app.update((s) => ({ ...s, sessionUsersStatus: tr("status.error_prefix", { message: (error as Error).message }) }));
  }
}
