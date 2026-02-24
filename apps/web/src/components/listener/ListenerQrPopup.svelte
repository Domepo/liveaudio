<script lang="ts">
  import { closeListenerQrPopup } from "../../controllers/listener/qrPopup";
  import { t } from "../../i18n";
  import { app } from "../../stores/app";
</script>

{#if $app.listenerQrPopupOpen}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
    onclick={(event) => {
      if (event.target === event.currentTarget) closeListenerQrPopup();
    }}
    onkeydown={(event) => {
      if (event.key === "Escape") closeListenerQrPopup();
    }}
    role="dialog"
    aria-modal="true"
    tabindex="0"
  >
    <div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-base font-black">{$t("common.qr_code")}</h3>
        <button
          class="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          onclick={closeListenerQrPopup}
          type="button"
        >
          {$t("common.close")}
        </button>
      </div>
      {#if $app.listenerQrPopupDataUrl}
        <img class="mx-auto w-64 max-w-full rounded-xl border border-slate-200 p-2 dark:border-slate-700" src={$app.listenerQrPopupDataUrl} alt={$t("listener.qr_client_alt")} />
        <p class="mt-3 break-all rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">{$app.listenerQrPopupTargetUrl}</p>
      {/if}
    </div>
  </div>
{/if}
