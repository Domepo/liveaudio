<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export type DropdownOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  export let options: DropdownOption[] = [];
  export let value = "";
  export let placeholder = "Auswaehlen";
  export let disabled = false;
  export let triggerClass = "";
  export let menuClass = "";

  const dispatch = createEventDispatcher<{ change: { value: string } }>();

  $: selectedOption = options.find((option) => option.value === value) ?? null;

  function selectValue(next: string, event: Event): void {
    if (disabled) return;
    value = next;
    dispatch("change", { value: next });
    (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
  }
</script>

<details class={`relative w-full ${disabled ? "pointer-events-none opacity-60" : ""}`}>
  <summary
    class={`flex h-9 cursor-pointer list-none items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-left text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 [&::-webkit-details-marker]:hidden ${triggerClass}`}
  >
    <span class="truncate">{selectedOption?.label ?? placeholder}</span>
    <svg viewBox="0 0 24 24" class="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true">
      <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  </summary>

  <div class={`absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${menuClass}`}>
    {#if options.length === 0}
      <div class="px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400">{placeholder}</div>
    {:else}
      {#each options as option}
        <button
          class={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
            value === option.value
              ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
              : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          } ${option.disabled ? "pointer-events-none opacity-50" : ""}`}
          onclick={(event) => selectValue(option.value, event)}
          type="button"
          disabled={option.disabled}
        >
          <span class="truncate">{option.label}</span>
          {#if value === option.value}
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</details>
