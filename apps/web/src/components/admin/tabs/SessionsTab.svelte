<script lang="ts">
  import { deleteSession, loadAdminSessions } from "../../../controllers/admin/sessions";
  import { handleCreateImageUpload } from "../../../controllers/images";
  import { goToAdminSession } from "../../../controllers/routing";
  import { createAdminSession } from "../../../controllers/sessionDetail/meta";
  import { t } from "../../../i18n";
  import { app } from "../../../stores/app";

  let createCardOpen = false;

  async function submitCreateSession(): Promise<void> {
    if (!$app.createSessionName.trim()) return;
    await createAdminSession();
    createCardOpen = false;
  }
</script>

<section>
  <div class="mb-4 flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h3 class="text-2xl font-black">{$t("admin.existing_sessions")}</h3>
      <button
        class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        onclick={loadAdminSessions}
        title={$t("admin.refresh_sessions")}
        aria-label={$t("admin.refresh_sessions")}
      >
        <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
          <path d="M21 2v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M3 22v-6h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </button>
      <button
        class="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-orange-300 bg-orange-50 px-3 text-sm font-bold text-orange-700 transition hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300 dark:hover:bg-orange-900/35"
        onclick={() => (createCardOpen = true)}
        title={$t("admin.new_session")}
        aria-label={$t("admin.new_session")}
      >
        <span class="-mt-px text-base leading-none">+</span>
        <span class="hidden leading-none sm:inline">{$t("admin.new_session")}</span>
      </button>
    </div>
  </div>

  <div class="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-4 lg:gap-8">
    {#each $app.adminSessions as session}
      <div class="group mx-auto flex h-full w-full max-w-[400px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div class="h-29 w-full bg-slate-200 dark:bg-slate-800">
          {#if session.imageUrl}
            <img class="h-full w-full object-cover" src={session.imageUrl} alt={session.name} />
          {/if}
        </div>
        <div class="flex flex-1 flex-col p-4">
          <div class="flex items-start justify-between gap-2">
            <button class="truncate text-left text-lg font-bold group-hover:text-orange-500" onclick={() => goToAdminSession(session.id)}>{session.name}</button>
            <button
              class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              onclick={() => deleteSession(session.id)}
              type="button"
              title={$t("common.delete")}
              aria-label={$t("common.delete")}
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
            </button>
          </div>
          <p class="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{session.description || "-"}</p>
          <div class="mt-auto pt-3 flex flex-nowrap gap-2 text-[11px] font-semibold md:flex-wrap">
            <span class="hidden rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800 md:inline-flex">{session.channelsCount} {$t("admin.kpi_channels")}</span>
            <span class="shrink-0 rounded-full bg-orange-100 px-2.5 py-1 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">{session.listenersConnected} {$t("admin.kpi_listeners")}</span>
            <span class="hidden shrink-0 rounded-full bg-orange-100 px-2.5 py-1 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 md:inline-flex">{session.activeProducerChannels} {$t("common.live")}</span>
          </div>
        </div>
      </div>
    {/each}
  </div>

  {#if createCardOpen}
    <div class="fixed inset-0 z-50 grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={$t("admin.new_session_aria")}>
      <button class="absolute inset-0 cursor-default" aria-label={$t("common.close")} onclick={() => (createCardOpen = false)}></button>
      <div class="relative z-10 w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <p class="text-lg font-black text-slate-800 dark:text-slate-100">{$t("admin.new_session")}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{$t("admin.new_session_description")}</p>
          </div>
          <button
            class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={() => (createCardOpen = false)}
            aria-label={$t("common.close")}
          >
            x
          </button>
        </div>

        <label for="create-session-name" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("admin.session_name")}</label>
        <input
          id="create-session-name"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          value={$app.createSessionName}
          oninput={(event) => app.update((s) => ({ ...s, createSessionName: (event.target as HTMLInputElement).value }))}
          placeholder="Sunday Service"
        />

        <label for="create-session-description" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("common.description")}</label>
        <textarea
          id="create-session-description"
          class="mt-2 min-h-[100px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          value={$app.createSessionDescription}
          oninput={(event) => app.update((s) => ({ ...s, createSessionDescription: (event.target as HTMLTextAreaElement).value }))}
          placeholder="..."
        ></textarea>

        <label for="create-session-image" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("common.image_url")} (URL / Upload)</label>
        <input
          id="create-session-image"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          value={$app.createSessionImageUrl}
          oninput={(event) => app.update((s) => ({ ...s, createSessionImageUrl: (event.target as HTMLInputElement).value }))}
          placeholder="https://..."
        />

        <input id="create-session-file-input" class="hidden" type="file" accept="image/*" onchange={handleCreateImageUpload} />
        <button
          class="mt-2 w-full rounded-xl border border-dashed border-orange-300 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-300 dark:hover:bg-orange-900/30"
          onclick={() => {
            const fileInput = document.getElementById("create-session-file-input") as HTMLInputElement | null;
            fileInput?.click();
          }}
        >
          {$t("admin.upload_image")}
        </button>

        {#if $app.createSessionImageUrl}
          <img class="mt-3 h-28 w-full rounded-xl object-cover" src={$app.createSessionImageUrl} alt={$t("admin.session_preview_alt")} />
        {/if}

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            class="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-200"
            onclick={submitCreateSession}
            disabled={!$app.createSessionName.trim()}
          >
            {$t("common.create")}
          </button>
          <button
            class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onclick={() => (createCardOpen = false)}
          >
            {$t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
