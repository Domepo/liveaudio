<script lang="ts">
  import { onMount } from "svelte";
  import { locale, t } from "../../../../i18n";

  import { loadBroadcastLog } from "../../../../controllers/statistics";
  import { app } from "../../../../stores/app";

  type DayBar = { dayLabel: string; runs: number; minutes: number };
  const COMPLETED_ROWS_PER_PAGE = 20;
  let completedPage = 1;

  function toTimestamp(value?: string | null): number {
    if (!value) return Number.NaN;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NaN;
  }

  function formatDateTime(value?: string | null): string {
    const timestamp = toTimestamp(value);
    if (!Number.isFinite(timestamp)) return "-";
    return new Intl.DateTimeFormat($locale === "de" ? "de-DE" : $locale === "ru" ? "ru-RU" : $locale === "uk" ? "uk-UA" : "en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(timestamp));
  }

  function durationSeconds(start: string, stop?: string | null): number {
    const startMs = toTimestamp(start);
    const endMs = toTimestamp(stop) || Date.now();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    return Math.floor((endMs - startMs) / 1000);
  }

  function formatSeconds(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function dayLabel(date: Date): string {
    return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function percent(value: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((value / total) * 100);
  }

  onMount(() => {
    void loadBroadcastLog();
  });

  $: rows = [...$app.broadcastLogRows].sort((a, b) => toTimestamp(b.startedAt) - toTimestamp(a.startedAt));
  $: liveRows = rows.filter((row) => row.isLive);
  $: currentLive = liveRows.length > 0 ? liveRows[0] : null;
  $: completedRows = rows.filter((row) => !row.isLive).sort((a, b) => toTimestamp(b.stoppedAt) - toTimestamp(a.stoppedAt));
  $: completedTotalPages = Math.max(1, Math.ceil(completedRows.length / COMPLETED_ROWS_PER_PAGE));
  $: completedPage = Math.min(Math.max(1, completedPage), completedTotalPages);
  $: completedPageRows = completedRows.slice((completedPage - 1) * COMPLETED_ROWS_PER_PAGE, completedPage * COMPLETED_ROWS_PER_PAGE);

  $: totalRuns = rows.length;
  $: completedRuns = completedRows.length;
  $: totalSeconds = rows.reduce((sum, row) => sum + durationSeconds(row.startedAt, row.stoppedAt), 0);
  $: averageSeconds = completedRuns > 0 ? Math.floor(completedRows.reduce((sum, row) => sum + durationSeconds(row.startedAt, row.stoppedAt), 0) / completedRuns) : 0;
  $: totalSessions = $app.adminSessions.length;

  $: chartBars = (() => {
    const today = new Date();
    const bars: DayBar[] = [];

    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);
      bars.push({ dayLabel: dayLabel(date), runs: 0, minutes: 0 });
    }

    for (const row of rows) {
      const started = new Date(row.startedAt);
      if (Number.isNaN(started.getTime())) continue;
      started.setHours(0, 0, 0, 0);
      const key = dayLabel(started);
      const bar = bars.find((entry) => entry.dayLabel === key);
      if (!bar) continue;
      bar.runs += 1;
      bar.minutes += Math.max(1, Math.floor(durationSeconds(row.startedAt, row.stoppedAt) / 60));
    }

    return bars;
  })();

  $: chartRunsMax = Math.max(1, ...chartBars.map((entry) => entry.runs));
  $: chartMinutesMax = Math.max(1, ...chartBars.map((entry) => entry.minutes));

  $: durationBuckets = (() => {
    const short = completedRows.filter((row) => durationSeconds(row.startedAt, row.stoppedAt) < 10 * 60).length;
    const medium = completedRows.filter((row) => {
      const secs = durationSeconds(row.startedAt, row.stoppedAt);
      return secs >= 10 * 60 && secs < 30 * 60;
    }).length;
    const long = completedRows.filter((row) => durationSeconds(row.startedAt, row.stoppedAt) >= 30 * 60).length;
    const live = liveRows.length;
    return { short, medium, long, live };
  })();

  $: donutTotal = durationBuckets.short + durationBuckets.medium + durationBuckets.long + durationBuckets.live;
  $: runtimeSegments = [
    {
      key: "short",
      label: $t("stats.short"),
      count: durationBuckets.short,
      colorClass: "bg-blue-600"
    },
    {
      key: "medium",
      label: $t("stats.medium"),
      count: durationBuckets.medium,
      colorClass: "bg-amber-500"
    },
    {
      key: "long",
      label: $t("stats.long"),
      count: durationBuckets.long,
      colorClass: "bg-orange-500"
    },
    {
      key: "live",
      label: $t("stats.live"),
      count: durationBuckets.live,
      colorClass: "bg-red-500"
    }
  ].map((segment) => ({
    ...segment,
    percent: donutTotal > 0 ? (segment.count / donutTotal) * 100 : 0
  }));

  $: sessionRows = (() => {
    const bySession = new Map<string, { name: string; runs: number; minutes: number; live: boolean }>();

    for (const row of rows) {
      const current = bySession.get(row.sessionId) ?? { name: row.sessionName, runs: 0, minutes: 0, live: false };
      current.runs += 1;
      current.minutes += Math.max(1, Math.floor(durationSeconds(row.startedAt, row.stoppedAt) / 60));
      current.live = current.live || row.isLive;
      bySession.set(row.sessionId, current);
    }

    return [...bySession.values()].sort((a, b) => b.runs - a.runs || b.minutes - a.minutes).slice(0, 6);
  })();

  $: if (completedRows.length === 0 && completedPage !== 1) {
    completedPage = 1;
  }
</script>

<section class="space-y-4">
  <header class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{$t("stats.overview")}</p>
        <div class="mt-0.5 flex items-center gap-2">
          <h3 class="text-xl font-black text-slate-800 sm:text-2xl dark:text-slate-100">{$t("stats.title")}</h3>
          <button
            class="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 sm:h-9 sm:w-9 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={loadBroadcastLog}
            title={$t("stats.refresh")}
            aria-label={$t("stats.refresh")}
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
              <path d="M21 2v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M3 22v-6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{$t("stats.period_12_days")}</span>
      </div>
    </div>
  </header>

  <section class="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-[11px] uppercase tracking-wide text-slate-500">{$t("stats.total_streams")}</p>
      <p class="mt-1 text-xl font-black text-slate-800 sm:text-2xl dark:text-slate-100">{totalRuns}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">{$t("stats.log_entries")}</p>
    </article>
    <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-[11px] uppercase tracking-wide text-slate-500">{$t("stats.current_live")}</p>
      <p class="mt-1 text-xl font-black text-slate-800 sm:text-2xl dark:text-slate-100">{liveRows.length}</p>
      <p class="text-xs text-red-600 dark:text-red-400">{$t("stats.running_streams")}</p>
    </article>
    <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-[11px] uppercase tracking-wide text-slate-500">{$t("stats.finished_streams")}</p>
      <p class="mt-1 text-xl font-black text-slate-800 sm:text-2xl dark:text-slate-100">{completedRuns}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">{$t("stats.stopped_streams")}</p>
    </article>
    <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-[11px] uppercase tracking-wide text-slate-500">{$t("stats.total_duration")}</p>
      <p class="mt-1 text-lg font-black text-slate-800 sm:text-2xl dark:text-slate-100">{formatSeconds(totalSeconds)}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">{$t("stats.all_sessions")}</p>
    </article>
    <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p class="text-[11px] uppercase tracking-wide text-slate-500">{$t("stats.active_sessions")}</p>
      <p class="mt-1 text-xl font-black text-slate-800 sm:text-2xl dark:text-slate-100">{totalSessions}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">{$t("stats.configured_sessions")}</p>
    </article>
  </section>

  <section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
    <article class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
      <div class="mb-3 flex items-center justify-between">
        <h4 class="text-base font-black text-slate-800 dark:text-slate-100">{$t("stats.timeline")}</h4>
        <div class="flex items-center gap-2 text-[10px] text-slate-500 sm:gap-3 sm:text-[11px]">
          <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-blue-600"></span>{$t("stats.starts")}</span>
          <span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-amber-500"></span>{$t("stats.minutes")}</span>
        </div>
      </div>

      <div class="grid grid-cols-12 gap-1 sm:gap-2">
        {#each chartBars as bar}
          <div class="space-y-1">
            <div class="flex h-24 items-end justify-center gap-1 rounded-lg bg-slate-50 px-1 pb-2 sm:h-36 dark:bg-slate-800/60">
              <div class="w-2 rounded-sm bg-blue-600 sm:w-2.5" style={`height:${Math.max(6, (bar.runs / chartRunsMax) * 100)}%`}></div>
              <div class="w-2 rounded-sm bg-amber-500 sm:w-2.5" style={`height:${Math.max(6, (bar.minutes / chartMinutesMax) * 100)}%`}></div>
            </div>
            <p class="truncate text-center text-[10px] font-semibold text-slate-500">{bar.dayLabel}</p>
          </div>
        {/each}
      </div>
    </article>

    <article class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
      <h4 class="text-base font-black text-slate-800 dark:text-slate-100">{$t("stats.live_session")}</h4>
      <div class="mt-3">
        {#if currentLive}
          <div class="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-900/15">
            <p class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-red-700 dark:bg-red-900/35 dark:text-red-200">
              <span class="h-2 w-2 rounded-full bg-red-500"></span>
              {$t("stats.live")}
            </p>
            <p class="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{currentLive.sessionName}</p>
            <p class="text-[11px] text-slate-500">{$t("stats.start")}: {formatDateTime(currentLive.startedAt)}</p>
            <p class="text-[11px] text-slate-500">{$t("stats.duration")}: {formatSeconds(durationSeconds(currentLive.startedAt, null))}</p>
          </div>
        {:else}
          <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
            {$t("stats.no_live_session")}
          </div>
        {/if}
      </div>

      <h4 class="mt-4 text-base font-black text-slate-800 dark:text-slate-100">{$t("stats.top_sessions")}</h4>
      <div class="mt-2 space-y-2">
        {#if sessionRows.length === 0}
          <p class="text-sm text-slate-500 dark:text-slate-400">{$t("stats.no_data")}</p>
        {:else}
          {#each sessionRows as session}
            <div class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{session.name}</p>
                <p class="text-[11px] text-slate-500">{session.minutes} {$t("stats.min_total")}</p>
              </div>
              <div class="flex items-center gap-2">
                {#if session.live}
                  <span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-900/35 dark:text-red-200">
                    <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                    {$t("stats.live")}
                  </span>
                {/if}
                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{session.runs} {$t("stats.runs")}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </article>
  </section>

  <section class="grid gap-4 xl:grid-cols-2">
    <article class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
      <h4 class="text-base font-black text-slate-800 dark:text-slate-100">{$t("stats.runtime_distribution")}</h4>
      <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">{$t("stats.evaluated_sessions")}: {donutTotal}</p>

      <div class="mt-4 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div class="flex h-3 w-full">
          {#each runtimeSegments as segment}
            <div class={`${segment.colorClass} h-full`} style={`width:${segment.percent}%`}></div>
          {/each}
        </div>
      </div>

      <div class="mt-4 space-y-2">
        {#each runtimeSegments as segment}
          <div class="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="inline-flex items-center gap-2">
                <span class={`h-2.5 w-2.5 rounded-full ${segment.colorClass}`}></span>
                {segment.label}
              </span>
              <span class="font-semibold">{segment.count} ({Math.round(segment.percent)}%)</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div class={`${segment.colorClass} h-full`} style={`width:${segment.percent}%`}></div>
            </div>
          </div>
        {/each}
      </div>
    </article>

    <article class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
      <h4 class="text-base font-black text-slate-800 dark:text-slate-100">{$t("stats.share_by_session")}</h4>
      <div class="mt-3 space-y-2">
        {#if sessionRows.length === 0}
          <p class="text-sm text-slate-500 dark:text-slate-400">{$t("stats.no_data")}</p>
        {:else}
          {#each sessionRows as session, index}
            <div class="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <p class="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{index + 1}. {session.name}</p>
              <p class="text-sm font-semibold text-slate-600 dark:text-slate-300">{percent(session.runs, totalRuns)}%</p>
            </div>
          {/each}
        {/if}
      </div>
    </article>
  </section>

  <section class="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4 dark:border-slate-800 dark:bg-slate-900">
    <div class="mb-3 flex items-center justify-between">
      <h4 class="text-base font-black text-slate-800 dark:text-slate-100">{$t("stats.log_title")}</h4>
      <p class="text-xs text-slate-500">{$t("stats.average")}: {formatSeconds(averageSeconds)}</p>
    </div>

    <div class="space-y-2 md:hidden">
      {#if currentLive}
        <article class="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-900/15">
          <div class="mb-2 flex items-center justify-between gap-2">
            <p class="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{currentLive.sessionName}</p>
            <span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/35 dark:text-red-200">
              <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
              {$t("stats.live")}
            </span>
          </div>
          <p class="text-xs text-slate-500">{$t("stats.start")}: {formatDateTime(currentLive.startedAt)}</p>
          <p class="text-xs text-slate-500">{$t("stats.duration")}: {formatSeconds(durationSeconds(currentLive.startedAt, null))}</p>
        </article>
      {/if}

      {#if completedRows.length === 0}
        {#if !currentLive}
          <p class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
            {$t("stats.no_completed_sessions")}
          </p>
        {/if}
      {:else}
        {#each completedPageRows as row}
          <article class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{row.sessionName}</p>
              <span class="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/35 dark:text-orange-300">{$t("stats.finished")}</span>
            </div>
            <p class="text-xs text-slate-500">{$t("stats.start")}: {formatDateTime(row.startedAt)}</p>
            <p class="text-xs text-slate-500">{$t("stats.stop")}: {formatDateTime(row.stoppedAt)}</p>
            <p class="text-xs text-slate-500">{$t("stats.duration")}: {formatSeconds(durationSeconds(row.startedAt, row.stoppedAt))}</p>
          </article>
        {/each}
      {/if}
    </div>

    <div class="hidden overflow-x-auto md:block">
      <table class="hidden min-w-full text-sm md:table">
        <thead>
          <tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
            <th class="px-3 py-2">{$t("common.session")}</th>
            <th class="px-3 py-2">{$t("stats.status")}</th>
            <th class="px-3 py-2">{$t("stats.start")}</th>
            <th class="px-3 py-2">{$t("stats.stop")}</th>
            <th class="px-3 py-2">{$t("stats.duration")}</th>
          </tr>
        </thead>
        <tbody>
          {#if currentLive}
            <tr class="border-b border-slate-100 bg-red-50/70 dark:border-slate-800 dark:bg-red-950/20">
              <td class="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{currentLive.sessionName}</td>
              <td class="px-3 py-2">
                <span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-900/35 dark:text-red-200">
                  <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                  {$t("stats.live")}
                </span>
              </td>
              <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{formatDateTime(currentLive.startedAt)}</td>
              <td class="px-3 py-2 text-slate-600 dark:text-slate-300">-</td>
              <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{formatSeconds(durationSeconds(currentLive.startedAt, null))}</td>
            </tr>
          {/if}

          {#if completedRows.length === 0}
            <tr>
              <td colspan="5" class="px-3 py-6 text-center text-slate-500 dark:text-slate-400">{$t("stats.no_completed_sessions")}</td>
            </tr>
          {:else}
            {#each completedPageRows as row}
              <tr class="border-b border-slate-100 dark:border-slate-800">
                <td class="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{row.sessionName}</td>
                <td class="px-3 py-2">
                  <span class="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-900/35 dark:text-orange-300">{$t("stats.finished")}</span>
                </td>
                <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{formatDateTime(row.startedAt)}</td>
                <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{formatDateTime(row.stoppedAt)}</td>
                <td class="px-3 py-2 text-slate-600 dark:text-slate-300">{formatSeconds(durationSeconds(row.startedAt, row.stoppedAt))}</td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    {#if completedRows.length > 0}
      <div class="mt-3 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p class="text-xs text-slate-500 dark:text-slate-400">
          {$t("stats.page")} {completedPage} / {completedTotalPages}
        </p>
        <div class="flex w-full items-center justify-end gap-2 sm:w-auto">
          <button
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={() => (completedPage = Math.max(1, completedPage - 1))}
            disabled={completedPage <= 1}
            type="button"
          >
            {$t("stats.previous_page")}
          </button>
          <button
            class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={() => (completedPage = Math.min(completedTotalPages, completedPage + 1))}
            disabled={completedPage >= completedTotalPages}
            type="button"
          >
            {$t("stats.next_page")}
          </button>
        </div>
      </div>
    {/if}

    {#if $app.broadcastLogStatus}
      <p class="mt-3 text-sm text-red-600 dark:text-red-400">{$app.broadcastLogStatus}</p>
    {/if}
  </section>
</section>
