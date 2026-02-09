<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let adminName = "";
  export let adminPassword = "";
  export let adminStatus = "";

  const dispatch = createEventDispatcher<{ login: void }>();

  $: canLogin = adminName.trim().length > 0 && adminPassword.trim().length > 0;
</script>

<section class="mx-auto mt-12 max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
  <h2 class="text-2xl font-black">Login</h2>
  <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Anmeldung für Dashboard und Rollenrechte.</p>
  <label for="admin-name" class="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Name</label>
  <input id="admin-name" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" type="text" bind:value={adminName} placeholder="Admin Name" />
  <label for="admin-password" class="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Passwort</label>
  <input id="admin-password" class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" type="password" bind:value={adminPassword} placeholder="Admin Passwort" />
  <button class="mt-4 w-full rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60" onclick={() => dispatch("login")} disabled={!canLogin}>Anmelden</button>
  {#if adminStatus}
    <p class="mt-3 text-sm text-slate-600 dark:text-slate-300">{adminStatus}</p>
  {/if}
</section>
