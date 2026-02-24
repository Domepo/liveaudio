<script lang="ts">
  import { adminLogout } from "../../controllers/admin/auth";
  import { canAccessTab, setDashboardTab, toggleDashboardSidebar } from "../../controllers/routing";
  import { t } from "../../i18n";
  import { app } from "../../stores/app";

  type TabItem = {
    id: "sessions" | "statistics" | "users" | "settings" | "test";
    label: string;
    group: "marketing" | "management" | "system";
    visible: boolean;
  };

  $: tabItems = [
    { id: "sessions", label: $t("common.dashboard"), group: "marketing", visible: canAccessTab("sessions") },
    { id: "statistics", label: $t("common.statistics"), group: "marketing", visible: canAccessTab("statistics") },
    { id: "users", label: $t("common.users"), group: "management", visible: canAccessTab("users") },
    { id: "settings", label: $t("common.settings"), group: "system", visible: canAccessTab("settings") },
    { id: "test", label: $t("common.test"), group: "system", visible: canAccessTab("test") }
  ] satisfies TabItem[];

  $: visibleItems = tabItems.filter((item) => item.visible);
  $: groups = [
    { id: "marketing", label: $t("sidebar.group_marketing") },
    { id: "management", label: $t("sidebar.group_management") },
    { id: "system", label: $t("sidebar.group_system") }
  ] as const;
</script>

<aside class={`lv-admin-menu h-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${$app.dashboardSidebarCollapsed ? "" : "p-4"}`}>
  <div class="mb-3 flex items-center justify-between">
    <div class="flex min-h-9 items-center gap-2">
      {#if !$app.dashboardSidebarCollapsed}
        <div>
          <p class="text-sm font-black text-slate-800 dark:text-slate-100">{$t("common.dashboard")}</p>
          <p class="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{$t("sidebar.navigation")}</p>
        </div>
      {/if}
    </div>

    <button
      class="mr-1 grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      onclick={toggleDashboardSidebar}
      title={$app.dashboardSidebarCollapsed ? $t("sidebar.expand") : $t("sidebar.collapse")}
      aria-label={$app.dashboardSidebarCollapsed ? $t("sidebar.expand") : $t("sidebar.collapse")}
      type="button"
    >
      {#if $app.dashboardSidebarCollapsed}
        <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      {/if}
    </button>
  </div>

  <div class="space-y-4">
    {#each groups as group}
      <div>
        {#if !$app.dashboardSidebarCollapsed}
          <p class="mb-1 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{group.label}</p>
        {/if}
        <div class="space-y-1">
          {#each visibleItems.filter((item) => item.group === group.id) as item}
            <button
              class={`flex w-full items-center rounded-lg py-2 text-left text-sm font-medium transition ${
                $app.dashboardSidebarCollapsed ? "justify-center px-2" : "gap-2 px-2.5"
              } ${
                $app.dashboardTab === item.id
                  ? "bg-orange-100 text-orange-700 shadow-inner dark:bg-orange-900/35 dark:text-orange-200"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              onclick={() => setDashboardTab(item.id)}
              title={item.label}
              aria-label={item.label}
            >
              <span class="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-900 dark:border-slate-700 dark:text-slate-100">
                {#if item.id === "sessions"}
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
                    <path d="M3 10h18" fill="none" stroke="currentColor" stroke-width="2"></path>
                  </svg>
                {:else if item.id === "statistics"}
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
                    <path d="M4 20V10M10 20V6M16 20V13M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                  </svg>
                {:else if item.id === "users"}
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
                    <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"></circle>
                    <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                    <path d="M17 8h4M19 6v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                  </svg>
                {:else}
                  <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" aria-hidden="true">
                    {#if item.id === "test"}
                      <path d="M9 3h6l1 2h3v3l-2 1v2l2 1v3h-3l-1 2H9l-1-2H5v-3l2-1V9L5 8V5h3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
                      <circle cx="12" cy="12" r="2.25" fill="none" stroke="currentColor" stroke-width="2"></circle>
                    {:else}
                      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"></circle>
                      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
                    {/if}
                  </svg>
                {/if}
              </span>
              {#if !$app.dashboardSidebarCollapsed}
                <span>{item.label}</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <div class="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
    {#if !$app.dashboardSidebarCollapsed}
      <div class="mb-2 flex items-center gap-2 rounded-xl bg-slate-100/70 p-2 dark:bg-slate-800/70">
        <div class="grid h-8 w-8 place-items-center rounded-full bg-black text-white dark:bg-white dark:text-black">
          <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
            <path d="M5 20c0-3.5 2.8-6 7-6s7 2.5 7 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          </svg>
        </div>
        <div class="min-w-0">
          <p class="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{$app.adminAuthenticatedName || $t("common.role_admin")}</p>
          <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">{$app.authenticatedRole}</p>
        </div>
      </div>
      <button
        class="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        onclick={adminLogout}
      >
        {$t("common.logout")}
      </button>
    {/if}
  </div>
</aside>
