<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { t } from "../../i18n";
  import { app } from "../../stores/app";
  import { apiUrl } from "../../lib/config";
  import { shortId } from "../../lib/format";
  import { channelDbToPercent, channelIsLive, meterBarClass } from "../../controllers/channels";
  import { deleteSession } from "../../controllers/admin/sessions";
  import { setSessionUserAssignment } from "../../controllers/admin/users";
  import { refreshAudioInputs } from "../../controllers/broadcaster/audioInputs";
  import { startBroadcast, stopBroadcast } from "../../controllers/broadcaster/broadcast";
  import { createChannel, deleteChannel, rotateSessionCode } from "../../controllers/sessionDetail/channels";
  import { downloadQr, printQrCard } from "../../controllers/sessionDetail";
  import { handleEditImageUpload } from "../../controllers/images";
  import { copy } from "../../controllers/clipboard";
  import { deleteRecording, startRecording, stopRecording } from "../../controllers/recording";
  import { refreshSessionStats } from "../../controllers/sessionDetail/stats";
  import DropdownSelect from "../ui/DropdownSelect.svelte";

  type SpeakPanel = "live" | "recordings" | "edit";

  let speakPanel: SpeakPanel = "live";
  let isMobileOnePager = false;
  let mobileMediaQuery: MediaQueryList | null = null;
  let mobileMediaQueryListener: ((event: MediaQueryListEvent) => void) | null = null;
  $: isLiveOnAir = $app.isBroadcasting || $app.isPreshowMusicActive || $app.isTestToneActive;
  let isSwitchingLive = false;

  $: broadcastOccupiedByOther = $app.broadcastOccupiedByOther && !$app.isBroadcasting;
  $: ownerStartedAtLabel = $app.broadcastOwnerStartedAt ? new Date($app.broadcastOwnerStartedAt).toLocaleString() : "-";

  let micPreviewDb = -60;
  let micPreviewPercent = 0;
  let micPreviewAnimationId: number | null = null;
  let micPreviewAudioContext: AudioContext | null = null;
  let micPreviewAnalyser: AnalyserNode | null = null;
  let micPreviewSource: MediaStreamAudioSourceNode | null = null;
  let micPreviewStream: MediaStream | null = null;
  let micPreviewDataArray: Uint8Array | null = null;
  let micPreviewToken = 0;
  let micPreviewKey = "";

  $: micPreviewPercent = Math.max(0, Math.min(100, channelDbToPercent(micPreviewDb)));
  $: previewDeviceId = $app.channels[0]?.id ? ($app.channelInputAssignments[$app.channels[0].id] || "") : "";
  $: {
    const nextKey = `${speakPanel}|${$app.isBroadcasting}|${$app.isPreshowMusicActive}|${$app.isTestToneActive}|${previewDeviceId}|${$app.selectedSessionId}`;
    if (nextKey !== micPreviewKey) {
      micPreviewKey = nextKey;
      if (speakPanel === "live" && !isLiveOnAir) {
        void startMicPreview(previewDeviceId);
      } else {
        stopMicPreview();
      }
    }
  }

  function stopMicPreview(): void {
    micPreviewToken += 1;
    if (micPreviewAnimationId !== null) {
      cancelAnimationFrame(micPreviewAnimationId);
      micPreviewAnimationId = null;
    }
    try {
      micPreviewSource?.disconnect();
    } catch {
      // ignore cleanup error
    }
    micPreviewSource = null;
    micPreviewAnalyser = null;
    micPreviewDataArray = null;
    if (micPreviewStream) {
      for (const track of micPreviewStream.getTracks()) track.stop();
    }
    micPreviewStream = null;
    if (micPreviewAudioContext) {
      void micPreviewAudioContext.close();
    }
    micPreviewAudioContext = null;
    micPreviewDb = -60;
  }

  async function startMicPreview(deviceId: string): Promise<void> {
    stopMicPreview();
    if (!navigator.mediaDevices?.getUserMedia) return;

    const token = micPreviewToken + 1;
    micPreviewToken = token;

    try {
      const constraints: MediaTrackConstraints = deviceId
        ? { deviceId: { exact: deviceId }, autoGainControl: true, noiseSuppression: true, echoCancellation: true }
        : { autoGainControl: true, noiseSuppression: true, echoCancellation: true };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      if (token !== micPreviewToken) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      micPreviewStream = stream;
      const ctx = new AudioContext();
      micPreviewAudioContext = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      const dataArray = new Uint8Array(analyser.fftSize);
      source.connect(analyser);

      micPreviewSource = source;
      micPreviewAnalyser = analyser;
      micPreviewDataArray = dataArray;

      const tick = () => {
        if (!micPreviewAnalyser || !micPreviewDataArray) return;
        micPreviewAnalyser.getByteTimeDomainData(micPreviewDataArray);
        let sum = 0;
        for (const value of micPreviewDataArray) {
          const normalized = (value - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / micPreviewDataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        micPreviewDb = Number(Math.max(-60, Math.min(0, db)).toFixed(1));
        micPreviewAnimationId = requestAnimationFrame(tick);
      };

      micPreviewAnimationId = requestAnimationFrame(tick);
    } catch {
      micPreviewDb = -60;
    }
  }

  async function handlePrimaryLiveToggle(): Promise<void> {
    if (isSwitchingLive) return;
    isSwitchingLive = true;
    stopMicPreview();
    try {
      if (isLiveOnAir) {
        await stopBroadcast();
      } else {
        await startBroadcast();
      }
    } finally {
      isSwitchingLive = false;
    }
  }

  onMount(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    mobileMediaQuery = window.matchMedia("(max-width: 767px)");
    isMobileOnePager = mobileMediaQuery.matches;
    mobileMediaQueryListener = (event: MediaQueryListEvent) => {
      isMobileOnePager = event.matches;
    };
    if (mobileMediaQuery.addEventListener) {
      mobileMediaQuery.addEventListener("change", mobileMediaQueryListener);
      return;
    }
    mobileMediaQuery.addListener(mobileMediaQueryListener);
  });

  onDestroy(() => {
    if (mobileMediaQuery && mobileMediaQueryListener) {
      if (mobileMediaQuery.removeEventListener) {
        mobileMediaQuery.removeEventListener("change", mobileMediaQueryListener);
      } else {
        mobileMediaQuery.removeListener(mobileMediaQueryListener);
      }
    }
    stopMicPreview();
  });
</script>

<section class="space-y-0 md:space-y-6">
  <div class="lv-session-top-stats hidden gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 md:grid">
    <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p class="text-xs text-slate-500">{$t("detail.listeners_online")}</p>
      <p class="mt-1 text-2xl font-black">{$app.sessionStats.listenersConnected}</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p class="text-xs text-slate-500">{$t("detail.broadcasters_online")}</p>
      <p class="mt-1 text-2xl font-black">{$app.sessionStats.broadcastersConnected}</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p class="text-xs text-slate-500">{$t("detail.active_producers")}</p>
      <p class="mt-1 text-2xl font-black">{$app.sessionStats.activeProducerChannels}</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p class="text-xs text-slate-500">{$t("admin.kpi_channels")}</p>
      <p class="mt-1 text-2xl font-black">{$app.sessionStats.channelsActive}/{$app.sessionStats.channelsTotal}</p>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p class="text-xs text-slate-500">{$t("detail.joins_24h")}</p>
      <p class="mt-1 text-2xl font-black">{$app.sessionStats.joinEvents24h}</p>
    </div>
  </div>

  <div class="lv-admin-detail-grid grid gap-6 lg:grid-cols-2 2xl:grid-cols-[360px_minmax(0,1fr)_360px]">
    <aside class="lv-admin-sidebar order-1 min-w-0 rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl sm:p-6 lg:order-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <h2 class="text-2xl font-black leading-none sm:text-3xl">{$t("detail.speak")}</h2>
          <span
            class={`mt-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[10px] font-bold uppercase tracking-wide ${
              isLiveOnAir
                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
                : "border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
            }`}
            aria-live="polite"
          >
            <span class={`h-2 w-2 rounded-full ${isLiveOnAir ? "bg-red-500" : "bg-slate-400 dark:bg-slate-500"}`}></span>
            {isLiveOnAir ? "ON AIR" : "BEREIT"}
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
              <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4z" fill="none" stroke="currentColor" stroke-width="2"></path>
              <path d="M19 11a7 7 0 1 1-14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </span>
          {#if isMobileOnePager}
            <span class="mt-1 inline-flex h-7 items-center rounded-full border border-slate-300 bg-slate-100 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {$app.sessionStats.listenersConnected} {$t("admin.kpi_listeners")}
            </span>
          {/if}
        </div>
        <button
          class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          onclick={refreshSessionStats}
          title={$t("detail.refresh_stats")}
          aria-label={$t("detail.refresh_stats")}
          type="button"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
            <path d="M21 2v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M3 22v-6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
      </div>

      <div class="mt-4 hidden rounded-2xl border border-slate-200 bg-slate-50 p-1 md:grid md:grid-cols-3 dark:border-slate-700 dark:bg-slate-950/60" role="tablist" aria-label="Ansicht auswählen">
        <button
          class={`truncate rounded-xl px-2 py-2 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${speakPanel === "live" ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}
          onclick={() => (speakPanel = "live")}
          role="tab"
          aria-selected={speakPanel === "live"}
          type="button"
        >
          {$t("detail.live")}
        </button>
        <button
          class={`truncate rounded-xl px-2 py-2 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${speakPanel === "edit" ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}
          onclick={() => (speakPanel = "edit")}
          role="tab"
          aria-selected={speakPanel === "edit"}
          type="button"
        >
          {$t("detail.edit")}
        </button>
        <button
          class={`truncate rounded-xl px-2 py-2 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${speakPanel === "recordings" ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"}`}
          onclick={() => (speakPanel = "recordings")}
          role="tab"
          aria-selected={speakPanel === "recordings"}
          type="button"
        >
          {$t("detail.recordings")}
        </button>
      </div>

      <div class={`mt-4 rounded-2xl border p-3 ${isLiveOnAir ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20" : "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"}`}>
        <div class="mb-3 flex items-center gap-2">
          <span class={`grid h-8 w-8 place-items-center rounded-full ${isLiveOnAir ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"}`}>
            <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
              <path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4z" fill="none" stroke="currentColor" stroke-width="2"></path>
              <path d="M19 11a7 7 0 1 1-14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </span>
          <div>
            <p class="text-sm font-bold">Mikrofon-Übertragung</p>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">{isLiveOnAir ? "Die Übertragung läuft." : "Bereit zum Senden."}</p>
          </div>
        </div>
        <button
          class={`w-full rounded-xl px-4 py-3 text-sm font-bold shadow-sm transition disabled:cursor-wait disabled:opacity-60 ${
            isLiveOnAir ? "bg-red-600 text-white hover:bg-red-700" : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
          onclick={handlePrimaryLiveToggle}
          disabled={
            !$app.selectedSessionId ||
            !$app.sessionCode ||
            $app.channels.length === 0 ||
            isSwitchingLive
          }
          type="button"
        >
          {#if isSwitchingLive}
            {isLiveOnAir ? "Übertragung wird gestoppt..." : "Übertragung wird gestartet..."}
          {:else if isLiveOnAir}
            Live-Übertragung stoppen
          {:else}
            Jetzt live gehen
          {/if}
        </button>
      </div>

      {#if isMobileOnePager || speakPanel === "live"}
        <div class="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div class="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>Mikrofon-Pegel</span>
            <span>{micPreviewDb} dB</span>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div class={`h-full transition-[width] duration-75 ${meterBarClass(micPreviewDb)}`} style={`width: ${micPreviewPercent}%`}></div>
          </div>
        </div>

        <div class="mt-4 rounded-xl border border-slate-200 p-3 md:hidden dark:border-slate-700">
          <p class="text-sm font-semibold">{$t("admin.kpi_channels")}</p>
          <div class="mt-2 grid gap-2">
            <input
              class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              value={$app.channelName}
              oninput={(event) => app.update((s) => ({ ...s, channelName: (event.target as HTMLInputElement).value }))}
              placeholder={$t("common.german")}
            />
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <input
                class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                value={$app.channelLanguage}
                oninput={(event) => app.update((s) => ({ ...s, channelLanguage: (event.target as HTMLInputElement).value }))}
                placeholder="de / en"
              />
              <button class="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-600" onclick={createChannel} type="button">+</button>
            </div>
          </div>

          <div class="mt-3 space-y-2">
            {#if ($app.settingsShowOfflineChannels ? $app.channels : $app.channels.filter((c) => channelIsLive(c.id, "admin"))).length === 0}
              <div class="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{$t("detail.no_channels")}</div>
            {:else}
              {#each ($app.settingsShowOfflineChannels ? $app.channels : $app.channels.filter((c) => channelIsLive(c.id, "admin"))) as channel}
                <div class="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                  <div class="flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold">{channel.name}</p>
                      <p class="text-[11px] text-orange-500">{channel.languageCode || "channel"}</p>
                    </div>
                    <button
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-red-400 bg-white text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20"
                      onclick={() => deleteChannel(channel.id)}
                      type="button"
                      title={$t("common.delete")}
                      aria-label={$t("common.delete")}
                    >
                      <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                        <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                        <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      </svg>
                    </button>
                  </div>
                  <div class="mt-2">
                    <DropdownSelect
                      options={[
                        { value: "", label: $t("detail.default_device") },
                        ...$app.audioInputs.map((input) => ({ value: input.deviceId, label: input.label }))
                      ]}
                      value={$app.channelInputAssignments[channel.id] || ""}
                      triggerClass="h-9 rounded-xl px-3 py-2 text-sm"
                      on:change={(event) =>
                        app.update((s) => ({ ...s, channelInputAssignments: { ...s.channelInputAssignments, [channel.id]: event.detail.value } }))}
                    />
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <div class="lv-admin-device-grid mt-4 grid grid-cols-2 gap-2">
          <button
            class="rounded-xl border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            onclick={() => refreshAudioInputs(false)}
            type="button"
            title={$t("detail.reload_devices")}
            aria-label={$t("detail.reload_devices")}
          >
            {$t("detail.reload_devices")}
          </button>
          <button class="rounded-xl border border-slate-300 px-3 py-2 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => refreshAudioInputs(true)} type="button">
            {$t("detail.enable_mic")}
          </button>
        </div>

        {#if broadcastOccupiedByOther}
          <p class="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {$t("detail.broadcast_occupied", { owner: $app.broadcastOwnerName || $t("detail.someone_else"), since: ownerStartedAtLabel })}
          </p>
          <button
            class="mt-2 w-full rounded-xl border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-900/20"
            onclick={startBroadcast}
            type="button"
          >
            {$t("detail.takeover")}
          </button>
        {/if}
      {/if}

      {#if !isMobileOnePager && speakPanel === "recordings"}
        <div class="mt-5 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <p class="text-sm font-semibold">{$t("detail.recordings")}</p>
          {#if $app.isBroadcasting}
            <button
              class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              onclick={$app.isRecording ? stopRecording : startRecording}
              type="button"
            >
              {$app.isRecording ? $t("detail.stop_recording") : $t("detail.start_recording")}
            </button>
          {/if}
          {#if $app.sessionRecordings.length > 0}
            <div class="mt-3 max-h-52 space-y-2 overflow-auto">
              {#each $app.sessionRecordings as recording}
                <div class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs sm:flex-nowrap dark:border-slate-700">
                  <a
                    class="min-w-0 flex-1 break-all hover:text-orange-500"
                    href={`${apiUrl}/api/admin/sessions/${$app.selectedSessionId}/recordings/${encodeURIComponent(recording.channelId)}/${encodeURIComponent(recording.name)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    [{$app.channels.find((c) => c.id === recording.channelId)?.name || recording.channelId}] {new Date(recording.createdAt).toLocaleString()} ({(recording.size / 1024 / 1024).toFixed(1)} MB)
                  </a>
                  <button
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-red-400 bg-white text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20"
                    onclick={() => deleteRecording(recording)}
                    type="button"
                    title={$t("common.delete")}
                    aria-label={$t("common.delete")}
                  >
                    <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                      <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{$t("detail.no_recordings")}</p>
          {/if}
        </div>
      {/if}

      {#if isMobileOnePager || speakPanel === "edit"}
        <label for="edit-session-name" class="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("admin.session_name")}</label>
        <input
          id="edit-session-name"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          value={$app.sessionName}
          oninput={(event) => app.update((s) => ({ ...s, sessionName: (event.target as HTMLInputElement).value }))}
        />

        <label for="edit-session-description" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("common.description")}</label>
        <textarea
          id="edit-session-description"
          class="mt-2 min-h-[90px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          value={$app.sessionDescription}
          oninput={(event) => app.update((s) => ({ ...s, sessionDescription: (event.target as HTMLTextAreaElement).value }))}
        ></textarea>

        <label for="edit-session-image" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("common.image_url")} / {$t("admin.upload_image")}</label>
        <input
          id="edit-session-image"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
          value={$app.sessionImageUrl}
          oninput={(event) => app.update((s) => ({ ...s, sessionImageUrl: (event.target as HTMLInputElement).value }))}
        />
        <input class="hidden" type="file" accept="image/*" onchange={handleEditImageUpload} />
        <button
          class="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          onclick={(event) => {
            const root = (event.currentTarget as HTMLElement).parentElement;
            const fileInput = root?.querySelector('input[type="file"]') as HTMLInputElement | null;
            fileInput?.click();
          }}
          type="button"
        >
          {$t("admin.upload_image")}
        </button>

        <label for="session-token" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("listener.token_label")}</label>
        <div class="lv-admin-token-row mt-2 flex gap-2">
          <input
            id="session-token"
            class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            value={$app.sessionCode}
            maxlength="6"
            oninput={(event) => app.update((s) => ({ ...s, sessionCode: (event.target as HTMLInputElement).value }))}
          />
          <button class="rounded-xl border border-slate-300 px-3 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={rotateSessionCode} type="button">
            {$t("detail.new_token")}
          </button>
        </div>

        <button
          class="mt-4 w-full rounded-xl border border-red-300 px-4 py-2 text-sm text-slate-900 hover:bg-red-50 dark:border-red-800 dark:text-slate-100 dark:hover:bg-red-900/20"
          onclick={() => deleteSession($app.selectedSessionId)}
          type="button"
        >
          {$t("detail.delete_session")}
        </button>

        {#if $app.authenticatedRole === "ADMIN"}
          <div class="mt-5 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p class="text-sm font-semibold">{$t("detail.session_access")}</p>
            {#if $app.sessionAssignableUsers.length === 0}
              <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{$t("detail.no_broadcasters")}</p>
            {:else}
              <div class="mt-2 max-h-44 overflow-auto">
                <div class="flex flex-wrap gap-2">
                  {#each $app.sessionAssignableUsers as user}
                    <button
                      class={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        user.assigned
                          ? "border-emerald-200 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                      onclick={() => setSessionUserAssignment(user.id, !user.assigned)}
                      type="button"
                    >
                      {user.name}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            {#if $app.sessionUsersStatus}
              <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{$app.sessionUsersStatus}</p>
            {/if}
          </div>
        {/if}
      {/if}
    </aside>

    <section class="order-2 hidden min-w-0 rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl sm:p-6 md:block lg:order-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <h2 class="text-2xl font-black sm:text-3xl">{$t("admin.kpi_channels")}</h2>
      <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="h-44 w-full bg-slate-200 dark:bg-slate-800">
          {#if $app.sessionImageUrl}
            <img class="h-full w-full object-cover" src={$app.sessionImageUrl} alt={$app.sessionName} />
          {/if}
        </div>
        <div class="p-5">
          <h3 class="break-words text-2xl font-black sm:text-3xl">{$app.sessionName || $t("common.session")}</h3>
          <p class="mt-2 break-words text-sm text-slate-500 dark:text-slate-400">{$app.sessionDescription || $t("detail.no_description")}</p>
          <p class="mt-2 text-xs text-slate-400">{$t("detail.session_id")}: {shortId($app.selectedSessionId)}</p>
        </div>
      </div>

      <div class="mt-4 grid gap-2 sm:grid-cols-3">
        <input
          class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          value={$app.channelName}
          oninput={(event) => app.update((s) => ({ ...s, channelName: (event.target as HTMLInputElement).value }))}
          placeholder={$t("common.german")}
        />
        <input
          class="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          value={$app.channelLanguage}
          oninput={(event) => app.update((s) => ({ ...s, channelLanguage: (event.target as HTMLInputElement).value }))}
          placeholder="de / en"
        />
        <button class="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600" onclick={createChannel}>{$t("detail.add_channel")}</button>
      </div>

      <div class="mt-4 space-y-3">
        {#if ($app.settingsShowOfflineChannels ? $app.channels : $app.channels.filter((c) => channelIsLive(c.id, "admin"))).length === 0}
          <div class="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{$t("detail.no_channels")}</div>
        {:else}
          {#each ($app.settingsShowOfflineChannels ? $app.channels : $app.channels.filter((c) => channelIsLive(c.id, "admin"))) as channel}
            <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div class="flex flex-wrap items-center gap-3">
                <div class="min-w-0 sm:min-w-[170px]">
                  <p class="truncate font-semibold">{channel.name}</p>
                  <p class="text-xs text-orange-500">{channel.languageCode || "channel"}</p>
                  <p
                    class={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      channelIsLive(channel.id, "admin")
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {channelIsLive(channel.id, "admin") ? "LIVE" : "OFFLINE"}
                  </p>
                </div>
                <div class="min-w-0 flex-1">
                  <DropdownSelect
                    options={[
                      { value: "", label: $t("detail.default_device") },
                      ...$app.audioInputs.map((input) => ({ value: input.deviceId, label: input.label }))
                    ]}
                    value={$app.channelInputAssignments[channel.id] || ""}
                    triggerClass="h-10 rounded-xl px-3 py-2 text-sm"
                    on:change={(event) =>
                      app.update((s) => ({ ...s, channelInputAssignments: { ...s.channelInputAssignments, [channel.id]: event.detail.value } }))}
                  />
                </div>
                <button
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-red-400 bg-white text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20"
                  onclick={() => deleteChannel(channel.id)}
                  type="button"
                  title={$t("common.delete")}
                  aria-label={$t("common.delete")}
                >
                  <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                    <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                </button>
              </div>
              <div class="mt-3">
                <div class="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <span>{$t("detail.input_level")}</span>
                  <span>{$app.channelDbLevels[channel.id] ?? -60} dB</span>
                </div>
                <div class="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    class={`h-full transition-[width] duration-100 ${meterBarClass($app.channelDbLevels[channel.id] ?? -60)}`}
                    style={`width: ${channelDbToPercent($app.channelDbLevels[channel.id] ?? -60)}%`}
                  ></div>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <aside class="order-3 sticky top-4 min-w-0 self-start max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl lg:order-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
      <h2 class="text-xl font-black sm:text-2xl">{$t("common.qr_code")}</h2>
      {#if $app.joinQrDataUrl}
        <img class="mt-3 w-64 max-w-full rounded-xl border border-slate-200 dark:border-slate-700" src={$app.joinQrDataUrl} alt="Join QR" />
      {:else}
        <div class="mt-3 rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {$t("detail.qr_auto_hint")}
        </div>
      {/if}

      <label for="join-base-url" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("settings.default_join_url")}</label>
      <input
        id="join-base-url"
        class="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        value={$app.joinBaseUrl}
        oninput={(event) => app.update((s) => ({ ...s, joinBaseUrl: (event.target as HTMLInputElement).value }))}
      />

      {#if $app.joinUrl}
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={() => copy($app.joinUrl)}
            type="button"
            title={$t("detail.copy_link")}
            aria-label={$t("detail.copy_link")}
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
              <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
              <path d="M5 15V7a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button
            class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={downloadQr}
            type="button"
            title={$t("detail.download_qr")}
            aria-label={$t("detail.download_qr")}
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
              <path d="M12 3v12m0 0-4-4m4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button
            class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={printQrCard}
            type="button"
            title={$t("detail.print")}
            aria-label={$t("detail.print")}
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
              <path d="M6 9V4h12v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <rect x="4" y="9" width="16" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
              <path d="M8 17h8v3H8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
            </svg>
          </button>
        </div>
      {/if}

      {#if $app.joinUrl}
        <div class="mt-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800">
          <p class="break-all">{$app.joinUrl}</p>
        </div>
      {/if}

      {#if isMobileOnePager}
        <div class="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700 md:hidden">
          <p class="text-sm font-semibold">{$t("detail.recordings")}</p>
          {#if $app.isBroadcasting}
            <button
              class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              onclick={$app.isRecording ? stopRecording : startRecording}
              type="button"
            >
              {$app.isRecording ? $t("detail.stop_recording") : $t("detail.start_recording")}
            </button>
          {/if}
          {#if $app.sessionRecordings.length > 0}
            <div class="mt-3 max-h-52 space-y-2 overflow-auto">
              {#each $app.sessionRecordings as recording}
                <div class="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs sm:flex-nowrap dark:border-slate-700">
                  <a
                    class="min-w-0 flex-1 break-all hover:text-orange-500"
                    href={`${apiUrl}/api/admin/sessions/${$app.selectedSessionId}/recordings/${encodeURIComponent(recording.channelId)}/${encodeURIComponent(recording.name)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    [{$app.channels.find((c) => c.id === recording.channelId)?.name || recording.channelId}] {new Date(recording.createdAt).toLocaleString()} ({(recording.size / 1024 / 1024).toFixed(1)} MB)
                  </a>
                  <button
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-red-400 bg-white text-red-600 hover:bg-red-50 dark:border-red-700 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20"
                    onclick={() => deleteRecording(recording)}
                    type="button"
                    title={$t("common.delete")}
                    aria-label={$t("common.delete")}
                  >
                    <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                      <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                      <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{$t("detail.no_recordings")}</p>
          {/if}
        </div>
      {/if}
    </aside>
  </div>
</section>
