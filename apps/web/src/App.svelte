<script lang="ts">
  import { onMount } from "svelte";
  import { io, type Socket } from "socket.io-client";
  import { Device } from "mediasoup-client";
  import QRCode from "qrcode";

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

  const apiUrl = runtimeApiUrl();
  const wsUrl = runtimeWsUrl();

  type Channel = { id: string; name: string; languageCode?: string | null };
  type JoinValidationResponse = {
    joinJwt: string;
    session: { id: string; name: string };
    channels: Channel[];
  };

  type AudioInput = { deviceId: string; label: string };

  let activeView: "broadcaster" | "listener" = "broadcaster";
  let theme: "light" | "dark" = "light";

  let sessionName = "Sunday Service";
  let sessionId = "";
  let channelName = "Deutsch";
  let channelLanguage = "de";
  let channels: Channel[] = [];
  let selectedBroadcasterChannelId = "";
  let joinScope: "session" | "channel" = "session";
  let includePinInJoinUrl = true;

  let joinUrl = "";
  let joinQrDataUrl = "";
  let pin = "";
  let joinBaseUrl = "";

  let audioInputs: AudioInput[] = [];
  let selectedAudioInputId = "";

  let broadcasterStatus = "Bereit";
  let isBroadcasting = false;

  let listenerToken = "";
  let listenerPin = "";
  let listenerJwt = "";
  let listenerSessionId = "";
  let listenerSessionName = "";
  let listenerChannels: Channel[] = [];
  let selectedChannelId = "";
  let listenerStatus = "Bereit";
  let isListening = false;

  let listenerAudio: HTMLAudioElement;
  let broadcasterSocket: Socket | null = null;
  let listenerSocket: Socket | null = null;
  let broadcasterMicStream: MediaStream | null = null;

  function setStatus(type: "broadcaster" | "listener", message: string): void {
    if (type === "broadcaster") broadcasterStatus = message;
    else listenerStatus = message;
  }

  function shortId(value: string): string {
    if (!value) return "-";
    return value.length > 14 ? `${value.slice(0, 7)}...${value.slice(-5)}` : value;
  }

  function getJoinTokenFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get("token") ?? "";
    } catch {
      return "";
    }
  }

  function normalizeJoinToken(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.includes("://") || trimmed.startsWith("http")) {
      const fromUrl = getJoinTokenFromUrl(trimmed);
      return fromUrl || trimmed;
    }
    return trimmed;
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

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error ?? "Request failed");
    return body as T;
  }

  async function copy(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  function applyTheme(nextTheme: "light" | "dark"): void {
    theme = nextTheme;
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    localStorage.setItem("livevoice-theme", nextTheme);
  }

  function toggleTheme(): void {
    applyTheme(theme === "dark" ? "light" : "dark");
  }

  function downloadQr(): void {
    if (!joinQrDataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = joinQrDataUrl;
    anchor.download = `join-${sessionId || "session"}.png`;
    anchor.click();
  }

  async function refreshChannels(): Promise<void> {
    if (!sessionId) return;
    const data = await fetchJson<Channel[]>(`${apiUrl}/api/sessions/${sessionId}/channels`);
    channels = data;
    if (!selectedBroadcasterChannelId && data.length > 0) {
      selectedBroadcasterChannelId = data[0].id;
    }
  }

  async function refreshAudioInputs(requestPermission = false): Promise<void> {
    try {
      if (requestPermission) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        permissionStream.getTracks().forEach((track) => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio Input ${index + 1}`
        }));

      if (audioInputs.length > 0) {
        const selectedStillExists = audioInputs.some((item) => item.deviceId === selectedAudioInputId);
        if (!selectedStillExists) {
          selectedAudioInputId = audioInputs[0].deviceId;
        }
      } else {
        selectedAudioInputId = "";
      }
    } catch (error) {
      setStatus("broadcaster", `Audio-Geräte Fehler: ${(error as Error).message}`);
    }
  }

  async function createSession(): Promise<void> {
    try {
      const data = await fetchJson<{ id: string }>(`${apiUrl}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: sessionName })
      });

      sessionId = data.id;
      channels = [];
      selectedBroadcasterChannelId = "";
      joinUrl = "";
      joinQrDataUrl = "";
      pin = "";

      setStatus("broadcaster", `Session erstellt: ${data.id}`);
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function createChannel(): Promise<void> {
    if (!sessionId) return;

    try {
      const data = await fetchJson<Channel>(`${apiUrl}/api/sessions/${sessionId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: channelName, languageCode: channelLanguage || undefined })
      });

      channels = [...channels, data];
      selectedBroadcasterChannelId = data.id;
      setStatus("broadcaster", `Channel erstellt: ${data.name}`);
    } catch (error) {
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function generateJoin(): Promise<void> {
    if (!sessionId) {
      setStatus("broadcaster", "Bitte zuerst eine Session anlegen.");
      return;
    }

    if (joinScope === "channel" && !selectedBroadcasterChannelId) {
      setStatus("broadcaster", "Für Kanal-Token bitte einen Channel wählen.");
      return;
    }

    try {
      const data = await fetchJson<{ joinUrl: string; pin: string }>(`${apiUrl}/api/sessions/${sessionId}/join-tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: joinScope === "channel" ? selectedBroadcasterChannelId : undefined,
          includePinInUrl: includePinInJoinUrl,
          joinBaseUrl: joinBaseUrl.trim() || undefined
        })
      });

      joinUrl = data.joinUrl;
      pin = data.pin;
      joinQrDataUrl = await QRCode.toDataURL(joinUrl, {
        margin: 1,
        width: 380,
        color: { dark: "#0f172a", light: "#ffffff" }
      });

      setStatus(
        "broadcaster",
        joinScope === "session"
          ? "QR-Code + Join-Link erstellt (alle Kanäle auswählbar)"
          : "QR-Code + Join-Link erstellt (auf einen Kanal beschränkt)"
      );
    } catch (error) {
      setStatus("broadcaster", `Fehler beim QR erstellen: ${(error as Error).message}`);
    }
  }

  async function stopBroadcast(): Promise<void> {
    broadcasterSocket?.disconnect();
    broadcasterSocket = null;

    if (broadcasterMicStream) {
      broadcasterMicStream.getTracks().forEach((track) => track.stop());
      broadcasterMicStream = null;
    }

    isBroadcasting = false;
    setStatus("broadcaster", "Broadcast gestoppt");
  }

  async function startBroadcast(): Promise<void> {
    if (!sessionId || !selectedBroadcasterChannelId) {
      setStatus("broadcaster", "Bitte zuerst Session + Channel anlegen.");
      return;
    }

    if (isBroadcasting) {
      await stopBroadcast();
    }

    try {
      if (!selectedAudioInputId) {
        await refreshAudioInputs(true);
      }

      setStatus("broadcaster", "Verbinde Broadcaster...");
      const tokenData = await fetchJson<{ token: string }>(`${apiUrl}/api/sessions/${sessionId}/broadcaster-token`, {
        method: "POST"
      });

      broadcasterSocket = io(wsUrl, { auth: { token: tokenData.token } });
      await new Promise<void>((resolve, reject) => {
        broadcasterSocket?.once("connect", () => resolve());
        broadcasterSocket?.once("connect_error", (event) => reject(event));
      });

      const caps = await emitAck<{ rtpCapabilities: unknown }>(broadcasterSocket, "session:getRtpCapabilities", {});
      const device = new Device();
      await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });

      const audioConstraints: MediaTrackConstraints = selectedAudioInputId
        ? {
            deviceId: { exact: selectedAudioInputId },
            autoGainControl: true,
            noiseSuppression: true,
            echoCancellation: true
          }
        : { autoGainControl: true, noiseSuppression: true, echoCancellation: true };

      broadcasterMicStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });

      const track = broadcasterMicStream.getAudioTracks()[0];

      const transportData = await emitAck<{
        transportId: string;
        iceParameters: unknown;
        iceCandidates: unknown[];
        dtlsParameters: unknown;
      }>(broadcasterSocket, "broadcaster:createTransport", {
        sessionId,
        channelId: selectedBroadcasterChannelId
      });

      const sendTransport = device.createSendTransport({
        id: transportData.transportId,
        iceParameters: transportData.iceParameters as never,
        iceCandidates: transportData.iceCandidates as never,
        dtlsParameters: transportData.dtlsParameters as never
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
            sessionId,
            channelId: selectedBroadcasterChannelId,
            kind,
            rtpParameters
          });
          callback({ id: producerResponse.producerId });
        } catch (error) {
          errback(error as Error);
        }
      });

      await sendTransport.produce({ track });
      isBroadcasting = true;
      setStatus("broadcaster", "Live: Audio wird gesendet");
    } catch (error) {
      await stopBroadcast();
      setStatus("broadcaster", `Fehler: ${(error as Error).message}`);
    }
  }

  async function validateJoin(): Promise<void> {
    try {
      const normalizedToken = normalizeJoinToken(listenerToken);
      listenerToken = normalizedToken;
      const data = await fetchJson<JoinValidationResponse>(`${apiUrl}/api/join/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: normalizedToken, pin: listenerPin.trim() })
      });

      listenerJwt = data.joinJwt;
      listenerSessionId = data.session.id;
      listenerSessionName = data.session.name;
      listenerChannels = data.channels;

      if (listenerChannels.length === 0) {
        const fallbackChannels = await fetchJson<Channel[]>(`${apiUrl}/api/sessions/${data.session.id}/channels`);
        listenerChannels = fallbackChannels;
      }

      selectedChannelId = listenerChannels[0]?.id ?? "";
      if (listenerChannels.length === 0) {
        setStatus("listener", "Join validiert, aber keine aktiven Kanäle gefunden.");
      } else {
        setStatus("listener", "Join validiert. Kanal wählen und Start drücken.");
      }
    } catch (error) {
      setStatus("listener", `Fehler: ${(error as Error).message}`);
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
    setStatus("listener", "Audio gestoppt");
  }

  async function startListening(): Promise<void> {
    if (!listenerJwt || !selectedChannelId) {
      setStatus("listener", "Bitte Join validieren und Kanal wählen.");
      return;
    }

    if (isListening) {
      await stopListening();
    }

    try {
      setStatus("listener", "Verbinde Listener...");
      listenerSocket = io(wsUrl, { auth: { token: listenerJwt } });

      await new Promise<void>((resolve, reject) => {
        listenerSocket?.once("connect", () => resolve());
        listenerSocket?.once("connect_error", (event) => reject(event));
      });

      const caps = await emitAck<{ rtpCapabilities: unknown }>(listenerSocket, "session:getRtpCapabilities", {});
      const device = new Device();
      await device.load({ routerRtpCapabilities: caps.rtpCapabilities as never });

      await emitAck(listenerSocket, "listener:joinSession", { channelId: selectedChannelId });

      const transportData = await emitAck<{
        transportId: string;
        iceParameters: unknown;
        iceCandidates: unknown[];
        dtlsParameters: unknown;
      }>(listenerSocket, "listener:createTransport", { channelId: selectedChannelId });

      const recvTransport = device.createRecvTransport({
        id: transportData.transportId,
        iceParameters: transportData.iceParameters as never,
        iceCandidates: transportData.iceCandidates as never,
        dtlsParameters: transportData.dtlsParameters as never
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
        channelId: selectedChannelId,
        rtpCapabilities: device.rtpCapabilities
      });

      const consumer = await recvTransport.consume({
        id: consumeData.consumerId,
        producerId: consumeData.producerId,
        kind: consumeData.kind,
        rtpParameters: consumeData.rtpParameters as never
      });

      const mediaStream = new MediaStream([consumer.track]);
      listenerAudio.srcObject = mediaStream;
      await listenerAudio.play();

      await emitAck(listenerSocket, "consumer:resume", { consumerId: consumeData.consumerId });
      isListening = true;
      setStatus("listener", "Live: Audio empfangen");
    } catch (error) {
      await stopListening();
      setStatus("listener", `Fehler: ${(error as Error).message}`);
    }
  }

  onMount(async () => {
    const savedTheme = localStorage.getItem("livevoice-theme") as "light" | "dark" | null;
    if (savedTheme === "light" || savedTheme === "dark") {
      applyTheme(savedTheme);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyTheme(prefersDark ? "dark" : "light");
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const pinFromUrl = params.get("pin");

    if (token) {
      listenerToken = token;
      activeView = "listener";
    }

    if (pinFromUrl) {
      listenerPin = pinFromUrl;
    }

    await refreshAudioInputs(false);

    if (!joinBaseUrl) {
      try {
        const currentHost = window.location.hostname;
        if (currentHost && currentHost !== "localhost" && currentHost !== "127.0.0.1") {
          joinBaseUrl = `${window.location.protocol}//${currentHost}:5173`;
        } else {
          const net = await fetchJson<{ suggestedJoinBaseUrl: string }>(`${apiUrl}/api/network`);
          joinBaseUrl = net.suggestedJoinBaseUrl;
        }
      } catch {
        // Keep manual input fallback.
      }
    }

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", async () => {
        await refreshAudioInputs(false);
      });
    }
  });
</script>

<main class="relative min-h-screen overflow-hidden px-4 py-8 md:px-10">
  <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(15,118,110,0.15),transparent_50%),radial-gradient(circle_at_80%_20%,rgba(217,119,6,0.12),transparent_45%)]"></div>

  <div class="relative mx-auto max-w-7xl">
    <section class="mb-8 rounded-3xl border border-white/30 bg-gradient-to-r from-slate-900 via-cyan-900 to-teal-700 p-6 text-white shadow-soft md:p-8">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-[0.22em] text-cyan-200">Realtime Audio Platform</p>
          <h1 class="mt-2 text-3xl font-semibold md:text-4xl">Broadcast + Listener Console</h1>
          <p class="mt-2 max-w-2xl text-sm text-cyan-100 md:text-base">
            Session erstellen, Audio-Eingang wählen, QR-Code erzeugen und mit PIN live in den Kanal joinen.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-white backdrop-blur hover:bg-white dark:hover:bg-slate-800/20"
            onclick={toggleTheme}
          >{theme === "dark" ? "Light Mode" : "Dark Mode"}</button>
          <div class="inline-flex rounded-xl bg-white/10 p-1 text-sm backdrop-blur">
          <button
            class={`rounded-lg px-4 py-2 transition ${activeView === "broadcaster" ? "bg-white text-slate-900" : "text-cyan-100 hover:bg-white dark:hover:bg-slate-800/20"}`}
            onclick={() => (activeView = "broadcaster")}
          >Broadcaster</button>
          <button
            class={`rounded-lg px-4 py-2 transition ${activeView === "listener" ? "bg-white text-slate-900" : "text-cyan-100 hover:bg-white dark:hover:bg-slate-800/20"}`}
            onclick={() => (activeView = "listener")}
          >Listener</button>
          </div>
        </div>
      </div>
    </section>

    {#if activeView === "broadcaster"}
      <section class="grid gap-6 xl:grid-cols-3">
        <article class="rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5 shadow-soft">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Schritt 1</p>
          <h2 class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Session & Channel</h2>

          <label for="sessionName" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">Session Name</label>
          <input id="sessionName" class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2" bind:value={sessionName} />
          <button class="mt-3 w-full rounded-xl bg-teal-700 px-4 py-2.5 text-white hover:bg-teal-800" onclick={createSession}>Session erstellen</button>

          <label for="channelName" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">Channel Name</label>
          <input id="channelName" class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2" bind:value={channelName} />

          <label for="channelLanguage" class="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-300">Sprache</label>
          <input id="channelLanguage" class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2" bind:value={channelLanguage} placeholder="de / en" />

          <button
            class="mt-3 w-full rounded-xl bg-teal-700 px-4 py-2.5 text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onclick={createChannel}
            disabled={!sessionId}
          >Channel erstellen</button>

          <button
            class="mt-2 w-full rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500"
            onclick={refreshChannels}
            disabled={!sessionId}
          >Channels neu laden</button>

          <div class="mt-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs text-slate-600 dark:text-slate-400">
            <p><span class="font-semibold">Session:</span> {shortId(sessionId)}</p>
            <p class="mt-1"><span class="font-semibold">Aktiver Channel:</span> {shortId(selectedBroadcasterChannelId)}</p>
          </div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5 shadow-soft">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Schritt 2</p>
          <h2 class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">Audio Eingang</h2>

          <label for="selectedChannel" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">Broadcast Channel</label>
          <select
            id="selectedChannel"
            class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2"
            bind:value={selectedBroadcasterChannelId}
          >
            <option value="">Bitte wählen</option>
            {#each channels as channel}
              <option value={channel.id}>{channel.name} {channel.languageCode ? `(${channel.languageCode})` : ""}</option>
            {/each}
          </select>

          <label for="audioInput" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">Audio Input Gerät</label>
          <select
            id="audioInput"
            class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2"
            bind:value={selectedAudioInputId}
          >
            <option value="">Standardgerät</option>
            {#each audioInputs as input}
              <option value={input.deviceId}>{input.label}</option>
            {/each}
          </select>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <button class="rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/60" onclick={() => refreshAudioInputs(false)}>Geräte neu laden</button>
            <button class="rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/60" onclick={() => refreshAudioInputs(true)}>Mikro freigeben</button>
          </div>

          <div class="mt-4 rounded-2xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-900 dark:text-amber-200">
            <p class="font-semibold">Hinweis</p>
            <p class="mt-1">Ohne Browser-Freigabe werden Gerätelabels oft nicht angezeigt. Klick auf "Mikro freigeben" löst das.</p>
          </div>

          <div class="mt-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3 text-sm text-teal-800">{broadcasterStatus}</div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-5 shadow-soft">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Schritt 3</p>
          <h2 class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">QR & Live</h2>

          <label for="joinScope" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">Token-Bereich</label>
          <select
            id="joinScope"
            class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2"
            bind:value={joinScope}
          >
            <option value="session">Alle Kanäle (Client kann wählen)</option>
            <option value="channel">Nur ausgewählter Kanal</option>
          </select>

          <label for="joinBaseUrl" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">Join Base URL (für QR)</label>
          <input
            id="joinBaseUrl"
            class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2"
            bind:value={joinBaseUrl}
            placeholder="http://192.168.1.23:5173"
          />

          <label class="mt-4 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" bind:checked={includePinInJoinUrl} class="h-4 w-4 rounded border-slate-300" />
            PIN direkt in Join-URL einbetten
          </label>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <button
              class="rounded-xl bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              onclick={generateJoin}
              disabled={!sessionId || (joinScope === "channel" && !selectedBroadcasterChannelId)}
            >QR erzeugen</button>
            <button
              class="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-300"
              onclick={startBroadcast}
              disabled={!sessionId || !selectedBroadcasterChannelId}
            >Broadcast starten</button>
          </div>

          <button
            class="mt-2 w-full rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500"
            onclick={stopBroadcast}
            disabled={!isBroadcasting}
          >Broadcast stoppen</button>

          {#if joinUrl}
            <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/60 p-3">
              <p class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Join-Daten</p>
              <p class="mt-2 break-all text-xs text-slate-700 dark:text-slate-300">{joinUrl}</p>
              <p class="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200">PIN: {pin}</p>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button class="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-slate-800" onclick={() => copy(joinUrl)}>Link kopieren</button>
                <button class="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-slate-800" onclick={() => copy(pin)}>PIN kopieren</button>
                <button class="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-slate-800" onclick={downloadQr}>QR Download</button>
                <button
                  class="rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs hover:bg-white dark:hover:bg-slate-800"
                  onclick={() => {
                    listenerToken = getJoinTokenFromUrl(joinUrl);
                    listenerPin = pin;
                    activeView = "listener";
                  }}
                >Listener füllen</button>
              </div>
            </div>
          {/if}

          {#if joinQrDataUrl}
            <div class="mt-4 rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-3">
              <img class="mx-auto w-48 rounded-xl border border-slate-200" src={joinQrDataUrl} alt="Join QR" />
            </div>
          {/if}
        </article>
      </section>
    {:else}
      <section class="grid gap-6 lg:grid-cols-2">
        <article class="rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-6 shadow-soft">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Listener Join</p>
          <h2 class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Token + PIN</h2>

          <label for="listenerToken" class="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-300">Token</label>
          <input id="listenerToken" class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2" bind:value={listenerToken} placeholder="Token oder komplette Join-URL" />

          <label for="listenerPin" class="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-300">PIN</label>
          <input id="listenerPin" class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2" bind:value={listenerPin} maxlength="6" placeholder="123456" />

          <button class="mt-4 w-full rounded-xl bg-teal-700 px-4 py-2.5 text-white hover:bg-teal-800" onclick={validateJoin}>Join validieren</button>

          <div class="mt-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3 text-sm text-slate-700 dark:text-slate-300">
            <p><span class="font-semibold">Session:</span> {listenerSessionName || "-"}</p>
            <p class="mt-1"><span class="font-semibold">Status:</span> {listenerStatus}</p>
          </div>
        </article>

        <article class="rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-6 shadow-soft">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Playback</p>
          <h2 class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">Kanal hören</h2>

          <label for="selectedChannelId" class="mt-5 block text-sm font-medium text-slate-700 dark:text-slate-300">Verfügbare Channels</label>
          <select id="selectedChannelId" class="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 px-3 py-2" bind:value={selectedChannelId}>
            <option value="">Bitte wählen</option>
            {#each listenerChannels as channel}
              <option value={channel.id}>{channel.name} {channel.languageCode ? `(${channel.languageCode})` : ""}</option>
            {/each}
          </select>

          <div class="mt-4 grid grid-cols-2 gap-2">
            <button
              class="rounded-xl bg-slate-900 px-4 py-2.5 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-300"
              onclick={startListening}
              disabled={!listenerJwt || !selectedChannelId}
            >Audio starten</button>
            <button
              class="rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-800/60 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500"
              onclick={stopListening}
              disabled={!isListening}
            >Audio stoppen</button>
          </div>

          <audio bind:this={listenerAudio} class="mt-5 w-full" controls></audio>

          <p class="mt-4 text-xs text-slate-500 dark:text-slate-400">Session ID: {shortId(listenerSessionId)}</p>
        </article>
      </section>
    {/if}
  </div>
</main>
