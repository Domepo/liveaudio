<script lang="ts">
  import { adminLogout } from "../../controllers/admin/auth";
  import { openListenerQrPopup } from "../../controllers/listener/qrPopup";
  import { canAccessTab, goToAdminList, goToDashboard } from "../../controllers/routing";
  import { setLocale, t, locale, type Locale } from "../../i18n";
  import { toggleTheme } from "../../controllers/theme";
  import { app } from "../../stores/app";

  function toggleMobileMenu(): void {
    app.update((s) => ({ ...s, mobileAdminMenuOpen: !s.mobileAdminMenuOpen }));
  }

  function adminContextLabel(): string {
    if (!$app.isAdminRoute) return $t("common.app_name");
    if ($app.adminView === "detail") return $app.sessionName || $t("common.session");
    if ($app.dashboardTab === "sessions") return $t("common.sessions");
    if ($app.dashboardTab === "statistics") return $t("common.dashboard");
    if ($app.dashboardTab === "users") return $t("common.users");
    if ($app.dashboardTab === "test") return $t("common.test");
    return $t("common.settings");
  }

  function applyLocale(next: Locale): void {
    setLocale(next);
  }
</script>

<header class={$app.isAdminRoute ? "bg-transparent" : "border-b border-slate-200/70 bg-white/70 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70"}>
  <div class={`lv-header-inner flex items-center justify-between px-8 ${$app.isAdminRoute ? "w-full py-2" : "mx-auto max-w-[1440px] py-4"}`}>
    <div class="flex w-full items-center justify-between gap-3">
      <div class="lv-header-left flex items-center gap-3">
        <div class="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <img class="h-full w-full object-cover" src={$app.appLogoUrl} alt="Logo" />
        </div>
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{$t("common.app_name")}</p>
          <p class="text-sm font-black text-slate-900 dark:text-slate-100">{adminContextLabel()}</p>
        </div>

        {#if $app.isAdminRoute}
          <button class="ml-4 hidden text-sm font-semibold text-slate-600 hover:text-orange-600 sm:inline-flex dark:text-slate-300 dark:hover:text-orange-400" onclick={goToDashboard}>{$t("common.dashboard")}</button>
          {#if canAccessTab("sessions") && ($app.adminView !== "dashboard" || $app.dashboardTab === "sessions")}
            <div class="text-slate-400">></div>
            <button class="text-sm font-semibold text-slate-600 hover:text-orange-600 dark:text-slate-300 dark:hover:text-orange-400" onclick={goToAdminList}>{$t("common.my_sessions")}</button>
          {/if}
          {#if $app.adminView === "detail"}
            <div class="text-slate-400">></div>
            <div class="text-sm font-semibold text-orange-600 dark:text-orange-400">{$app.sessionName || $t("common.session")}</div>
          {/if}
        {/if}
      </div>

      <div class="lv-header-right flex items-center gap-2">
        {#if $app.isAdminRoute}
          <div class="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-300 bg-white px-1 dark:border-slate-700 dark:bg-slate-900" aria-label={$t("common.language")}>
      <button
        class={`grid h-7 w-9 place-items-center rounded-md text-sm ${$locale === "de" ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        type="button"
        onclick={() => applyLocale("de")}
        title={$t("common.german")}
        aria-label={$t("common.german")}
      >
        <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/de.svg" alt={$t("common.german")} />
      </button>
      <button
        class={`grid h-7 w-9 place-items-center rounded-md text-sm ${$locale === "en" ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        type="button"
        onclick={() => applyLocale("en")}
        title={$t("common.english")}
        aria-label={$t("common.english")}
      >
        <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/us.svg" alt={$t("common.english")} />
      </button>
      <button
        class={`grid h-7 w-9 place-items-center rounded-md text-sm ${$locale === "uk" ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        type="button"
        onclick={() => applyLocale("uk")}
        title={$t("common.ukrainian")}
        aria-label={$t("common.ukrainian")}
      >
        <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/uk.svg" alt={$t("common.ukrainian")} />
      </button>
      <button
        class={`grid h-7 w-9 place-items-center rounded-md text-sm ${$locale === "ru" ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
        type="button"
        onclick={() => applyLocale("ru")}
        title={$t("common.russian")}
        aria-label={$t("common.russian")}
      >
        <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/ru.svg" alt={$t("common.russian")} />
      </button>
          </div>
        {/if}
        {#if $app.isAdminRoute && $app.adminAuthenticated}
          <button
            class="lv-admin-burger hidden h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            onclick={toggleMobileMenu}
            title={$t("common.menu")}
            aria-label={$t("common.menu")}
            type="button"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
          <button
            class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            onclick={adminLogout}
            title={$t("common.logout")}
            aria-label={$t("common.logout")}
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
              <path
                d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ></path>
              <path d="M16 17l5-5-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        {/if}

        {#if !$app.isAdminRoute}
          <button
            class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            onclick={openListenerQrPopup}
            title={$t("common.qr_code")}
            aria-label={$t("common.qr_code")}
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"></rect>
              <path d="M14 14h2v2h-2zM18 14h3v3h-3zM14 18h3v3h-3zM19 19h2v2h-2z" fill="currentColor"></path>
            </svg>
          </button>
        {/if}

        <button
          class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          onclick={toggleTheme}
          title={$app.theme === "dark" ? $t("common.light_mode") : $t("common.dark_mode")}
          aria-label={$app.theme === "dark" ? $t("common.light_mode") : $t("common.dark_mode")}
        >
          {#if $app.theme === "dark"}
            <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
              <circle cx="12" cy="12" r="4" fill="currentColor"></circle>
              <path
                d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              ></path>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
              <path
                d="M21 12.79A9 9 0 1 1 11.21 3c0 0 0 0 0 0A7 7 0 0 0 21 12.79z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              ></path>
            </svg>
          {/if}
        </button>
      </div>
    </div>
  </div>
</header>
