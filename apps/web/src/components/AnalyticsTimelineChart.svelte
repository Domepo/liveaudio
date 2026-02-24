<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { init, use } from "echarts/core";
  import { CanvasRenderer } from "echarts/renderers";
  import { LineChart } from "echarts/charts";
  import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
  import type { ECharts, EChartsOption } from "echarts";
  import { locale, t } from "../i18n";

  export type TimelineSession = {
    sessionId: string;
    sessionName: string;
    series: Array<{ ts: number; value: number }>;
  };

  export let sessions: TimelineSession[] = [];
  export let metricLabel = "Metrik";
  export let from = "";
  export let to = "";
  export let granularity: "10s" | "1m" | "15m" | string = "1m";

  let chartEl: HTMLDivElement;
  let chart: ECharts | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const palette = ["#f97316", "#10b981", "#0ea5e9", "#8b5cf6", "#ef4444", "#eab308", "#14b8a6"];
  use([CanvasRenderer, LineChart, GridComponent, LegendComponent, TooltipComponent]);

  $: flattened = sessions.flatMap((session) => session.series.map((point) => point.value));
  $: maxValue = flattened.length ? Math.max(...flattened) : 0;
  $: minValue = flattened.length ? Math.min(...flattened) : 0;
  $: hasData = sessions.some((session) => session.series.length > 0);
  $: timeframeLabel = `${formatDateLabel(from)} - ${formatDateLabel(to)}`;
  $: granularityLabel =
    granularity === "10s"
      ? $t("analytics.granularity_10s")
      : granularity === "1m"
        ? $t("analytics.granularity_1m")
        : granularity === "15m"
          ? $t("analytics.granularity_15m")
          : String(granularity);
  $: dataMinTs = sessions.flatMap((session) => session.series.map((point) => point.ts)).reduce((acc, ts) => Math.min(acc, ts), Number.POSITIVE_INFINITY);
  $: dataMaxTs = sessions.flatMap((session) => session.series.map((point) => point.ts)).reduce((acc, ts) => Math.max(acc, ts), Number.NEGATIVE_INFINITY);
  $: fromTs = parseDateInput(from) ?? (Number.isFinite(dataMinTs) ? dataMinTs : Date.now() - 60 * 60 * 1000);
  $: toTs = parseDateInput(to) ?? (Number.isFinite(dataMaxTs) ? dataMaxTs : Date.now());
  $: rangeTs = Math.max(1, toTs - fromTs);
  $: localeTag = $locale === "de" ? "de-DE" : $locale === "ru" ? "ru-RU" : $locale === "uk" ? "uk-UA" : "en-US";

  function formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString(localeTag, { maximumFractionDigits: 1 }) : "0";
  }

  function formatDateLabel(value: string): string {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleString(localeTag);
  }

  function parseDateInput(value: string): number | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getTime();
  }

  function formatAxisTick(value: number): string {
    const date = new Date(value);
    if (rangeTs > 48 * 60 * 60 * 1000) {
      return date.toLocaleString(localeTag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    if (rangeTs > 6 * 60 * 60 * 1000) {
      return date.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function buildOption(): EChartsOption {
    const lineSeries = sessions.map((session) => ({
      name: session.sessionName,
      type: "line" as const,
      showSymbol: false,
      smooth: 0.2,
      lineStyle: { width: 2 },
      emphasis: { focus: "series" as const },
      data: session.series
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map((point) => [point.ts, point.value])
    }));

    return {
      color: palette,
      animation: true,
      grid: {
        left: 56,
        right: 20,
        top: 18,
        bottom: 78,
        containLabel: false
      },
      legend: {
        type: "scroll",
        top: 0,
        icon: "circle",
        textStyle: { color: "#475569" }
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (value) => (typeof value === "number" ? formatNumber(value) : String(value))
      },
      xAxis: {
        type: "time",
        min: fromTs,
        max: toTs,
        name: $t("analytics.time_axis"),
        nameLocation: "middle",
        nameGap: 34,
        axisLabel: {
          hideOverlap: true,
          color: "#64748b",
          formatter: (value: number) => formatAxisTick(value)
        },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
        axisLine: { lineStyle: { color: "#94a3b8" } }
      },
      yAxis: {
        type: "value",
        name: metricLabel,
        nameTextStyle: { color: "#64748b" },
        axisLabel: { color: "#64748b" },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
        axisLine: { show: true, lineStyle: { color: "#94a3b8" } }
      },
      series: lineSeries
    };
  }

  function updateChart(): void {
    if (!chart) return;
    if (!hasData) {
      chart.clear();
      return;
    }
    chart.setOption(buildOption(), true);
  }

  onMount(() => {
    chart = init(chartEl, undefined, { renderer: "canvas" });
    updateChart();

    resizeObserver = new ResizeObserver(() => {
      chart?.resize();
    });
    resizeObserver.observe(chartEl);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    chart?.dispose();
  });

  $: if (chart) {
    sessions;
    metricLabel;
    from;
    to;
    granularity;
    localeTag;
    updateChart();
  }
</script>

<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-lg font-black">{$t("analytics.timeline_title")}</h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">{$t("analytics.metric_by_session", { metric: metricLabel })}</p>
    </div>
    <div class="text-right text-xs text-slate-500 dark:text-slate-400">
      <p>{$t("analytics.period")}: <span class="font-semibold text-slate-900 dark:text-slate-100">{timeframeLabel}</span></p>
      <p>{$t("analytics.interval")}: <span class="font-semibold text-slate-900 dark:text-slate-100">{granularityLabel}</span></p>
      <p>{$t("analytics.values")}: <span class="font-semibold text-slate-900 dark:text-slate-100">{formatNumber(minValue)} - {formatNumber(maxValue)}</span></p>
    </div>
  </div>

  {#if hasData}
    <div class="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950">
      <div bind:this={chartEl} class="h-[420px] w-full"></div>
    </div>
  {:else}
    <div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      {$t("analytics.no_data_for_filter")}
    </div>
  {/if}
</section>
