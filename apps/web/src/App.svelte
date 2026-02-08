<script lang="ts">
  import { onMount } from "svelte";
  import { io, type Socket } from "socket.io-client";
  import { Device } from "mediasoup-client";
  import QRCode from "qrcode";

  type Channel = { id: string; name: string; languageCode?: string | null };
  type AudioInput = { deviceId: string; label: string };
  type SessionStats = {
    channelsTotal: number;
    channelsActive: number;
    listenersConnected: number;
    broadcastersConnected: number;
    joinEvents24h: number;
    activeProducerChannels: number;
  };
  type SessionAnalytics = {
    live: {
      listenersPerChannel: Array<{ channelId: string; name: string; listeners: number }>;
      totalListeners: number;
      peakListeners: number;
      joinRatePerMin: number;
      leaveRatePerMin: number;
    };
    realtimeGraph: {
      points: Array<{ ts: number; total: number }>;
      perChannel: Array<{ channelId: string; name: string; points: Array<{ ts: number; listeners: number }> }>;
    };
    postSession: {
      averageListeningDurationSec: number;
      heatmap: Array<{ hour: number; joins: number }>;
      channelComparison: Array<{
        channelId: string;
        name: string;
        joins: number;
        leaves: number;
        averageListeningDurationSec: number;
        peakListeners: number;
      }>;
    };
  };
  type AdminSessionSummary = {
    id: string;
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    status: "ACTIVE" | "ENDED";
    createdAt: string;
    channelsCount: number;
    listenersConnected: number;
    activeProducerChannels: number;
  };
  type JoinValidationResponse = {
    session: { id: string; name: string; description?: string | null; imageUrl?: string | null };
    channels: Channel[];
    liveChannelIds: string[];
  };

  function runtimeApiUrl(): string {
    if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
    if (typeof window === "undefined") return "http://localhost:3000";
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  function runtimeWsUrl(): string {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    if (typeof window === "undefined") return "http://localhost:3000";
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  function runtimeIceServers(): RTCIceServer[] | undefined {
    const urlsRaw = String(import.meta.env.VITE_TURN_URLS ?? "").trim();
    if (!urlsRaw) return undefined;

    const urls = urlsRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (urls.length === 0) return undefined;

    const username = String(import.meta.env.VITE_TURN_USERNAME ?? "").trim();
    const credential = String(import.meta.env.VITE_TURN_PASSWORD ?? "").trim();
    const server: RTCIceServer = {
      urls: urls.length === 1 ? urls[0] : urls
    };
    if (username && credential) {
      server.username = username;
      server.credential = credential;
    }

    return [server];
  }

  const apiUrl = runtimeApiUrl();
  const wsUrl = runtimeWsUrl();
  const iceServers = runtimeIceServers();

  let theme: "light" | "dark" = "light";
  let isAdminRoute = false;
  let isQuickJoinMode = false;

  let adminPassword = "";
  let adminAuthenticated = false;
  let adminStatus = "Bitte als Admin anmelden.";
  let adminCurrentPassword = "";
  let adminNewPassword = "";
  let adminConfirmPassword = "";

  let adminView: "dashboard" | "detail" = "dashboard";
  let dashboardTab: "statistics" | "users" | "settings" | "sessions" = "statistics";
  let adminSessions: AdminSessionSummary[] = [];
  let selectedSessionId = "";
  let analyticsSessionId = "";
  let analyticsStatus = "";

  let createSessionName = "";
  let createSessionDescription = "";
  let createSessionImageUrl = "";

  let sessionName = "";
  let sessionDescription = "";
  let sessionImageUrl = "";
  let sessionCode = "";
  let joinBaseUrl = "";
  let joinUrl = "";
  let joinQrDataUrl = "";
  let sessionStats: SessionStats = {
    channelsTotal: 0,
    channelsActive: 0,
    listenersConnected: 0,
    broadcastersConnected: 0,
    joinEvents24h: 0,
    activeProducerChannels: 0
  };
  let sessionAnalytics: SessionAnalytics | null = null;

  let channelName = "Deutsch";
  let channelLanguage = "de";
  let channels: Channel[] = [];
  let adminLiveChannelIds: string[] = [];
  let channelDbLevels: Record<string, number> = {};
  let channelInputAssignments: Record<string, string> = {};
  let audioInputs: AudioInput[] = [];

  let broadcasterStatus = "Bereit";
  let isBroadcasting = false;

  let listenerCode = "";
  let listenerSessionId = "";
  let listenerSessionName = "";
  let listenerSessionDescription = "";
  let listenerSessionImageUrl = "";
  let listenerChannels: Channel[] = [];
  let listenerLiveChannelIds: string[] = [];
  let selectedChannelId = "";
  let listenerStatus = "Bereit";
  let isListening = false;
  let activeListeningChannelId = "";

  let listenerAudio: HTMLAudioElement;
  let broadcasterSocket: Socket | null = null;
  let listenerSocket: Socket | null = null;
  let broadcasterMicStreams: MediaStream[] = [];
  let meterAudioContext: AudioContext | null = null;
  let meterAnimationId: number | null = null;
  const channelAnalyzers = new Map<string, { analyser: AnalyserNode; dataArray: Uint8Array; source: MediaStreamAudioSourceNode }>();
  let createImageInputEl: HTMLInputElement;
  let editImageInputEl: HTMLInputElement;
  let autoSaveSessionTimer: ReturnType<typeof setTimeout> | null = null;
  let isHydratingSessionMeta = false;
  let lastSavedSessionMeta = { name: "", description: "", imageUrl: "" };

  function shortId(value: string): string {
    if (!value) return "-";
    return value.length > 14 ? `${value.slice(0, 7)}...${value.slice(-5)}` : value;
  }

  function setStatus(type: "broadcaster" | "listener", message: string): void {
    if (type === "broadcaster") broadcasterStatus = message;
    else listenerStatus = message;
  }

  function applyTheme(nextTheme: "light" | "dark"): void {
    theme = nextTheme;
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("livevoice-theme", nextTheme);
  }

  function toggleTheme(): void {
    applyTheme(theme === "dark" ? "light" : "dark");
  }

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      credentials: "include",
      ...init
    });
    const raw = await response.text();
    let body: unknown = {};

    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        throw new Error("Server returned invalid JSON");
      }
    }

    if (!response.ok) {
      const errorMessage =
        typeof body === "object" && body !== null && "error" in body && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `Request failed (${response.status})`;
      throw new Error(errorMessage);
    }

    return (body as T) ?? ({} as T);
  }

  async function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      socket.emit(event, payload, (response: { error?: string } & T) => {
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  function parseAdminSessionFromPath(pathname: string): string {
    const match = pathname.match(/^\/admin\/sessions\/([^/]+)$/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  }

  function syncRoute(): void {
    const pathname = window.location.pathname;
    isAdminRoute = pathname.startsWith("/admin");

    if (!isAdminRoute) {
      adminView = "dashboard";
      selectedSessionId = "";
      return;
    }

    const sessionId = parseAdminSessionFromPath(pathname);
    if (sessionId) {
      adminView = "detail";
      selectedSessionId = sessionId;
      return;
    }

    adminView = "dashboard";
    selectedSessionId = "";
  }

  function goToAdminList(): void {
    history.pushState({}, "", "/admin");
    syncRoute();
    dashboardTab = "sessions";
    if (adminAuthenticated) {
      void loadAdminSessions();
    }
  }

  function goToDashboard(): void {
    history.pushState({}, "", "/admin");
    syncRoute();
    dashboardTab = "statistics";
    if (adminAuthenticated) {
      void loadAdminSessions();
    }
  }

  function goToAdminSession(sessionId: string): void {
    history.pushState({}, "", `/admin/sessions/${encodeURIComponent(sessionId)}`);
    syncRoute();
    void loadSelectedSession();
  }

  function syncChannelAssignments(nextChannels: Channel[]): void {
    const next: Record<string, string> = {};
    for (const [index, channel] of nextChannels.entries()) {
      const previous = channelInputAssignments[channel.id];
      if (previous !== undefined) {
        next[channel.id] = previous;
      } else {
        next[channel.id] = audioInputs[index]?.deviceId ?? "";
      }
    }
    channelInputAssignments = next;
  }

  function channelIsLive(channelId: string, mode: "admin" | "listener"): boolean {
    return (mode === "admin" ? adminLiveChannelIds : listenerLiveChannelIds).includes(channelId);
  }

  function channelDbToPercent(db: number): number {
    const minDb = -60;
    const maxDb = 0;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return ((clamped - minDb) / (maxDb - minDb)) * 100;
  }

  function linePath(points: number[], width = 520, height = 180): string {
    if (points.length === 0) return "";
    const max = Math.max(1, ...points);
    const stepX = points.length > 1 ? width / (points.length - 1) : width;
    return points
      .map((value, index) => {
        const x = index * stepX;
        const y = height - (value / max) * height;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  function avg<T>(values: T[], mapper: (value: T) => number): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + mapper(value), 0) / values.length;
  }

  function meterBarClass(db: number): string {
    if (db > -12) return "bg-gradient-to-r from-amber-400 to-emerald-500";
    if (db > -24) return "bg-gradient-to-r from-orange-400 to-lime-500";
    return "bg-gradient-to-r from-rose-500 to-amber-400";
  }

  function stopLevelMeters(): void {
    if (meterAnimationId !== null) {
      cancelAnimationFrame(meterAnimationId);
      meterAnimationId = null;
    }
    for (const meter of channelAnalyzers.values()) {
      meter.source.disconnect();
    }
    channelAnalyzers.clear();
    if (meterAudioContext) {
      void meterAudioContext.close();
      meterAudioContext = null;
    }
    channelDbLevels = {};
  }

  function startLevelMeterLoop(): void {
    if (meterAnimationId !== null) return;
    const update = () => {
      const nextLevels: Record<string, number> = {};
      for (const [channelId, meter] of channelAnalyzers.entries()) {
        meter.analyser.getByteTimeDomainData(meter.dataArray);
        let sum = 0;
        for (const value of meter.dataArray) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / meter.dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        nextLevels[channelId] = Number(Math.max(-60, Math.min(0, db)).toFixed(1));
      }
      channelDbLevels = nextLevels;
      meterAnimationId = requestAnimationFrame(update);
    };
    meterAnimationId = requestAnimationFrame(update);
  }

  async function attachLevelMeter(channelId: string, stream: MediaStream): Promise<void> {
    if (!meterAudioContext) {
      meterAudioContext = new AudioContext();
    }
    if (meterAudioContext.state === "suspended") {
      await meterAudioContext.resume();
    }

    const source = meterAudioContext.createMediaStreamSource(stream);
    const analyser = meterAudioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    channelAnalyzers.set(channelId, { analyser, dataArray: new Uint8Array(analyser.fftSize), source });
    startLevelMeterLoop();
  }

  async function refreshAudioInputs(requestPermission = false): Promise<void> {
    try {
      if (requestPermission) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((track) => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      audioInputs = devices
        .filter((d) => d.kind === "audioinput")
        .map((d, index) => ({ deviceId: d.deviceId, label: d.label || `Audio Input ${index + 1}` }));

      syncChannelAssignments(channels);
    } catch (error) {
      setStatus("broadcaster", `Audio-Geräte Fehler: ${(error as Error).message}`);
    }
  }

  async function adminLogin(): Promise<void> {
    try {
      await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword })
      });
      adminAuthenticated = true;
      adminPassword = "";
      adminStatus = "Admin angemeldet.";
      await loadAdminSessions();
      if (selectedSessionId) await loadSelectedSession();
    } catch (error) {
      adminStatus = `Fehler: ${(error as Error).message}`;
    }
  }

  async function adminLogout(): Promise<void> {
    try {
      await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/logout`, { method: "POST" });
    } finally {
      adminAuthenticated = false;
      adminStatus = "Abgemeldet.";
      await stopBroadcast();
      goToAdminList();
    }
  }

  async function changeAdminPassword(): Promise<void> {
    try {
      await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: adminCurrentPassword,
          newPassword: adminNewPassword,
          confirmPassword: adminConfirmPassword
        })
      });
      adminCurrentPassword = "";
      adminNewPassword = "";
      adminConfirmPassword = "";
      adminStatus = "Admin-Passwort wurde geändert.";
    } catch (error) {
      adminStatus = `Fehler: ${(error as Error).message}`;
    }
  }

  async function loadAdminSession(): Promise<void> {
    try {
      await fetchJson<{ authenticated: boolean }>(`${apiUrl}/api/admin/me`);
      adminAuthenticated = true;
      adminStatus = "Admin angemeldet.";
    } catch {
      adminAuthenticated = false;
    }
  }

  async function loadAdminSessions(): Promise<void> {
    adminSessions = await fetchJson<AdminSessionSummary[]>(`${apiUrl}/api/admin/sessions`);
    if (!analyticsSessionId && adminSessions.length > 0) {
      analyticsSessionId = adminSessions[0].id;
    }
  }

  async function loadSessionAnalytics(): Promise<void> {
    if (!analyticsSessionId) {
      sessionAnalytics = null;
      return;
    }
    try {
      sessionAnalytics = await fetchJson<SessionAnalytics>(`${apiUrl}/api/admin/sessions/${analyticsSessionId}/analytics`);
      analyticsStatus = "";
    } catch (error) {
      analyticsStatus = `Fehler: ${(error as Error).message}`;
    }
  }

  async function exportAnalytics(format: "csv" | "json"): Promise<void> {
    if (!analyticsSessionId) return;
    const response = await fetch(`${apiUrl}/api/admin/sessions/${analyticsSessionId}/analytics/export?format=${format}`, {
      credentials: "include"
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `analytics-${analyticsSessionId}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function clearAnalytics(): Promise<void> {
    if (!analyticsSessionId) return;
    const ok = window.confirm("Statistiken für diese Session wirklich zurücksetzen?");
    if (!ok) return;
    try {
      await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/sessions/${analyticsSessionId}/analytics/clear`, {
        method: "POST"
      });
      analyticsStatus = "Statistiken wurden zurückgesetzt.";
      await loadSessionAnalytics();
    } catch (error) {
      analyticsStatus = `Fehler: ${(error as Error).message}`;
    }
  }

  async function loadSelectedSession(): Promise<void> {
    if (!selectedSessionId) return;

    const data = await fetchJson<{
      session: { id: string; name: string; description?: string | null; imageUrl?: string | null; broadcastCode?: string | null };
      channels: Channel[];
      stats: SessionStats;
      liveChannelIds: string[];
    }>(`${apiUrl}/api/admin/sessions/${selectedSessionId}`);

    isHydratingSessionMeta = true;
    sessionName = data.session.name;
    sessionDescription = data.session.description ?? "";
    sessionImageUrl = data.session.imageUrl ?? "";
    sessionCode = data.session.broadcastCode ?? "";
    lastSavedSessionMeta = {
      name: sessionName,
      description: sessionDescription,
      imageUrl: sessionImageUrl
    };
    channels = data.channels;
    adminLiveChannelIds = data.liveChannelIds ?? [];
    syncChannelAssignments(data.channels);
    sessionStats = data.stats;
    joinUrl = "";
    joinQrDataUrl = "";
    channelDbLevels = {};
    isHydratingSessionMeta = false;
  }

  async function deleteSession(sessionId: string): Promise<void> {
    const confirmDelete = window.confirm("Session wirklich löschen? Dieser Schritt entfernt auch alle Channels.");
    if (!confirmDelete) return;
    try {
      await fetchJson<{ ok: boolean }>(`${apiUrl}/api/admin/sessions/${sessionId}`, { method: "DELETE" });
      if (selectedSessionId === sessionId) {
        goToAdminList();
      }
      await loadAdminSessions();
      setStatus("broadcaster", "Session gelöscht.");
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function createAdminSession(): Promise<void> {
    try {
      const data = await fetchJson<{ id: string; name: string; broadcastCode: string }>(`${apiUrl}/api/admin/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createSessionName,
          description: createSessionDescription || undefined,
          imageUrl: createSessionImageUrl || undefined
        })
      });

      sessionCode = data.broadcastCode;
      createSessionName = "";
      createSessionDescription = "";
      createSessionImageUrl = "";
      await loadAdminSessions();
      goToAdminSession(data.id);
      setStatus("broadcaster", "Session erstellt.");
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function saveSessionMeta(silent = false): Promise<void> {
    if (!selectedSessionId) return;
    if (
      sessionName === lastSavedSessionMeta.name &&
      sessionDescription === lastSavedSessionMeta.description &&
      sessionImageUrl === lastSavedSessionMeta.imageUrl
    ) {
      return;
    }
    try {
      await fetchJson(`${apiUrl}/api/admin/sessions/${selectedSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sessionName,
          description: sessionDescription,
          imageUrl: sessionImageUrl || null
        })
      });
      lastSavedSessionMeta = {
        name: sessionName,
        description: sessionDescription,
        imageUrl: sessionImageUrl
      };
      await loadAdminSessions();
      if (!silent) {
        setStatus("broadcaster", "Session gespeichert.");
      }
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  function scheduleAutoSaveSessionMeta(): void {
    if (!selectedSessionId || isHydratingSessionMeta) return;
    if (autoSaveSessionTimer) {
      clearTimeout(autoSaveSessionTimer);
    }
    autoSaveSessionTimer = setTimeout(() => {
      void saveSessionMeta(true);
    }, 550);
  }

  async function rotateSessionCode(): Promise<void> {
    if (!selectedSessionId) return;
    try {
      const data = await fetchJson<{ broadcastCode: string }>(`${apiUrl}/api/admin/sessions/${selectedSessionId}/rotate-code`, {
        method: "POST"
      });
      sessionCode = data.broadcastCode;
      setStatus("broadcaster", "Neuer 6-stelliger Token erzeugt.");
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function refreshSessionStats(): Promise<void> {
    if (!selectedSessionId) return;
    try {
      const data = await fetchJson<SessionStats & { liveChannelIds: string[] }>(
        `${apiUrl}/api/admin/sessions/${selectedSessionId}/stats`
      );
      sessionStats = data;
      adminLiveChannelIds = data.liveChannelIds ?? [];
    } catch {
      // Ignore background refresh errors
    }
  }

  async function createChannel(): Promise<void> {
    if (!selectedSessionId) return;

    try {
      const data = await fetchJson<Channel>(`${apiUrl}/api/sessions/${selectedSessionId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: channelName, languageCode: channelLanguage || undefined })
      });
      channels = [...channels, data];
      syncChannelAssignments(channels);
      await refreshSessionStats();
      setStatus("broadcaster", `Channel erstellt: ${data.name}`);
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function deleteChannel(channelId: string): Promise<void> {
    if (!selectedSessionId) return;
    const confirmDelete = window.confirm("Channel wirklich löschen?");
    if (!confirmDelete) return;

    try {
      await fetchJson<{ ok: boolean }>(`${apiUrl}/api/sessions/${selectedSessionId}/channels/${channelId}`, {
        method: "DELETE"
      });
      channels = channels.filter((channel) => channel.id !== channelId);
      adminLiveChannelIds = adminLiveChannelIds.filter((id) => id !== channelId);
      delete channelInputAssignments[channelId];
      delete channelDbLevels[channelId];
      channelInputAssignments = { ...channelInputAssignments };
      channelDbLevels = { ...channelDbLevels };
      await refreshSessionStats();
      setStatus("broadcaster", "Channel gelöscht.");
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function generateJoin(): Promise<void> {
    if (!selectedSessionId) {
      setStatus("broadcaster", "Bitte zuerst Session wählen.");
      return;
    }
    if (!sessionCode || !/^\d{6}$/.test(sessionCode.trim())) {
      setStatus("broadcaster", "6-stelligen Token setzen.");
      return;
    }

    try {
      const data = await fetchJson<{ joinUrl: string }>(`${apiUrl}/api/sessions/${selectedSessionId}/join-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinBaseUrl: joinBaseUrl.trim() || undefined,
          token: sessionCode.trim()
        })
      });

      joinUrl = data.joinUrl;
      joinQrDataUrl = await QRCode.toDataURL(joinUrl, {
        margin: 1,
        width: 360,
        color: { dark: "#0f172a", light: "#ffffff" }
      });
      setStatus("broadcaster", "QR erzeugt.");
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function startBroadcast(): Promise<void> {
    if (!selectedSessionId || !sessionCode) {
      setStatus("broadcaster", "Session und 6-stelliger Token erforderlich.");
      return;
    }
    if (isBroadcasting) {
      await stopBroadcast();
      return;
    }
    if (channels.length === 0) {
      setStatus("broadcaster", "Bitte mindestens einen Channel anlegen.");
      return;
    }
    stopLevelMeters();

    try {
      if (audioInputs.length === 0) {
        await refreshAudioInputs(true);
      }

      broadcasterSocket = io(wsUrl, {
        auth: {
          role: "BROADCASTER",
          sessionId: selectedSessionId,
          sessionCode
        }
      });

      await new Promise<void>((resolve, reject) => {
        broadcasterSocket?.once("connect", () => resolve());
        broadcasterSocket?.once("connect_error", (event) => reject(event));
      });

      const caps = await emitAck<{ rtpCapabilities: unknown }>(broadcasterSocket, "session:getRtpCapabilities", {});
      const device = new Device();
      await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });

      const produced: string[] = [];
      const failed: string[] = [];

      for (const channel of channels) {
        try {
          const selectedDeviceId = channelInputAssignments[channel.id] ?? "";
          const constraints: MediaTrackConstraints = selectedDeviceId
            ? {
                deviceId: { exact: selectedDeviceId },
                autoGainControl: true,
                noiseSuppression: true,
                echoCancellation: true
              }
            : { autoGainControl: true, noiseSuppression: true, echoCancellation: true };

          const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
          broadcasterMicStreams.push(stream);
          await attachLevelMeter(channel.id, stream);
          const track = stream.getAudioTracks()[0];

          const transportData = await emitAck<{
            transportId: string;
            iceParameters: unknown;
            iceCandidates: unknown[];
            dtlsParameters: unknown;
          }>(broadcasterSocket, "broadcaster:createTransport", { sessionId: selectedSessionId, channelId: channel.id });

          const sendTransport = device.createSendTransport({
            id: transportData.transportId,
            iceParameters: transportData.iceParameters as never,
            iceCandidates: transportData.iceCandidates as never,
            dtlsParameters: transportData.dtlsParameters as never,
            iceServers
          });

          sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
              await emitAck(broadcasterSocket!, "transport:connect", {
                transportId: transportData.transportId,
                dtlsParameters
              });
              callback();
            } catch (error) {
              errback(error as Error);
            }
          });

          sendTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
            try {
              const producerResponse = await emitAck<{ producerId: string }>(broadcasterSocket!, "broadcaster:produce", {
                transportId: transportData.transportId,
                sessionId: selectedSessionId,
                channelId: channel.id,
                kind,
                rtpParameters
              });
              callback({ id: producerResponse.producerId });
            } catch (error) {
              errback(error as Error);
            }
          });

          await sendTransport.produce({ track });
          produced.push(channel.name);
        } catch {
          failed.push(channel.name);
        }
      }

      if (produced.length === 0) throw new Error("Kein Kanal konnte gestartet werden.");
      isBroadcasting = true;
      setStatus(
        "broadcaster",
        failed.length > 0
          ? `Live auf ${produced.length} Kanal/Kanälen. Fehler bei: ${failed.join(", ")}`
          : `Live: ${produced.length} Kanal/Kanäle senden Audio`
      );
      await refreshSessionStats();
    } catch (error) {
      await stopBroadcast();
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function stopBroadcast(): Promise<void> {
    broadcasterSocket?.disconnect();
    broadcasterSocket = null;

    for (const stream of broadcasterMicStreams) {
      stream.getTracks().forEach((track) => track.stop());
    }
    broadcasterMicStreams = [];
    stopLevelMeters();

    isBroadcasting = false;
    setStatus("broadcaster", "Broadcast gestoppt");
    await refreshSessionStats();
  }

  async function validateJoin(): Promise<void> {
    try {
      const data = await fetchJson<JoinValidationResponse>(`${apiUrl}/api/join/validate-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: listenerCode.trim() })
      });

      listenerSessionId = data.session.id;
      listenerSessionName = data.session.name;
      listenerSessionDescription = data.session.description ?? "";
      listenerSessionImageUrl = data.session.imageUrl ?? "";
      listenerChannels = data.channels;
      listenerLiveChannelIds = data.liveChannelIds ?? [];
      selectedChannelId = data.channels[0]?.id ?? "";
      setStatus("listener", listenerChannels.length > 0 ? "Token validiert." : "Token validiert, aber keine aktiven Kanäle.");
    } catch (error) {
      setStatus("listener", `Fehler: ${(error as Error).message}`);
    }
  }

  async function enterWithToken(): Promise<void> {
    await validateJoin();
    if (!listenerSessionId) return;
    isQuickJoinMode = true;
    history.replaceState({}, "", `/?token=${encodeURIComponent(listenerCode.trim())}`);
  }

  async function refreshListenerLiveState(): Promise<void> {
    if (!listenerCode.trim()) return;
    try {
      const data = await fetchJson<{ sessionId: string; liveChannelIds: string[] }>(`${apiUrl}/api/join/live-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: listenerCode.trim() })
      });
      if (data.sessionId === listenerSessionId) {
        listenerLiveChannelIds = data.liveChannelIds;
      }
    } catch {
      // ignore
    }
  }

  async function stopListening(): Promise<void> {
    listenerSocket?.disconnect();
    listenerSocket = null;
    if (listenerAudio) {
      listenerAudio.pause();
      listenerAudio.srcObject = null;
    }
    isListening = false;
    activeListeningChannelId = "";
    setStatus("listener", "Audio gestoppt");
  }

  async function startListening(channelIdOverride?: string): Promise<void> {
    const targetChannelId = channelIdOverride ?? selectedChannelId;
    if (!targetChannelId) {
      setStatus("listener", "Bitte einen Kanal wählen.");
      return;
    }
    if (!listenerCode.trim()) {
      setStatus("listener", "6-stelligen Token eingeben.");
      return;
    }
    if (!listenerSessionId) {
      await validateJoin();
      if (!listenerSessionId) return;
    }

    if (isListening) await stopListening();

    try {
      listenerSocket = io(wsUrl, {
        auth: {
          role: "LISTENER",
          sessionCode: listenerCode.trim()
        }
      });

      await new Promise<void>((resolve, reject) => {
        listenerSocket?.once("connect", () => resolve());
        listenerSocket?.once("connect_error", (event) => reject(event));
      });

      const caps = await emitAck<{ rtpCapabilities: unknown }>(listenerSocket, "session:getRtpCapabilities", {});
      const device = new Device();
      await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });

      await emitAck(listenerSocket, "listener:joinSession", { channelId: targetChannelId });
      const transportData = await emitAck<{
        transportId: string;
        iceParameters: unknown;
        iceCandidates: unknown[];
        dtlsParameters: unknown;
      }>(listenerSocket, "listener:createTransport", { channelId: targetChannelId });

      const recvTransport = device.createRecvTransport({
        id: transportData.transportId,
        iceParameters: transportData.iceParameters as never,
        iceCandidates: transportData.iceCandidates as never,
        dtlsParameters: transportData.dtlsParameters as never,
        iceServers
      });

      recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
          await emitAck(listenerSocket!, "transport:connect", {
            transportId: transportData.transportId,
            dtlsParameters
          });
          callback();
        } catch (error) {
          errback(error as Error);
        }
      });

      const consumeData = await emitAck<{
        consumerId: string;
        producerId: string;
        kind: "audio";
        rtpParameters: unknown;
      }>(listenerSocket, "listener:consume", {
        transportId: transportData.transportId,
        sessionId: listenerSessionId,
        channelId: targetChannelId,
        rtpCapabilities: device.rtpCapabilities
      });

      const consumer = await recvTransport.consume({
        id: consumeData.consumerId,
        producerId: consumeData.producerId,
        kind: consumeData.kind,
        rtpParameters: consumeData.rtpParameters as never
      });

      const stream = new MediaStream([consumer.track]);
      listenerAudio.srcObject = stream;
      await listenerAudio.play();

      await emitAck(listenerSocket, "consumer:resume", { consumerId: consumeData.consumerId });
      isListening = true;
      activeListeningChannelId = targetChannelId;
      setStatus("listener", "Live: Audio empfangen");
    } catch (error) {
      await stopListening();
      setStatus("listener", `Fehler: ${(error as Error).message}`);
    }
  }

  async function toggleChannelPlayback(channelId: string): Promise<void> {
    if (isListening && activeListeningChannelId === channelId) {
      await stopListening();
      return;
    }
    await startListening(channelId);
  }

  async function copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  function downloadQr(): void {
    if (!joinQrDataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = joinQrDataUrl;
    anchor.download = `join-${selectedSessionId || "session"}.png`;
    anchor.click();
  }

  async function handleCreateImageUpload(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      createSessionImageUrl = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
    target.value = "";
  }

  async function handleEditImageUpload(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      sessionImageUrl = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
    target.value = "";
  }

  onMount(async () => {
    const savedTheme = localStorage.getItem("livevoice-theme") as "light" | "dark" | null;
    if (savedTheme === "light" || savedTheme === "dark") {
      applyTheme(savedTheme);
    } else {
      applyTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }

    syncRoute();
    window.addEventListener("popstate", syncRoute);

    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token")?.trim() ?? "";
    if (!isAdminRoute && tokenFromUrl) {
      listenerCode = tokenFromUrl;
      isQuickJoinMode = true;
      await validateJoin();
    }

    await refreshAudioInputs(false);

    try {
      const net = await fetchJson<{ suggestedJoinBaseUrl: string }>(`${apiUrl}/api/network`);
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        joinBaseUrl = net.suggestedJoinBaseUrl;
      } else {
        joinBaseUrl = `${window.location.protocol}//${window.location.hostname}:5173`;
      }
    } catch {
      joinBaseUrl = `${window.location.protocol}//${window.location.hostname}:5173`;
    }

    if (isAdminRoute) {
      await loadAdminSession();
      if (adminAuthenticated) {
        await loadAdminSessions();
        if (dashboardTab === "statistics") {
          await loadSessionAnalytics();
        }
        if (adminView === "detail" && selectedSessionId) {
          await loadSelectedSession();
        }
      }
    }

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", async () => {
        await refreshAudioInputs(false);
      });
    }

    const statsInterval = setInterval(() => {
      if (isAdminRoute && adminAuthenticated && adminView === "detail" && selectedSessionId) {
        void refreshSessionStats();
      }
      if (isAdminRoute && adminAuthenticated && adminView === "dashboard" && dashboardTab === "statistics") {
        void loadSessionAnalytics();
      }
      if (!isAdminRoute && listenerSessionId && listenerCode.trim()) {
        void refreshListenerLiveState();
      }
    }, 5000);

    return () => {
      window.removeEventListener("popstate", syncRoute);
      clearInterval(statsInterval);
      if (autoSaveSessionTimer) {
        clearTimeout(autoSaveSessionTimer);
      }
    };
  });

  $: if (isAdminRoute && adminAuthenticated && adminView === "detail" && selectedSessionId && !isHydratingSessionMeta) {
    sessionName;
    sessionDescription;
    sessionImageUrl;
    scheduleAutoSaveSessionMeta();
  }

  $: if (isAdminRoute && adminAuthenticated && adminView === "dashboard" && dashboardTab === "statistics" && analyticsSessionId) {
    analyticsSessionId;
    void loadSessionAnalytics();
  }
</script>

<main class="min-h-screen bg-[radial-gradient(circle_at_top,#f8fafc_0%,#eef2ff_45%,#e2e8f0_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_top,#0f172a_0%,#020617_70%)] dark:text-slate-100">
  <header class="border-b border-slate-200/70 bg-white/70 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
    <div class="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-4">
      <div class="flex items-center gap-3">
        <div class="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <img class="h-full w-full object-cover" src="/logo.svg" alt="Logo" />
        </div>  
        <button class="text-sm font-semibold hover:text-orange-500" onclick={goToDashboard}>Dashboard</button>
        {#if isAdminRoute}
          {#if adminView !== "dashboard" || dashboardTab === "sessions"}
            <div class="text-slate-400">›</div>
            <button class="text-sm font-semibold hover:text-orange-500" onclick={goToAdminList}>My Sessions</button>
          {/if}
          {#if adminView === "detail"}
            <div class="text-slate-400">›</div>
            <div class="text-sm font-semibold text-orange-500">{sessionName || "Session"}</div>
          {/if}
        {/if}
      </div>
      <button class="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800" onclick={toggleTheme}>
        {theme === "dark" ? "Light" : "Dark"}
      </button>
    </div>
  </header>

  <div class="mx-auto max-w-[1440px] px-6 py-8">
    {#if isAdminRoute}
      {#if !adminAuthenticated}
        <section class="mx-auto mt-12 max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
          <h2 class="text-2xl font-black">Admin Login</h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Nur mit Admin-Rechten kann eine Broadcast-Session erstellt werden.</p>
          <label for="admin-password" class="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Passwort</label>
          <input id="admin-password" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" type="password" bind:value={adminPassword} placeholder="Admin Passwort" />
          <button class="mt-4 w-full rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600" onclick={adminLogin}>Anmelden</button>
          <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">{adminStatus}</p>
        </section>
      {:else if adminView === "dashboard"}
        <section class="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside class="rounded-3xl border border-slate-200 bg-white/85 p-4 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/85 dark:shadow-black/30">
            <button class={`w-full rounded-xl px-4 py-2 text-left text-sm font-semibold ${dashboardTab === "sessions" ? "bg-orange-500 text-white" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`} onclick={() => (dashboardTab = "sessions")}>Meine Sessions</button>
            <button class={`mb-2 w-full rounded-xl px-4 py-2 text-left text-sm font-semibold ${dashboardTab === "statistics" ? "bg-orange-500 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`} onclick={() => (dashboardTab = "statistics")}>Statistiken</button>
            <button class={`mb-2 w-full rounded-xl px-4 py-2 text-left text-sm font-semibold ${dashboardTab === "users" ? "bg-orange-500 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`} onclick={() => (dashboardTab = "users")}>Nutzerverwaltung</button>
            <button class={`mb-2 w-full rounded-xl px-4 py-2 text-left text-sm font-semibold ${dashboardTab === "settings" ? "bg-orange-500 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`} onclick={() => (dashboardTab = "settings")}>Einstellungen</button>
            <button class="mt-4 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={adminLogout}>Logout</button>
            <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">{adminStatus}</p>
          </aside>

          <section>
            {#if dashboardTab === "statistics"}
              <div class="mb-4 flex flex-wrap items-center gap-2">
                <select class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" bind:value={analyticsSessionId}>
                  <option value="">Session wählen</option>
                  {#each adminSessions as s}
                    <option value={s.id}>{s.name}</option>
                  {/each}
                </select>
                <button class="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={loadSessionAnalytics}>Refresh</button>
                <button class="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 disabled:opacity-50" onclick={() => exportAnalytics("csv")} disabled={!sessionAnalytics}>Export CSV</button>
                <button class="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 disabled:opacity-50" onclick={() => exportAnalytics("json")} disabled={!sessionAnalytics}>Export JSON</button>
                <button class="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-red-50 dark:border-red-800 dark:text-slate-100 dark:hover:bg-red-900/20 disabled:opacity-50" onclick={clearAnalytics} disabled={!sessionAnalytics}>Statistiken leeren</button>
              </div>

              {#if sessionAnalytics}
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Live Listener</p><p class="mt-1 text-3xl font-black">{sessionAnalytics.live.totalListeners}</p></div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Peak Listener</p><p class="mt-1 text-3xl font-black">{sessionAnalytics.live.peakListeners}</p></div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Ø Hördauer</p><p class="mt-1 text-3xl font-black">{sessionAnalytics.postSession.averageListeningDurationSec.toFixed(0)}s</p></div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Join-Rate/min</p><p class="mt-1 text-3xl font-black">{sessionAnalytics.live.joinRatePerMin.toFixed(2)}</p></div>
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Leave-Rate/min</p><p class="mt-1 text-3xl font-black">{sessionAnalytics.live.leaveRatePerMin.toFixed(2)}</p></div>
                </div>

                <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 class="text-lg font-black">Listener pro Channel (Realtime-Graph)</h3>
                  <svg class="mt-3 h-48 w-full rounded-xl bg-slate-50 dark:bg-slate-800" viewBox="0 0 520 180" preserveAspectRatio="none">
                    <path d={linePath(sessionAnalytics.realtimeGraph.points.map((p) => p.total))} fill="none" stroke="#f97316" stroke-width="3"></path>
                  </svg>
                  <div class="mt-4 grid gap-2 sm:grid-cols-2">
                    {#each sessionAnalytics.live.listenersPerChannel as channel}
                      <div class="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <p class="text-sm font-semibold">{channel.name}</p>
                        <p class="text-xs text-slate-500">{channel.listeners} live</p>
                      </div>
                    {/each}
                  </div>
                </div>

                <div class="mt-4 grid gap-4 lg:grid-cols-2">
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 class="text-lg font-black">Heatmap (Joins nach Stunde)</h3>
                    <div class="mt-3 grid grid-cols-6 gap-2">
                      {#each sessionAnalytics.postSession.heatmap as hour}
                        <div class="rounded-lg p-2 text-center text-[11px] font-semibold text-slate-700 dark:text-slate-200" style={`background: rgba(249,115,22, ${Math.min(0.9, hour.joins / Math.max(1, ...sessionAnalytics.postSession.heatmap.map((h) => h.joins)))});`}>
                          <div>{hour.hour}:00</div>
                          <div>{hour.joins}</div>
                        </div>
                      {/each}
                    </div>
                  </div>

                  <div class="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 class="text-lg font-black">Channel-Vergleich</h3>
                    <div class="mt-3 overflow-auto">
                      <table class="min-w-full text-xs">
                        <thead>
                          <tr class="text-left text-slate-500">
                            <th class="py-1">Channel</th>
                            <th class="py-1">Joins</th>
                            <th class="py-1">Leaves</th>
                            <th class="py-1">Peak</th>
                            <th class="py-1">Ø Dauer</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each sessionAnalytics.postSession.channelComparison as row}
                            <tr class="border-t border-slate-200 dark:border-slate-700">
                              <td class="py-1 font-semibold">{row.name}</td>
                              <td class="py-1">{row.joins}</td>
                              <td class="py-1">{row.leaves}</td>
                              <td class="py-1">{row.peakListeners}</td>
                              <td class="py-1">{row.averageListeningDurationSec.toFixed(0)}s</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                    <p class="mt-2 text-[11px] text-slate-500">Gesamt Ø Dauer: {avg(sessionAnalytics.postSession.channelComparison, (c) => c.averageListeningDurationSec).toFixed(0)}s</p>
                  </div>
                </div>
                {#if analyticsStatus}
                  <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">{analyticsStatus}</p>
                {/if}
              {:else}
                <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  {analyticsStatus || "Keine Analytics verfügbar. Wähle eine Session."}
                </div>
              {/if}
            {:else if dashboardTab === "users"}
              <div class="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h3 class="text-xl font-black">Nutzerverwaltung</h3>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Admin-Passwort ändern</p>

                <label for="admin-current-password" class="mt-4 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Aktuelles Passwort</label>
                <input id="admin-current-password" type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" bind:value={adminCurrentPassword} />

                <label for="admin-new-password" class="mt-3 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Neues Passwort</label>
                <input id="admin-new-password" type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" bind:value={adminNewPassword} />

                <label for="admin-confirm-password" class="mt-3 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Bestätigung</label>
                <input id="admin-confirm-password" type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" bind:value={adminConfirmPassword} />

                <button class="mt-4 rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50" onclick={changeAdminPassword} disabled={!adminCurrentPassword || !adminNewPassword || adminNewPassword !== adminConfirmPassword}>
                  Passwort speichern
                </button>
              </div>
            {:else if dashboardTab === "sessions"}
              <section class="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
                <aside class="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/85 dark:shadow-black/30">
                  <h2 class="text-3xl font-black">My Sessions</h2>
                  <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Neue Session mit Bild und Beschreibung erstellen.</p>

                  <label for="create-session-name" class="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">Session Name</label>
                  <input id="create-session-name" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={createSessionName} placeholder="Sunday Service" />

                  <label for="create-session-description" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Beschreibung</label>
                  <textarea id="create-session-description" class="mt-2 min-h-[110px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={createSessionDescription} placeholder="Predigt, Übersetzung, Hinweise..."></textarea>

                  <label for="create-session-image" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Titelbild (URL oder Upload)</label>
                  <input id="create-session-image" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={createSessionImageUrl} placeholder="https://..." />
                  <input bind:this={createImageInputEl} class="hidden" type="file" accept="image/*" onchange={handleCreateImageUpload} />
                  <button class="mt-2 w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" onclick={() => createImageInputEl?.click()}>
                    Bild hochladen
                  </button>

                  {#if createSessionImageUrl}
                    <img class="mt-3 h-32 w-full rounded-xl object-cover" src={createSessionImageUrl} alt="Session preview" />
                  {/if}

                  <button class="mt-6 w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60" onclick={createAdminSession} disabled={!createSessionName.trim()}>
                    Session erstellen
                  </button>
                  <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">{broadcasterStatus}</p>
                </aside>

                <section>
                  <div class="mb-4 flex items-center justify-between">
                    <h3 class="text-2xl font-black">Bestehende Sessions</h3>
                    <button class="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={loadAdminSessions}>Aktualisieren</button>
                  </div>

                  {#if adminSessions.length === 0}
                    <div class="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                      Noch keine Sessions vorhanden.
                    </div>
                  {:else}
                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
                      {#each adminSessions as session}
                        <div class="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
                          <div class="h-28 w-full bg-slate-200 dark:bg-slate-800">
                            {#if session.imageUrl}
                              <img class="h-full w-full object-cover" src={session.imageUrl} alt={session.name} />
                            {/if}
                          </div>
                          <div class="p-4">
                            <div class="flex items-start justify-between gap-2">
                              <button class="truncate text-left text-lg font-bold group-hover:text-orange-500" onclick={() => goToAdminSession(session.id)}>{session.name}</button>
                              <button class="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20" onclick={() => deleteSession(session.id)}>Löschen</button>
                            </div>
                            <p class="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{session.description || "Keine Beschreibung"}</p>
                            <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                              <span class="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">{session.channelsCount} Channels</span>
                              <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{session.listenersConnected} Listener</span>
                              <span class="rounded-full bg-orange-100 px-2.5 py-1 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">{session.activeProducerChannels} Live</span>
                            </div>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </section>
              </section>
            {:else}
              <div class="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h3 class="text-xl font-black">Einstellungen</h3>
                <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Hier kannst du globale Dashboard-Einstellungen konfigurieren.</p>
                <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
                  Aktives Logo: <code>/logo.svg</code>
                </div>
              </div>
            {/if}
          </section>
        </section>
      {:else}
        <section class="space-y-6">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Listeners online</p><p class="mt-1 text-2xl font-black">{sessionStats.listenersConnected}</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Broadcaster online</p><p class="mt-1 text-2xl font-black">{sessionStats.broadcastersConnected}</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Active Producers</p><p class="mt-1 text-2xl font-black">{sessionStats.activeProducerChannels}</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Channels</p><p class="mt-1 text-2xl font-black">{sessionStats.channelsActive}/{sessionStats.channelsTotal}</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p class="text-xs text-slate-500">Joins (24h)</p><p class="mt-1 text-2xl font-black">{sessionStats.joinEvents24h}</p></div>
            <button class="rounded-2xl border border-slate-300 bg-white p-4 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800" onclick={refreshSessionStats}>Refresh Stats</button>
          </div>

          <div class="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside class="rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
              <div class="flex items-center justify-between">
                <h2 class="text-3xl font-black">Speak</h2>
                <button class="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={goToAdminList}>Back</button>
              </div>

              <label for="edit-session-name" class="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">Session Name</label>
              <input id="edit-session-name" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={sessionName} />

              <label for="edit-session-description" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Beschreibung</label>
              <textarea id="edit-session-description" class="mt-2 min-h-[90px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={sessionDescription}></textarea>

              <label for="edit-session-image" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Bild URL / Upload</label>
              <input id="edit-session-image" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={sessionImageUrl} />
              <input bind:this={editImageInputEl} class="hidden" type="file" accept="image/*" onchange={handleEditImageUpload} />
              <button class="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => editImageInputEl?.click()}>
                Bild hochladen
              </button>

              <label for="session-token" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">6-stelliger Token</label>
              <div class="mt-2 flex gap-2">
                <input id="session-token" class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={sessionCode} maxlength="6" />
                <button class="rounded-xl border border-slate-300 px-3 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={rotateSessionCode}>Neu</button>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-2">
                <button class="rounded-xl border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => refreshAudioInputs(false)}>Reload devices</button>
                <button class="rounded-xl border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => refreshAudioInputs(true)}>Enable mic</button>
              </div>

              <button class="mt-5 w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold hover:bg-orange-600 disabled:opacity-60" onclick={startBroadcast} disabled={!selectedSessionId || !sessionCode || channels.length === 0}>
                {isBroadcasting ? "Stop Broadcast" : "Start Broadcast"}
              </button>
              <button class="mt-2 w-full rounded-xl border border-red-300 px-4 py-2 text-sm text-slate-900 hover:bg-red-50 dark:border-red-800 dark:text-slate-100 dark:hover:bg-red-900/20" onclick={() => deleteSession(selectedSessionId)}>Session löschen</button>
              <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">{broadcasterStatus}</p>
            </aside>

            <section class="space-y-4">
              <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div class="h-44 w-full bg-slate-200 dark:bg-slate-800">
                  {#if sessionImageUrl}
                    <img class="h-full w-full object-cover" src={sessionImageUrl} alt={sessionName} />
                  {/if}
                </div>
                <div class="p-5">
                  <h3 class="text-3xl font-black">{sessionName || "Session"}</h3>
                  <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">{sessionDescription || "Keine Beschreibung"}</p>
                  <p class="mt-2 text-xs text-slate-400">Session-ID: {shortId(selectedSessionId)}</p>
                </div>
              </div>

              <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h4 class="text-lg font-bold">Channels</h4>
                <div class="mt-3 grid gap-2 sm:grid-cols-3">
                  <input class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={channelName} placeholder="Deutsch" />
                  <input class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={channelLanguage} placeholder="de / en" />
                  <button class="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600" onclick={createChannel}>Add channel</button>
                </div>

                <div class="mt-4 space-y-3">
                  {#if channels.length === 0}
                    <div class="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Noch keine Channels vorhanden.</div>
                  {:else}
                    {#each channels as channel}
                      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <div class="flex flex-wrap items-center gap-3">
                          <div class="min-w-[170px]">
                            <p class="font-semibold">{channel.name}</p>
                            <p class="text-xs text-orange-500">{channel.languageCode || "channel"}</p>
                            <p class={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${channelIsLive(channel.id, "admin") ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                              {channelIsLive(channel.id, "admin") ? "LIVE" : "OFFLINE"}
                            </p>
                          </div>
                          <select class="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={channelInputAssignments[channel.id]}>
                            <option value="">Standardgerät</option>
                            {#each audioInputs as input}
                              <option value={input.deviceId}>{input.label}</option>
                            {/each}
                          </select>
                          <button class="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20" onclick={() => deleteChannel(channel.id)}>
                            Delete
                          </button>
                        </div>
                        <div class="mt-3">
                          <div class="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            <span>Input Level</span>
                            <span>{channelDbLevels[channel.id] ?? -60} dB</span>
                          </div>
                          <div class="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                            <div
                              class={`h-full transition-[width] duration-100 ${meterBarClass(channelDbLevels[channel.id] ?? -60)}`}
                              style={`width: ${channelDbToPercent(channelDbLevels[channel.id] ?? -60)}%`}
                            ></div>
                          </div>
                        </div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </article>

              <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h4 class="text-lg font-bold">Join & QR</h4>
                <label for="join-base-url" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Join Base URL</label>
                <input id="join-base-url" class="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={joinBaseUrl} />

                <div class="mt-3 flex flex-wrap gap-2">
                  <button class="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600" onclick={generateJoin}>Generate QR</button>
                  {#if joinUrl}
                    <button class="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => copy(joinUrl)}>Copy link</button>
                    <button class="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={downloadQr}>Download QR</button>
                  {/if}
                </div>

                {#if joinUrl}
                  <p class="mt-3 break-all rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800">{joinUrl}</p>
                {/if}
                {#if joinQrDataUrl}
                  <img class="mt-4 w-44 rounded-xl border border-slate-200 dark:border-slate-700" src={joinQrDataUrl} alt="Join QR" />
                {/if}
              </article>
            </section>
          </div>
        </section>
      {/if}
    {:else}
      {#if isQuickJoinMode}
        <section class="mx-auto max-w-5xl">
          <article class="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900/85">
            {#if listenerSessionImageUrl}
              <img class="mb-4 h-48 w-full rounded-2xl object-cover" src={listenerSessionImageUrl} alt={listenerSessionName} />
            {/if}
            <h2 class="text-4xl font-black">{listenerSessionName || "Session"}</h2>
            {#if listenerSessionDescription}
              <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{listenerSessionDescription}</p>
            {/if}

            <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {#each listenerChannels as channel}
                <button
                  class={`rounded-2xl border p-5 text-left transition ${
                    activeListeningChannelId === channel.id
                      ? "border-orange-400 bg-orange-50 dark:border-orange-500 dark:bg-orange-900/20"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600"
                  }`}
                  onclick={() => toggleChannelPlayback(channel.id)}
                >
                  <div class="flex items-center justify-between">
                    <p class="text-lg font-bold">{channel.name}</p>
                    <span
                      class={`grid h-12 w-12 place-items-center rounded-full text-xl ${
                        activeListeningChannelId === channel.id && isListening
                          ? "bg-orange-500 text-white"
                          : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
                      }`}
                      onclick={(event) => {
                        event.stopPropagation();
                        void toggleChannelPlayback(channel.id);
                      }}
                      role="button"
                      tabindex="0"
                      onkeydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void toggleChannelPlayback(channel.id);
                        }
                      }}
                      aria-label={activeListeningChannelId === channel.id && isListening ? "Pause" : "Play"}
                    >
                      {#if activeListeningChannelId === channel.id && isListening}
                        <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
                          <rect x="6.5" y="5" width="4.5" height="14" rx="1.5" fill="currentColor"></rect>
                          <rect x="13" y="5" width="4.5" height="14" rx="1.5" fill="currentColor"></rect>
                        </svg>
                      {:else}
                        <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
                          <path d="M8 5.5L18.5 12L8 18.5V5.5Z" fill="currentColor"></path>
                        </svg>
                      {/if}
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{channel.languageCode || "audio channel"}</p>
                  <p class={`mt-4 text-xs font-semibold ${channelIsLive(channel.id, "listener") ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>
                    {channelIsLive(channel.id, "listener") ? "LIVE" : "OFFLINE"}
                  </p>
                </button>
              {/each}
            </div>

            <audio bind:this={listenerAudio} class="hidden" controls></audio>
            <p class="mt-4 text-xs text-slate-500 dark:text-slate-400">{listenerStatus}</p>
          </article>
        </section>
      {:else}
        <section class="mx-auto mt-12 max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
          <h2 class="text-3xl font-black">Join Session</h2>
          <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Gib nur den 6-stelligen Token ein.</p>

          <label for="listener-token" class="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">6-stelliger Token</label>
          <input id="listener-token" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" bind:value={listenerCode} maxlength="6" placeholder="123456" />

          <button class="mt-4 w-full rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60" onclick={enterWithToken} disabled={!/^\d{6}$/.test(listenerCode.trim())}>
            Weiter
          </button>
          <p class="mt-3 text-xs text-slate-500 dark:text-slate-400">{listenerStatus}</p>
        </section>
      {/if}
    {/if}
  </div>
</main>
