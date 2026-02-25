import { writable } from "svelte/store";

import type { BroadcastLogRow } from "../types/broadcast-log";
import type { AdminRole, AdminUser, SessionAssignableUser } from "../types/admin";
import type { AdminSessionSummary } from "../types/admin-session";
import type { AudioInput, Channel } from "../types/channel";
import type { SessionRecording } from "../types/recording";
import type { SessionStats } from "../types/stats";

export type Theme = "light" | "dark";
export type PreShowTrack = {
  id: string;
  name: string;
  url: string;
};

export type ListenerPlaybackState = "idle" | "connecting" | "live" | "paused" | "reconnecting" | "error";
export type ListenerTelemetryEvent = { at: string; event: string; detail?: string };

export type AppState = {
  theme: Theme;
  isAdminRoute: boolean;
  isQuickJoinMode: boolean;

  adminName: string;
  adminPassword: string;
  adminAuthenticated: boolean;
  mustChangeAdminPassword: boolean;
  adminStatus: string;
  adminLoginInFlight: boolean;
  adminPasswordChangeInFlight: boolean;
  adminAuthenticatedName: string;
  authenticatedRole: AdminRole;
  debugMode: boolean;
  debugModeMutable: boolean;
  mobileAdminMenuOpen: boolean;

  adminView: "dashboard" | "detail";
  dashboardTab: "statistics" | "users" | "settings" | "sessions" | "test";
  dashboardSidebarCollapsed: boolean;

  adminUsers: AdminUser[];
  sessionAssignableUsers: SessionAssignableUser[];
  sessionUsersStatus: string;
  adminRoles: AdminRole[];
  createUserName: string;
  createUserPassword: string;
  createUserRole: AdminRole;

  adminSessions: AdminSessionSummary[];
  selectedSessionId: string;
  broadcastLogRows: BroadcastLogRow[];
  broadcastLogStatus: string;

  createSessionName: string;
  createSessionDescription: string;
  createSessionImageUrl: string;

  sessionName: string;
  sessionDescription: string;
  sessionImageUrl: string;
  sessionCode: string;
  joinBaseUrl: string;
  joinUrl: string;
  joinQrDataUrl: string;
  sessionStats: SessionStats;
  broadcastOccupiedByOther: boolean;
  broadcastOwnerName: string;
  broadcastOwnerStartedAt: string;

  channelName: string;
  channelLanguage: string;
  channels: Channel[];
  adminLiveChannelIds: string[];
  channelDbLevels: Record<string, number>;
  channelInputAssignments: Record<string, string>;
  audioInputs: AudioInput[];

  broadcasterStatus: string;
  isBroadcasting: boolean;
  isPreshowMusicActive: boolean;
  isTestToneActive: boolean;
  preShowTracks: PreShowTrack[];
  selectedPreShowTrackId: string;
  preShowAutoSwitchEnabled: boolean;
  preShowAutoSwitchTime: string;
  sessionRecordings: SessionRecording[];
  isRecording: boolean;
  recordingStatus: string;

  listenerCode: string;
  listenerSessionId: string;
  listenerSessionName: string;
  listenerSessionDescription: string;
  listenerSessionImageUrl: string;
  listenerChannels: Channel[];
  listenerLiveChannelIds: string[];
  selectedChannelId: string;
  listenerStatus: string;
  isListening: boolean;
  activeListeningChannelId: string;
  listenerQrPopupOpen: boolean;
  listenerQrPopupDataUrl: string;
  listenerQrPopupTargetUrl: string;
  listenerPlaybackState: ListenerPlaybackState;
  listenerPlaybackDetail: string;
  listenerMediaSessionSupported: boolean;
  listenerMediaSessionPlaybackState: "none" | "paused" | "playing";
  listenerTelemetryEvents: ListenerTelemetryEvent[];

  appLogoUrl: string;
  settingsStatus: string;
  settingsAutoRefreshSeconds: number;
  settingsAutoGenerateQr: boolean;
  settingsShowOfflineChannels: boolean;
  settingsConfirmDestructiveActions: boolean;
  settingsDefaultJoinBaseUrl: string;

  lastSavedSessionMeta: { name: string; description: string; imageUrl: string; broadcastCode: string };
  isHydratingSessionMeta: boolean;
  listenerLiveStateBackoffUntilMs: number;
  listenerWantsListen: boolean;
  listenerReconnectAttempts: number;
  broadcasterWantsBroadcast: boolean;
  broadcasterReconnectAttempts: number;
};

const defaultState: AppState = {
  theme: "light",
  isAdminRoute: false,
  isQuickJoinMode: false,

  adminName: "",
  adminPassword: "",
  adminAuthenticated: false,
  mustChangeAdminPassword: false,
  adminStatus: "",
  adminLoginInFlight: false,
  adminPasswordChangeInFlight: false,
  adminAuthenticatedName: "",
  authenticatedRole: "VIEWER",
  debugMode: false,
  debugModeMutable: false,
  mobileAdminMenuOpen: false,

  adminView: "dashboard",
  dashboardTab: "sessions",
  dashboardSidebarCollapsed: false,

  adminUsers: [],
  sessionAssignableUsers: [],
  sessionUsersStatus: "",
  adminRoles: ["ADMIN", "BROADCASTER", "VIEWER"],
  createUserName: "",
  createUserPassword: "",
  createUserRole: "VIEWER",

  adminSessions: [],
  selectedSessionId: "",
  broadcastLogRows: [],
  broadcastLogStatus: "",

  createSessionName: "",
  createSessionDescription: "",
  createSessionImageUrl: "",

  sessionName: "",
  sessionDescription: "",
  sessionImageUrl: "",
  sessionCode: "",
  joinBaseUrl: "",
  joinUrl: "",
  joinQrDataUrl: "",
  sessionStats: {
    channelsTotal: 0,
    channelsActive: 0,
    listenersConnected: 0,
    broadcastersConnected: 0,
    joinEvents24h: 0,
    activeProducerChannels: 0
  },
  broadcastOccupiedByOther: false,
  broadcastOwnerName: "",
  broadcastOwnerStartedAt: "",

  channelName: "Deutsch",
  channelLanguage: "de",
  channels: [],
  adminLiveChannelIds: [],
  channelDbLevels: {},
  channelInputAssignments: {},
  audioInputs: [],

  broadcasterStatus: "",
  isBroadcasting: false,
  isPreshowMusicActive: false,
  isTestToneActive: false,
  preShowTracks: [],
  selectedPreShowTrackId: "",
  preShowAutoSwitchEnabled: false,
  preShowAutoSwitchTime: "10:00",
  sessionRecordings: [],
  isRecording: false,
  recordingStatus: "",

  listenerCode: "",
  listenerSessionId: "",
  listenerSessionName: "",
  listenerSessionDescription: "",
  listenerSessionImageUrl: "",
  listenerChannels: [],
  listenerLiveChannelIds: [],
  selectedChannelId: "",
  listenerStatus: "",
  isListening: false,
  activeListeningChannelId: "",
  listenerQrPopupOpen: false,
  listenerQrPopupDataUrl: "",
  listenerQrPopupTargetUrl: "",
  listenerPlaybackState: "idle",
  listenerPlaybackDetail: "",
  listenerMediaSessionSupported: false,
  listenerMediaSessionPlaybackState: "none",
  listenerTelemetryEvents: [],

  appLogoUrl: "/logo.png",
  settingsStatus: "",
  settingsAutoRefreshSeconds: 5,
  settingsAutoGenerateQr: true,
  settingsShowOfflineChannels: true,
  settingsConfirmDestructiveActions: true,
  settingsDefaultJoinBaseUrl: "",

  lastSavedSessionMeta: { name: "", description: "", imageUrl: "", broadcastCode: "" },
  isHydratingSessionMeta: false,
  listenerLiveStateBackoffUntilMs: 0,
  listenerWantsListen: false,
  listenerReconnectAttempts: 0,
  broadcasterWantsBroadcast: false,
  broadcasterReconnectAttempts: 0
};

export const app = writable<AppState>(defaultState);
