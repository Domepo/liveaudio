import { apiUrl } from "../../lib/config";
import { fetchJson } from "../../lib/http";
import type { AdminRole } from "../../types/admin";
import { app } from "../../stores/app";
import { setAdminStatus } from "../logging";

export async function loadAdminSession(): Promise<void> {
  try {
    const data = await fetchJson<{
      authenticated: boolean;
      userName: string;
      role: AdminRole;
      mustChangePassword?: boolean;
      debugMode?: boolean;
      debugModeMutable?: boolean;
    }>(`${apiUrl}/api/admin/me`);
    app.update((s) => ({
      ...s,
      adminAuthenticated: true,
      adminAuthenticatedName: data.userName ?? "",
      authenticatedRole: data.role ?? "VIEWER",
      mustChangeAdminPassword: Boolean(data.mustChangePassword),
      debugMode: Boolean(data.debugMode),
      debugModeMutable: Boolean(data.debugModeMutable)
    }));
    setAdminStatus("Angemeldet.");
  } catch {
    app.update((s) => ({
      ...s,
      adminAuthenticated: false,
      adminAuthenticatedName: "",
      authenticatedRole: "VIEWER",
      mustChangeAdminPassword: false,
      debugMode: false,
      debugModeMutable: false,
      sessionAssignableUsers: [],
      sessionUsersStatus: ""
    }));
  }
}
