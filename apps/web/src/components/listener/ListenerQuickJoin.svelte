<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../../i18n";
  import { app } from "../../stores/app";
  import { channelIsLive } from "../../controllers/channels";
  import { initListenerPlaybackController, toggleChannelPlayback } from "../../controllers/listener/playback";
  import { setListenerAudioEl } from "../../controllers/refs";

  let audioEl: HTMLAudioElement | null = null;
  $: setListenerAudioEl(audioEl);

  onMount(() => initListenerPlaybackController());
</script>

<section class="mx-auto max-w-5xl">
  <article class="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900/85">
    {#if $app.listenerSessionImageUrl}
      <img class="mb-4 h-48 w-full rounded-2xl object-cover" src={$app.listenerSessionImageUrl} alt={$app.listenerSessionName} />
    {/if}
    <h2 class="text-4xl font-black">{$app.listenerSessionName || $t("common.session")}</h2>
    {#if $app.listenerSessionDescription}
      <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{$app.listenerSessionDescription}</p>
    {/if}

    <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each ($app.settingsShowOfflineChannels ? $app.listenerChannels : $app.listenerChannels.filter((c) => channelIsLive(c.id, "listener"))) as channel}
        <button
          class={`rounded-2xl border p-4 text-left shadow-sm transition sm:p-5 ${
            $app.activeListeningChannelId === channel.id
              ? "border-orange-400 bg-orange-50/90 shadow-orange-100 dark:border-orange-500 dark:bg-orange-900/20"
              : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600"
          }`}
          onclick={() => toggleChannelPlayback(channel.id)}
        >
          <div class="flex items-center justify-between">
            <div>
              <p class="text-base font-bold sm:text-lg">{channel.name}</p>
              <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{channel.languageCode || $t("listener.audio_channel")}</p>
            </div>
            <span
              class={`grid h-10 w-10 place-items-center rounded-full text-lg sm:h-12 sm:w-12 sm:text-xl ${
                $app.activeListeningChannelId === channel.id && $app.isListening
                  ? "bg-orange-500 text-white"
                  : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100"
              }`}
              onclick={(event) => {
                event.stopPropagation();
                void toggleChannelPlayback(channel.id);
              }}
              role="button"
              tabindex="0"
              onkeydown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  void toggleChannelPlayback(channel.id);
                }
              }}
              aria-label={$app.activeListeningChannelId === channel.id && $app.isListening ? $t("common.pause") : $t("common.play")}
            >
              {#if $app.activeListeningChannelId === channel.id && $app.isListening}
                <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
                  <rect x="6.5" y="5" width="4.5" height="14" rx="1.5" fill="currentColor"></rect>
                  <rect x="13" y="5" width="4.5" height="14" rx="1.5" fill="currentColor"></rect>
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
                  <path d="M8 5.5L18.5 12L8 18.5V5.5Z" fill="currentColor"></path>
                </svg>
              {/if}
            </span>
          </div>
          <div class="mt-3 flex items-center justify-between">
            <p class={`text-[11px] font-semibold ${channelIsLive(channel.id, "listener") ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>
              {channelIsLive(channel.id, "listener") ? $t("common.live") : $t("common.offline")}
            </p>
            <span class="text-[11px] text-slate-400 dark:text-slate-500">
              {$app.activeListeningChannelId === channel.id && $app.isListening ? $t("common.playing") : $t("common.tap")}
            </span>
          </div>
        </button>
      {/each}
    </div>

    <audio bind:this={audioEl} class="hidden" controls></audio>
  </article>
</section>
