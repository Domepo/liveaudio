<script lang="ts">
  import { createEventDispatcher } from "svelte";

  import { t } from "../i18n";
  import DropdownSelect from "./ui/DropdownSelect.svelte";
  import type { AdminRole, AdminUser } from "../types/admin";

  type UserUpdatePayload = {
    userId: string;
    name: string;
    role: AdminRole;
    password?: string;
  };

  export let adminAuthenticatedName = "";
  export let adminUsers: AdminUser[] = [];
  export let adminRoles: AdminRole[] = ["ADMIN", "BROADCASTER", "VIEWER"];
  export let createUserName = "";
  export let createUserPassword = "";
  export let createUserRole: AdminRole = "VIEWER";

  const dispatch = createEventDispatcher<{
    refreshUsers: void;
    createUser: void;
    createUserNameChange: { value: string };
    createUserPasswordChange: { value: string };
    createUserRoleChange: { value: AdminRole };
    updateUser: UserUpdatePayload;
    deleteUser: { userId: string; name: string };
  }>();

  let editingUserId = "";
  let editName = "";
  let editRole: AdminRole = "VIEWER";
  let editPassword = "";
  let expandedSessionUserId = "";
  let createCardOpen = false;
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,200}$/;

  $: canCreateUser = createUserName.trim().length > 0 && strongPasswordRegex.test(createUserPassword);
  $: canSaveUserEdit = editingUserId && editName.trim().length > 1 && (!editPassword || strongPasswordRegex.test(editPassword));
  $: roleOptions = adminRoles.map((role) => ({ value: role, label: roleLabel(role) }));

  function startEdit(user: AdminUser): void {
    editingUserId = user.id;
    editName = user.name;
    editRole = user.role;
    editPassword = "";
  }

  function cancelEdit(): void {
    editingUserId = "";
    editName = "";
    editRole = adminRoles[0] ?? "VIEWER";
    editPassword = "";
  }

  function saveEdit(): void {
    if (!editingUserId) return;
    dispatch("updateUser", {
      userId: editingUserId,
      name: editName.trim(),
      role: editRole,
      ...(editPassword ? { password: editPassword } : {})
    });
    cancelEdit();
  }

  function roleChipClass(role: AdminRole): string {
    if (role === "ADMIN") return "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300";
    if (role === "BROADCASTER") return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
    return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }

  function roleLabel(role: AdminRole): string {
    if (role === "ADMIN") return $t("common.role_admin");
    if (role === "BROADCASTER") return $t("common.role_broadcaster");
    return $t("common.role_viewer");
  }

  function toggleSessionExpand(userId: string): void {
    expandedSessionUserId = expandedSessionUserId === userId ? "" : userId;
  }

  function submitCreateUser(): void {
    if (!canCreateUser) return;
    dispatch("createUser");
    createCardOpen = false;
  }
</script>

<div class="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
  <div class="flex flex-wrap items-center gap-2">
    <h3 class="text-lg font-black sm:text-xl">{$t("users.title")}</h3>
    <div class="flex items-center gap-2">
      <button
        class="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-orange-300 bg-orange-50 px-3 text-sm font-bold text-orange-700 transition hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300 dark:hover:bg-orange-900/35"
        onclick={() => (createCardOpen = true)}
        title={$t("users.new_user")}
        aria-label={$t("users.new_user")}
        type="button"
      >
        <span class="-mt-px text-base leading-none">+</span>
        <span class="hidden leading-none sm:inline">{$t("users.new_user")}</span>
      </button>
      <button
        class="grid h-9 w-9 place-items-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        onclick={() => dispatch("refreshUsers")}
        title={$t("users.refresh_list")}
        aria-label={$t("users.refresh_list")}
        type="button"
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
  <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">{$t("users.logged_in_as")}: {adminAuthenticatedName || "-"}</p>

  {#if adminUsers.length === 0}
    <p class="mt-5 text-sm text-slate-500 dark:text-slate-400">{$t("users.empty")}</p>
  {:else}
    <div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {#each adminUsers as user}
        {@const allSessions = user.sessions ?? []}
        {@const visibleSessions = allSessions.slice(0, 3)}
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div class="flex items-start justify-between gap-2">
            {#if editingUserId === user.id}
              <input class="w-full rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" bind:value={editName} />
            {:else}
              <h4 class="min-w-0 truncate text-base font-bold">{user.name}</h4>
            {/if}
            <span class={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleChipClass(user.role)}`}>{roleLabel(user.role)}</span>
          </div>

          <p class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{$t("users.created")}: {new Date(user.createdAt).toLocaleString()}</p>

          <div class="mt-3">
            <p class="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{$t("common.sessions")}</p>
            {#if allSessions.length === 0}
              <span class="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{$t("users.no_session")}</span>
            {:else}
              <div class="flex flex-wrap gap-1.5">
                {#each visibleSessions as session}
                  <span class="inline-flex max-w-full truncate rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{session.name}</span>
                {/each}
                {#if allSessions.length > 3}
                  <button
                    class="inline-flex rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    onclick={() => toggleSessionExpand(user.id)}
                  >
                    {allSessions.length} {$t("common.sessions")}
                  </button>
                {/if}
              </div>
              {#if allSessions.length > 3 && expandedSessionUserId === user.id}
                <div class="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/70">
                  <div class="flex flex-wrap gap-1.5">
                    {#each allSessions as session}
                      <span class="inline-flex max-w-full truncate rounded-full bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">{session.name}</span>
                    {/each}
                  </div>
                </div>
              {/if}
            {/if}
          </div>

          <div class="mt-3 space-y-2">
            {#if editingUserId === user.id}
              <DropdownSelect options={roleOptions} bind:value={editRole} triggerClass="h-8 px-2 py-1 text-xs bg-white dark:bg-slate-900" />
              <label class="text-[11px] font-semibold text-slate-500 dark:text-slate-400" for={`password-${user.id}`}>{$t("users.new_password_optional")}</label>
              <input id={`password-${user.id}`} class="w-full rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" type="password" bind:value={editPassword} placeholder={$t("users.new_password_placeholder")} />
            {/if}
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            {#if editingUserId === user.id}
              <button class="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60" onclick={saveEdit} disabled={!canSaveUserEdit}>{$t("common.save")}</button>
              <button class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs dark:border-slate-700" onclick={cancelEdit}>{$t("common.cancel")}</button>
            {:else}
              <button
                class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                onclick={() => startEdit(user)}
                title={$t("users.edit")}
                aria-label={$t("users.edit")}
                type="button"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                  <path d="M12 20h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </button>
              <button
                class="grid h-8 w-8 place-items-center rounded-lg border border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-900/20"
                onclick={() => dispatch("deleteUser", { userId: user.id, name: user.name })}
                title={$t("common.delete")}
                aria-label={$t("common.delete")}
                type="button"
              >
                <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                  <path d="M3 6h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  <path d="M10 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  <path d="M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  {#if createCardOpen}
    <div class="fixed inset-0 z-50 grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={$t("users.new_user_dialog")}>
      <button class="absolute inset-0 cursor-default" aria-label={$t("common.close")} onclick={() => (createCardOpen = false)}></button>
      <div class="relative z-10 w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <p class="text-lg font-black text-slate-800 dark:text-slate-100">{$t("users.new_user")}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">{$t("users.new_user_description")}</p>
          </div>
          <button
            class="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onclick={() => (createCardOpen = false)}
            aria-label={$t("common.close")}
            type="button"
          >
            x
          </button>
        </div>

        <label for="create-user-name" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("common.name")}</label>
        <input
          id="create-user-name"
          type="text"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          value={createUserName}
          oninput={(event) => dispatch("createUserNameChange", { value: (event.target as HTMLInputElement).value })}
          placeholder={$t("users.name_placeholder")}
        />

        <label for="create-user-password" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("common.password")}</label>
        <input
          id="create-user-password"
          type="password"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          value={createUserPassword}
          oninput={(event) => dispatch("createUserPasswordChange", { value: (event.target as HTMLInputElement).value })}
          placeholder={$t("users.password_placeholder")}
        />

        <label for="create-user-role" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">{$t("users.role")}</label>
        <div class="mt-2">
          <DropdownSelect
            options={roleOptions}
            value={createUserRole}
            on:change={(event) => dispatch("createUserRoleChange", { value: event.detail.value as AdminRole })}
            triggerClass="h-11 rounded-xl bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus-within:border-orange-300 focus-within:ring-4 focus-within:ring-orange-200/60 dark:bg-slate-800 dark:focus-within:border-orange-700 dark:focus-within:ring-orange-900/30"
          />
        </div>

        <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            class="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-200"
            onclick={submitCreateUser}
            disabled={!canCreateUser}
            type="button"
          >
            {$t("common.create")}
          </button>
          <button
            class="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onclick={() => (createCardOpen = false)}
            type="button"
          >
            {$t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
