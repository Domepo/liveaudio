import { get } from "svelte/store";

import { app } from "../stores/app";
import type { AppState } from "../stores/app";

import { loadAdminSessions } from "./admin/sessions";
import { loadSelectedSession } from "./sessionDetail";

export function parseAdminSessionFromPath(pathname: string): string {
  const match = pathname.match(/^\/login\/sessions\/([^/]+)$/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

export function syncRoute(): void {
  const pathname = window.location.pathname;
  if (pathname.startsWith("/admin")) {
    const migrated = pathname.replace(/^\/admin/, "/login");
    history.replaceState({}, "", `${migrated}${window.location.search}${window.location.hash}`);
  }
  const normalizedPathname = window.location.pathname;
  const isAdminRoute = normalizedPathname.startsWith("/login");

  if (!isAdminRoute) {
    app.update((s) => ({
      ...s,
      isAdminRoute,
      adminView: "dashboard",
      selectedSessionId: "",
      preShowTracks: [],
      selectedPreShowTrackId: "",
      sessionAssignableUsers: [],
      sessionUsersStatus: ""
    }));
    return;
  }

  const sessionId = parseAdminSessionFromPath(normalizedPathname);
  if (sessionId) {
    app.update((s) => ({ ...s, isAdminRoute, adminView: "detail", selectedSessionId: sessionId }));
    return;
  }

  app.update((s) => ({
    ...s,
    isAdminRoute,
    adminView: "dashboard",
    selectedSessionId: "",
    preShowTracks: [],
    selectedPreShowTrackId: "",
    sessionAssignableUsers: [],
    sessionUsersStatus: ""
  }));
}

export function canAccessTab(tab: AppState["dashboardTab"]): boolean {
  const state = get(app);
  if (tab === "test") return state.debugMode && (state.authenticatedRole === "ADMIN" || state.authenticatedRole === "BROADCASTER");
  if (state.authenticatedRole === "ADMIN") return true;
  if (state.authenticatedRole === "BROADCASTER") return tab === "sessions" || tab === "statistics" || tab === "settings";
  return tab === "statistics";
}

export function setDashboardTab(tab: AppState["dashboardTab"]): void {
  if (!canAccessTab(tab)) return;
  const previousSelectedSessionId = get(app).selectedSessionId;
  if (get(app).isAdminRoute) {
    history.pushState({}, "", "/login");
    syncRoute();
  }
  app.update((s) => ({
    ...s,
    adminView: "dashboard",
    selectedSessionId: tab === "test" ? previousSelectedSessionId : "",
    preShowTracks: [],
    selectedPreShowTrackId: "",
    sessionAssignableUsers: [],
    sessionUsersStatus: "",
    dashboardTab: tab,
    mobileAdminMenuOpen: false
  }));
}

export function toggleDashboardSidebar(): void {
  app.update((s) => ({ ...s, dashboardSidebarCollapsed: !s.dashboardSidebarCollapsed }));
}

export function goToAdminList(): void {
  history.pushState({}, "", "/login");
  syncRoute();
  app.update((s) => ({
    ...s,
    dashboardTab: canAccessTab("sessions") ? "sessions" : "statistics",
    sessionAssignableUsers: [],
    sessionUsersStatus: ""
  }));
  if (get(app).adminAuthenticated) {
    void loadAdminSessions();
  }
}

export function goToDashboard(): void {
  history.pushState({}, "", "/login");
  syncRoute();
  app.update((s) => ({
    ...s,
    adminView: "dashboard",
    selectedSessionId: "",
    preShowTracks: [],
    selectedPreShowTrackId: "",
    sessionAssignableUsers: [],
    sessionUsersStatus: "",
    dashboardTab: canAccessTab("sessions") ? "sessions" : "statistics"
  }));
  if (get(app).adminAuthenticated) {
    void loadAdminSessions();
  }
}

export function goToAdminSession(sessionId: string): void {
  history.pushState({}, "", `/login/sessions/${encodeURIComponent(sessionId)}`);
  syncRoute();
  void loadSelectedSession();
}
