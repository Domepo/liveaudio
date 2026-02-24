<script lang="ts">
  import { app } from "../../stores/app";
  import AdminSidebarMenu from "./AdminSidebarMenu.svelte";
  import AdminSessionDetail from "./AdminSessionDetail.svelte";
  import AdminTopHeader from "./AdminTopHeader.svelte";
  import SettingsTab from "./tabs/SettingsTab.svelte";
  import SessionsTab from "./tabs/SessionsTab.svelte";
  import TestTab from "./tabs/TestTab.svelte";
  import StatisticsTab from "./tabs/statistics/StatisticsTab.svelte";
  import UsersTab from "./tabs/UsersTab.svelte";
</script>

<section class="lv-admin-dashboard-wrap min-h-screen w-full bg-white p-4 dark:bg-slate-950">
  <AdminTopHeader />

  <section
    class={`lv-admin-dashboard-grid min-h-[calc(100dvh-7rem)] grid gap-4 ${
      $app.dashboardSidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[296px_minmax(0,1fr)]"
    }`}
  >
    <AdminSidebarMenu />

    <section class="h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      {#if $app.adminView === "detail"}
        <AdminSessionDetail />
      {:else if $app.dashboardTab === "statistics"}
        <StatisticsTab />
      {:else if $app.dashboardTab === "users"}
        <UsersTab />
      {:else if $app.dashboardTab === "test"}
        <TestTab />
      {:else if $app.dashboardTab === "sessions"}
        <SessionsTab />
      {:else}
        <SettingsTab />
      {/if}
    </section>
  </section>
</section>
