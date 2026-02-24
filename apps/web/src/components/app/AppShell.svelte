<script lang="ts">
  import { app } from "../../stores/app";
  import HeaderBar from "./HeaderBar.svelte";
  import AdminApp from "../admin/AdminApp.svelte";
  import ListenerApp from "../listener/ListenerApp.svelte";
</script>

<main
  class="min-h-screen text-slate-900 dark:text-slate-100"
  class:lv-admin={$app.isAdminRoute}
  class:bg-white={!$app.isAdminRoute}
  class:dark:bg-slate-950={!$app.isAdminRoute}
>
  {#if !$app.isAdminRoute}
    <HeaderBar />
  {/if}

  <div
    class="lv-page-inner min-h-screen"
    class:w-full={$app.isAdminRoute}
    class:px-0={$app.isAdminRoute}
    class:px-6={!$app.isAdminRoute}
    class:mx-auto={!$app.isAdminRoute}
    class:pt-0={$app.isAdminRoute}
    class:pb-8={$app.isAdminRoute}
    class:py-8={!$app.isAdminRoute}
    class:max-w-[1440px]={!$app.isAdminRoute}
  >
    {#if $app.isAdminRoute}
      <AdminApp />
    {:else}
      <ListenerApp />
    {/if}
  </div>
</main>
