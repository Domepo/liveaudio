<script lang="ts">
  import { get } from "svelte/store";
  import { onDestroy, onMount } from "svelte";

  import { apiUrl } from "../../../lib/config";
  import { fetchJson } from "../../../lib/http";
  import { setSettingsStatus } from "../../../controllers/logging";
  import { onSettingsLogoInputChange, resetAppLogo } from "../../../controllers/branding";
  import { resetUiSettings, saveUiSettingsSilently } from "../../../controllers/uiSettings";
  import { t, tr } from "../../../i18n";
  import { app } from "../../../stores/app";

  let autoSaveReady = false;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedSettingsKey = "";

  function buildSettingsKey(): string {
    const state = get(app);
    return JSON.stringify({
      autoRefreshSeconds: state.settingsAutoRefreshSeconds,
      autoGenerateQr: state.settingsAutoGenerateQr,
      showOfflineChannels: state.settingsShowOfflineChannels,
      confirmDestructiveActions: state.settingsConfirmDestructiveActions,
      defaultJoinBaseUrl: state.settingsDefaultJoinBaseUrl.trim()
    });
  }

  function scheduleAutoSave(): void {
    if (!autoSaveReady) return;
    const nextKey = buildSettingsKey();
    if (nextKey === lastSavedSettingsKey) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      saveUiSettingsSilently();
      lastSavedSettingsKey = buildSettingsKey();
      setSettingsStatus(tr("settings.saved"));
    }, 250);
  }

  function handleResetSettings(): void {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    resetUiSettings();
    lastSavedSettingsKey = buildSettingsKey();
  }

  $: scheduleAutoSave();

  onMount(() => {
    lastSavedSettingsKey = buildSettingsKey();
    autoSaveReady = true;
  });

  onDestroy(() => {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
  });

  async function setDebugMode(enabled: boolean): Promise<void> {
    const previous = $app.debugMode;
    app.update((s) => ({ ...s, debugMode: enabled }));
    try {
      const result = await fetchJson<{ ok: boolean; debugMode: boolean; canToggle: boolean }>(`${apiUrl}/api/admin/settings/debug`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      app.update((s) => ({ ...s, debugMode: Boolean(result.debugMode), debugModeMutable: Boolean(result.canToggle) }));
      setSettingsStatus(tr("settings.debug_saved"));
    } catch (error) {
      app.update((s) => ({ ...s, debugMode: previous }));
      setSettingsStatus(tr("settings.debug_save_error", { message: (error as Error).message }));
    }
  }
</script>

<div class="space-y-4">
  <h3 class="text-xl font-black">{$t("common.settings")}</h3>
  <p class="text-sm text-slate-500 dark:text-slate-400">{$t("settings.subtitle")}</p>

  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <p class="text-sm font-semibold">{$t("settings.network_qr")}</p>
    <label for="settings-default-join-url" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("settings.default_join_url")}</label>
    <input
      id="settings-default-join-url"
      class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      value={$app.settingsDefaultJoinBaseUrl}
      oninput={(event) => app.update((s) => ({ ...s, settingsDefaultJoinBaseUrl: (event.target as HTMLInputElement).value }))}
      placeholder="https://join.example.com"
    />
  </div>

  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <p class="text-sm font-semibold">{$t("settings.behavior")}</p>
    <label for="settings-refresh-sec" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("settings.auto_refresh")}</label>
    <input
      id="settings-refresh-sec"
      class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      type="number"
      min="2"
      max="60"
      value={$app.settingsAutoRefreshSeconds}
      oninput={(event) => app.update((s) => ({ ...s, settingsAutoRefreshSeconds: Number((event.target as HTMLInputElement).value) }))}
    />

    <div class="mt-4 space-y-2">
      <label class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-transparent px-3 py-2.5 transition hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700">
        <span class="relative inline-flex h-6 w-11 shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            checked={$app.settingsAutoGenerateQr}
            onchange={(event) => app.update((s) => ({ ...s, settingsAutoGenerateQr: (event.target as HTMLInputElement).checked }))}
          />
          <span class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400/70 dark:bg-slate-600"></span>
          <span class="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"></span>
        </span>
        <div>
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">{$t("settings.auto_generate_qr")}</p>
        </div>
      </label>

      <label class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-transparent px-3 py-2.5 transition hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700">
        <span class="relative inline-flex h-6 w-11 shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            checked={$app.settingsShowOfflineChannels}
            onchange={(event) => app.update((s) => ({ ...s, settingsShowOfflineChannels: (event.target as HTMLInputElement).checked }))}
          />
          <span class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400/70 dark:bg-slate-600"></span>
          <span class="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"></span>
        </span>
        <div>
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">{$t("settings.show_offline_channels")}</p>
        </div>
      </label>

      <label class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-transparent px-3 py-2.5 transition hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700">
        <span class="relative inline-flex h-6 w-11 shrink-0 items-center">
          <input
            type="checkbox"
            class="peer sr-only"
            checked={$app.settingsConfirmDestructiveActions}
            onchange={(event) => app.update((s) => ({ ...s, settingsConfirmDestructiveActions: (event.target as HTMLInputElement).checked }))}
          />
          <span class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400/70 dark:bg-slate-600"></span>
          <span class="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"></span>
        </span>
        <div>
          <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">{$t("settings.confirm_destructive")}</p>
        </div>
      </label>

      {#if $app.authenticatedRole === "ADMIN"}
        <label class="group flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-transparent px-3 py-2.5 transition hover:border-orange-300 dark:border-slate-700 dark:hover:border-orange-700">
          <span class="relative inline-flex h-6 w-11 shrink-0 items-center">
            <input
              type="checkbox"
              class="peer sr-only"
              checked={$app.debugMode}
              disabled={!$app.debugModeMutable}
              onchange={(event) => void setDebugMode((event.target as HTMLInputElement).checked)}
            />
            <span class="absolute inset-0 rounded-full bg-slate-300 transition peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-400/70 dark:bg-slate-600"></span>
            <span class="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5"></span>
          </span>
          <div>
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">{$t("settings.debug_mode")}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{$t("settings.debug_mode_hint")}</p>
          </div>
        </label>
      {/if}
    </div>
  </div>

  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <p class="text-sm font-semibold">{$t("settings.branding")}</p>
    <img class="mt-3 h-20 w-20 rounded-xl border border-slate-200 bg-white object-cover p-1 dark:border-slate-700 dark:bg-slate-900" src={$app.appLogoUrl} alt={$t("settings.active_logo_alt")} />
    <input class="hidden" type="file" accept="image/*" onchange={onSettingsLogoInputChange} />
    <div class="mt-3 flex flex-wrap gap-2">
      <button
        class="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
        onclick={(event) => {
          const root = (event.currentTarget as HTMLElement).parentElement?.parentElement;
          const fileInput = root?.querySelector('input[type="file"]') as HTMLInputElement | null;
          fileInput?.click();
        }}
      >
        {$t("settings.upload_logo")}
      </button>
      <button class="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700" onclick={resetAppLogo}>
        {$t("settings.reset_logo")}
      </button>
    </div>
  </div>

  <div class="lv-admin-actions-row flex flex-wrap gap-2">
    <button class="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700" onclick={handleResetSettings}>{$t("settings.reset_btn")}</button>
  </div>

  {#if $app.settingsStatus}
    <p class="text-sm text-slate-500 dark:text-slate-400">{$app.settingsStatus}</p>
  {/if}
</div>
