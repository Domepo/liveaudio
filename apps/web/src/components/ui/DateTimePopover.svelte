<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { onDestroy } from "svelte";
  import { locale, t } from "../../i18n";
  import DropdownSelect from "./DropdownSelect.svelte";

  export let label = "";
  export let value = "";

  let open = false;
  let rootEl: HTMLDivElement;
  let monthCursor = new Date();

  const dispatch = createEventDispatcher<{ change: { value: string } }>();

  function localeTag(): string {
    return $locale === "de" ? "de-DE" : $locale === "ru" ? "ru-RU" : $locale === "uk" ? "uk-UA" : "en-US";
  }

  function setValue(next: string): void {
    value = next;
    dispatch("change", { value: next });
  }

  function parseValue(raw: string): Date | null {
    if (!raw?.trim()) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  function toLocalDateTimeInput(date: Date): string {
    const pad = (num: number) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}`;
  }

  function formatDisplay(date: Date | null): string {
    if (!date) return $t("date.select");
    return date.toLocaleString(localeTag(), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function buildCalendarDays(cursor: Date): Array<{ key: string; date: Date; inMonth: boolean }> {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const startDate = new Date(firstOfMonth);
    startDate.setDate(firstOfMonth.getDate() - startOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
        date,
        inMonth: date.getMonth() === cursor.getMonth()
      };
    });
  }

  function sameDay(a: Date | null, b: Date): boolean {
    if (!a) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function syncMonthToValue(): void {
    const selected = parseValue(value) ?? new Date();
    monthCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
  }

  function toggleOpen(): void {
    open = !open;
    if (open) {
      syncMonthToValue();
      window.setTimeout(() => {
        document.addEventListener("mousedown", onOutsideClick);
        document.addEventListener("keydown", onKeyDown);
      }, 0);
    } else {
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("keydown", onKeyDown);
    }
  }

  function closePopup(): void {
    open = false;
    document.removeEventListener("mousedown", onOutsideClick);
    document.removeEventListener("keydown", onKeyDown);
  }

  function onOutsideClick(event: MouseEvent): void {
    if (!rootEl) return;
    if (!rootEl.contains(event.target as Node)) {
      closePopup();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") closePopup();
  }

  function shiftMonth(direction: number): void {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + direction, 1);
  }

  function setDay(date: Date): void {
    const base = parseValue(value) ?? new Date();
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), base.getHours(), base.getMinutes(), 0, 0);
    setValue(toLocalDateTimeInput(next));
  }

  function setToday(): void {
    const now = new Date();
    setValue(toLocalDateTimeInput(now));
    monthCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  function clearValue(): void {
    setValue("");
  }

  function setHour(nextValue: string): void {
    const selected = parseValue(value) ?? new Date();
    const hour = Number(nextValue);
    selected.setHours(Number.isFinite(hour) ? hour : 0);
    setValue(toLocalDateTimeInput(selected));
  }

  function setMinute(nextValue: string): void {
    const selected = parseValue(value) ?? new Date();
    const minute = Number(nextValue);
    selected.setMinutes(Number.isFinite(minute) ? minute : 0);
    setValue(toLocalDateTimeInput(selected));
  }

  function weekdayLabelsFor(current: Date): string[] {
    const formatter = new Intl.DateTimeFormat(localeTag(), { weekday: "short" });
    const monday = new Date(current);
    const day = monday.getDay();
    const offsetToMonday = day === 0 ? -6 : 1 - day;
    monday.setDate(monday.getDate() + offsetToMonday);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return formatter.format(date);
    });
  }

  function monthTitleFor(date: Date): string {
    return date.toLocaleDateString(localeTag(), { month: "long", year: "numeric" });
  }

  $: selectedDate = parseValue(value);
  $: monthTitle = monthTitleFor(monthCursor);
  $: calendarDays = buildCalendarDays(monthCursor);
  $: selectedHour = selectedDate ? selectedDate.getHours() : 0;
  $: selectedMinute = selectedDate ? selectedDate.getMinutes() : 0;
  $: weekdayLabels = weekdayLabelsFor(monthCursor);
  $: displayLabel = label || $t("date.datetime");

  onDestroy(() => {
    document.removeEventListener("mousedown", onOutsideClick);
    document.removeEventListener("keydown", onKeyDown);
  });
</script>

<div class="relative" bind:this={rootEl}>
  <span class="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{displayLabel}</span>
  <button
    class="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:border-orange-300 hover:bg-orange-50/50 focus:outline-none focus:ring-2 focus:ring-orange-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-orange-700 dark:hover:bg-orange-900/20 dark:focus:ring-orange-900/40"
    onclick={toggleOpen}
    type="button"
    aria-expanded={open}
  >
    <span>{formatDisplay(selectedDate)}</span>
    <svg viewBox="0 0 24 24" class={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  </button>

  {#if open}
    <div class="absolute left-0 z-30 mt-2 w-[20rem] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-300/40 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/40">
      <div class="mb-3 flex items-center justify-between">
        <button class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => shiftMonth(-1)} type="button" aria-label={$t("date.prev_month")}>
          <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </button>
        <p class="text-sm font-black">{monthTitle}</p>
        <button class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => shiftMonth(1)} type="button" aria-label={$t("date.next_month")}>
          <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </button>
      </div>

      <div class="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {#each weekdayLabels as day}
          <span>{day}</span>
        {/each}
      </div>

      <div class="grid grid-cols-7 gap-1">
        {#each calendarDays as day}
          {@const isSelected = sameDay(selectedDate, day.date)}
          <button
            type="button"
            class={`h-9 rounded-lg text-sm font-semibold transition ${
              isSelected
                ? "bg-orange-500 text-white"
                : day.inMonth
                  ? "text-slate-700 hover:bg-orange-50 dark:text-slate-200 dark:hover:bg-orange-900/20"
                  : "text-slate-400 hover:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-800"
            }`}
            onclick={() => setDay(day.date)}
          >
            {day.date.getDate()}
          </button>
        {/each}
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2">
        <label class="block text-xs font-semibold text-slate-500">{$t("date.hour")}
          <div class="mt-1">
            <DropdownSelect
              options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }))}
              value={String(selectedHour)}
              on:change={(event) => setHour(event.detail.value)}
              triggerClass="h-10 bg-white px-2 py-2 text-sm dark:bg-slate-950"
            />
          </div>
        </label>
        <label class="block text-xs font-semibold text-slate-500">{$t("date.minute")}
          <div class="mt-1">
            <DropdownSelect
              options={Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }))}
              value={String(selectedMinute)}
              on:change={(event) => setMinute(event.detail.value)}
              triggerClass="h-10 bg-white px-2 py-2 text-sm dark:bg-slate-950"
            />
          </div>
        </label>
      </div>

      <div class="mt-3 flex items-center justify-between gap-2">
        <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" type="button" onclick={clearValue}>{$t("date.clear")}</button>
        <div class="flex gap-2">
          <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" type="button" onclick={setToday}>{$t("date.now")}</button>
          <button class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600" type="button" onclick={closePopup}>{$t("date.done")}</button>
        </div>
      </div>
    </div>
  {/if}
</div>
