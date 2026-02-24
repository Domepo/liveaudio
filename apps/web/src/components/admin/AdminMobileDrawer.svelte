<script lang="ts">
  import { adminLogout } from "../../controllers/admin/auth";
  import { canAccessTab, setDashboardTab } from "../../controllers/routing";
  import { t } from "../../i18n";
  import { app } from "../../stores/app";

  function close(): void {
    app.update((s) => ({ ...s, mobileAdminMenuOpen: false }));
  }

  function logoutFromDrawer(): void {
    close();
    adminLogout();
  }
</script>

{#if $app.isAdminRoute && $app.adminAuthenticated && $app.mobileAdminMenuOpen}
  <div
    class="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm"
    onclick={(event) => {
      if (event.target === event.currentTarget) close();
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") close();
    }}
    role="dialog"
    aria-modal="true"
    aria-label={$t("common.menu")}
    tabindex="0"
  >
    <aside class="lv-admin-drawer h-full w-[min(86vw,360px)] overflow-auto bg-white p-4 shadow-2xl dark:bg-slate-900">
      <div class="mb-3 flex items-center justify-between">
        <p class="text-sm font-black tracking-wide text-slate-700 dark:text-slate-200">{$t("common.menu")}</p>
        <button
          class="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          onclick={close}
          type="button"
        >
          {$t("common.close")}
        </button>
      </div>

      <div class="flex flex-wrap gap-2">
        {#if canAccessTab("sessions")}
          <button
            class={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${
              $app.dashboardTab === "sessions"
                ? "bg-orange-500 text-white"
                : "border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            onclick={() => setDashboardTab("sessions")}
            type="button"
          >
            {$t("common.my_sessions")}
          </button>
        {/if}

        {#if canAccessTab("users")}
          <button
            class={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${
              $app.dashboardTab === "users"
                ? "bg-orange-500 text-white"
                : "border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            onclick={() => setDashboardTab("users")}
            type="button"
          >
            {$t("common.users")}
          </button>
        {/if}

        {#if canAccessTab("settings")}
          <button
            class={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${
              $app.dashboardTab === "settings"
                ? "bg-orange-500 text-white"
                : "border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            onclick={() => setDashboardTab("settings")}
            type="button"
          >
            {$t("common.settings")}
          </button>
        {/if}

        {#if canAccessTab("test")}
          <button
            class={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${
              $app.dashboardTab === "test"
                ? "bg-orange-500 text-white"
                : "border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            }`}
            onclick={() => setDashboardTab("test")}
            type="button"
          >
            {$t("common.test")}
          </button>
        {/if}

        <button
          class="mt-2 inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onclick={logoutFromDrawer}
          type="button"
        >
          {$t("common.logout")}
        </button>
      </div>
    </aside>
  </div>
{/if}
