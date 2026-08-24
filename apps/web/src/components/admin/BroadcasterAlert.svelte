<script lang="ts">
  import { app } from "../../stores/app";

  $: alert = $app.broadcasterAlert;
  $: palette =
    alert?.level === "critical"
      ? {
          shell: "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100",
          icon: "bg-red-600 text-white",
          detail: "text-red-800 dark:text-red-200"
        }
      : alert?.level === "success"
        ? {
            shell: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100",
            icon: "bg-emerald-600 text-white",
            detail: "text-emerald-800 dark:text-emerald-200"
          }
        : {
            shell: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100",
            icon: "bg-amber-500 text-amber-950",
            detail: "text-amber-800 dark:text-amber-200"
          };

  function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
</script>

{#if alert}
  <div
    class={`mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-sm ${palette.shell}`}
    role={alert.level === "success" ? "status" : "alert"}
    aria-live={alert.level === "critical" ? "assertive" : "polite"}
    data-testid="broadcaster-health-alert"
  >
    <span class={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${palette.icon}`} aria-hidden="true">
      {#if alert.level === "success"}
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.4">
          <path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M12 9v4m0 4h.01M10.3 4.3 2.7 17.5A1.7 1.7 0 0 0 4.2 20h15.6a1.7 1.7 0 0 0 1.5-2.5L13.7 4.3a2 2 0 0 0-3.4 0Z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {/if}
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p class="font-black">{alert.title}</p>
        <time class={`text-xs font-semibold tabular-nums ${palette.detail}`} datetime={alert.at}>{formatTime(alert.at)}</time>
      </div>
      <p class={`mt-0.5 text-sm ${palette.detail}`}>{alert.message}</p>
      {#if alert.action}
        <p class="mt-1 text-sm font-bold">{alert.action}</p>
      {/if}
    </div>
  </div>
{/if}
