<script lang="ts">
  import { createEventDispatcher } from "svelte";
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
    updateUser: UserUpdatePayload;
  }>();

  let editingUserId = "";
  let editName = "";
  let editRole: AdminRole = "VIEWER";
  let editPassword = "";

  $: canCreateUser = createUserName.trim().length > 0 && createUserPassword.length >= 6;
  $: canSaveUserEdit = editingUserId && editName.trim().length > 1;

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
</script>

<div class="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
  <h3 class="text-xl font-black">Nutzerverwaltung</h3>
  <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">Eingeloggt als: {adminAuthenticatedName || "-"}</p>

  <div class="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <p class="text-sm font-semibold">Neuen Benutzer anlegen</p>
    <label for="create-user-name" class="mt-3 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Name</label>
    <input id="create-user-name" type="text" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" bind:value={createUserName} />

    <label for="create-user-password" class="mt-3 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Passwort</label>
    <input id="create-user-password" type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" bind:value={createUserPassword} />

    <label for="create-user-role" class="mt-3 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Rolle</label>
    <select id="create-user-role" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" bind:value={createUserRole}>
      {#each adminRoles as role}
        <option value={role}>{role}</option>
      {/each}
    </select>

    <div class="mt-3 flex gap-2">
      <button class="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onclick={() => dispatch("refreshUsers")}>Liste aktualisieren</button>
      <button class="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60" onclick={() => dispatch("createUser")} disabled={!canCreateUser}>Benutzer anlegen</button>
    </div>
  </div>

  <div class="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <p class="text-sm font-semibold">Benutzerliste</p>
    {#if adminUsers.length === 0}
      <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Noch keine Benutzer vorhanden.</p>
    {:else}
      <div class="mt-2 overflow-auto">
        <table class="min-w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="py-1">Name</th>
              <th class="py-1">Rolle</th>
              <th class="py-1">Passwort</th>
              <th class="py-1">Erstellt</th>
              <th class="py-1">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {#each adminUsers as user}
              <tr class="border-t border-slate-200 dark:border-slate-700">
                <td class="py-1">
                  {#if editingUserId === user.id}
                    <input class="w-44 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" bind:value={editName} />
                  {:else}
                    <span class="font-semibold">{user.name}</span>
                  {/if}
                </td>
                <td class="py-1">
                  {#if editingUserId === user.id}
                    <select class="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" bind:value={editRole}>
                      {#each adminRoles as role}
                        <option value={role}>{role}</option>
                      {/each}
                    </select>
                  {:else}
                    <span>{user.role}</span>
                  {/if}
                </td>
                <td class="py-1">
                  {#if editingUserId === user.id}
                    <input class="w-40 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" type="password" bind:value={editPassword} placeholder="neu (optional)" />
                  {:else}
                    <span class="text-slate-400">••••••</span>
                  {/if}
                </td>
                <td class="py-1">{new Date(user.createdAt).toLocaleString()}</td>
                <td class="py-1">
                  {#if editingUserId === user.id}
                    <div class="flex gap-1">
                      <button class="rounded-lg bg-orange-500 px-2 py-1 text-white disabled:opacity-60" onclick={saveEdit} disabled={!canSaveUserEdit}>Speichern</button>
                      <button class="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700" onclick={cancelEdit}>Abbrechen</button>
                    </div>
                  {:else}
                    <button class="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-700" onclick={() => startEdit(user)}>Bearbeiten</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

</div>
