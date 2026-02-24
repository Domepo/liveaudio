<script lang="ts">
  import { adminLogout } from "../../controllers/admin/auth";
  import { goToDashboard } from "../../controllers/routing";
  import { app } from "../../stores/app";
  import { setLocale, t, locale, type Locale } from "../../i18n";
  import { toggleTheme } from "../../controllers/theme";

  function toggleMobileMenu(): void {
    app.update((s) => ({ ...s, mobileAdminMenuOpen: !s.mobileAdminMenuOpen }));
  }

  function dashboardLabel(): string {
    if ($app.adminView === "detail") return $app.sessionName || $t("common.session");
    if ($app.dashboardTab === "sessions") return $t("common.sessions");
    if ($app.dashboardTab === "statistics") return $t("common.dashboard");
    if ($app.dashboardTab === "users") return $t("common.users");
    if ($app.dashboardTab === "test") return $t("common.test");
    return $t("common.settings");
  }

  function applyLocale(next: Locale): void {
    setLocale(next);
    mobileLanguageMenuOpen = false;
  }

  let mobileLanguageMenuOpen = false;

  function localeFlag(value: Locale): string {
    if (value === "de") return "/flags/de.svg";
    if (value === "en") return "/flags/us.svg";
    if (value === "uk") return "/flags/uk.svg";
    return "/flags/ru.svg";
  }
</script>

<header class="relative z-40 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
  <button class="flex items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-slate-100/70 dark:hover:bg-slate-800/70" onclick={goToDashboard} title={$t("common.dashboard")} aria-label={$t("common.dashboard")} type="button">
    <div class="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <img class="h-full w-full object-cover" src={$app.appLogoUrl} alt="Logo" />
    </div>
    <div>
      <p class="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{$t("common.app_name")}</p>
      <p class="text-sm font-black text-slate-900 dark:text-slate-100">{dashboardLabel()}</p>
    </div>
  </button>

  <div class="flex items-center gap-2">
    <div class="lv-header-lang-desktop hidden h-9 items-center gap-1 rounded-xl border border-slate-300 bg-white px-1 dark:border-slate-700 dark:bg-slate-900 lg:inline-flex" aria-label={$t("common.language")}>
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
    <div class="lv-header-lang-mobile relative order-1 lg:order-none lg:hidden">
      <button
        class="flex h-9 items-center gap-1 rounded-xl border border-slate-300 bg-white px-2 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        type="button"
        onclick={() => (mobileLanguageMenuOpen = !mobileLanguageMenuOpen)}
        aria-label={$t("common.language")}
        title={$t("common.language")}
      >
        <img class="h-4 w-6 rounded-[2px] object-cover" src={localeFlag($locale)} alt={$t("common.language")} />
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" aria-hidden="true">
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>
      {#if mobileLanguageMenuOpen}
        <div class="absolute right-0 z-30 mt-1 w-28 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <button class="grid h-8 w-full place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" type="button" onclick={() => applyLocale("de")} title={$t("common.german")} aria-label={$t("common.german")}>
            <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/de.svg" alt={$t("common.german")} />
          </button>
          <button class="grid h-8 w-full place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" type="button" onclick={() => applyLocale("en")} title={$t("common.english")} aria-label={$t("common.english")}>
            <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/us.svg" alt={$t("common.english")} />
          </button>
          <button class="grid h-8 w-full place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" type="button" onclick={() => applyLocale("uk")} title={$t("common.ukrainian")} aria-label={$t("common.ukrainian")}>
            <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/uk.svg" alt={$t("common.ukrainian")} />
          </button>
          <button class="grid h-8 w-full place-items-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800" type="button" onclick={() => applyLocale("ru")} title={$t("common.russian")} aria-label={$t("common.russian")}>
            <img class="h-4 w-6 rounded-[2px] object-cover" src="/flags/ru.svg" alt={$t("common.russian")} />
          </button>
        </div>
      {/if}
    </div>
    {#if $app.adminAuthenticated}
      <button
        class="lv-admin-burger relative z-50 order-3 hidden h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 lg:order-none"
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
        class="lv-header-logout hidden h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 lg:grid"
        onclick={adminLogout}
        title={$t("common.logout")}
        aria-label={$t("common.logout")}
      >
        <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M16 17l5-5-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M21 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>
    {/if}
    <button
      class="order-2 grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 lg:order-none"
      onclick={toggleTheme}
      title={$app.theme === "dark" ? $t("common.light_mode") : $t("common.dark_mode")}
      aria-label={$app.theme === "dark" ? $t("common.light_mode") : $t("common.dark_mode")}
    >
      {#if $app.theme === "dark"}
        <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3c0 0 0 0 0 0A7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      {/if}
    </button>
  </div>
</header>
