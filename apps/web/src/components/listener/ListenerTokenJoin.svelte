<script lang="ts">
  import { t } from "../../i18n";
  import { app } from "../../stores/app";
  import { enterWithToken } from "../../controllers/listener/join";
</script>

<section class="mx-auto mt-12 max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
  <h2 class="text-3xl font-black">{$t("listener.join_session")}</h2>
  <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{$t("listener.enter_token_hint")}</p>

  <label for="listener-token" class="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{$t("listener.token_label")}</label>
  <input
    id="listener-token"
    class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
    value={$app.listenerCode}
    oninput={(event) => app.update((s) => ({ ...s, listenerCode: (event.target as HTMLInputElement).value }))}
    maxlength="6"
    placeholder="123456"
  />

  <button
    class="mt-4 w-full rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
    onclick={enterWithToken}
    disabled={!/^\d{6}$/.test($app.listenerCode.trim())}
  >
    {$t("listener.continue")}
  </button>

  {#if $app.listenerStatus}
    <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">{$app.listenerStatus}</p>
  {/if}
</section>
