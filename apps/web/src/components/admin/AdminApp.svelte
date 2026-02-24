<script lang="ts">
  import AdminLoginCard from "../AdminLoginCard.svelte";
  import { app } from "../../stores/app";
  import { adminChangePassword, adminLogin } from "../../controllers/admin/auth";

  import AdminMobileDrawer from "./AdminMobileDrawer.svelte";
  import AdminDashboard from "./AdminDashboard.svelte";
  import AdminTopHeader from "./AdminTopHeader.svelte";

  let currentPassword = "";
  let newPassword = "";
  let confirmPassword = "";

  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,200}$/;
  $: isStrongPassword = strongPasswordRegex.test(newPassword);
  $: canSubmitPasswordChange =
    !$app.adminPasswordChangeInFlight &&
    currentPassword.trim().length > 0 &&
    isStrongPassword &&
    confirmPassword === newPassword;

  async function submitForcedPasswordChange(): Promise<void> {
    if (!canSubmitPasswordChange) return;
    await adminChangePassword({
      currentPassword,
      newPassword,
      confirmPassword
    });
    currentPassword = "";
    newPassword = "";
    confirmPassword = "";
  }
</script>

<AdminMobileDrawer />

{#if !$app.adminAuthenticated}
  <section class="lv-admin-dashboard-wrap min-h-screen w-full bg-white p-4 dark:bg-slate-950">
    <AdminTopHeader />
    <AdminLoginCard
      adminName={$app.adminName}
      adminPassword={$app.adminPassword}
      isLoggingIn={$app.adminLoginInFlight}
      adminStatus={$app.adminStatus}
      on:adminNameChange={(event) => app.update((s) => ({ ...s, adminName: event.detail.value }))}
      on:adminPasswordChange={(event) => app.update((s) => ({ ...s, adminPassword: event.detail.value }))}
      on:login={adminLogin}
    />
  </section>
{:else}
  {#if $app.mustChangeAdminPassword}
    <section class="lv-admin-dashboard-wrap min-h-screen w-full bg-white p-4 dark:bg-slate-950">
      <AdminTopHeader />
      <div class="mx-auto mt-8 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 class="text-xl font-black text-slate-900 dark:text-slate-100">Passwort direkt aendern</h2>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Der Initial-Login ist nur einmal erlaubt. Setze jetzt sofort ein sicheres Passwort.
        </p>

        <label for="current-password" class="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Aktuelles Passwort</label>
        <input
          id="current-password"
          type="password"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          bind:value={currentPassword}
          autocomplete="current-password"
        />

        <label for="new-password" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Neues Passwort</label>
        <input
          id="new-password"
          type="password"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          bind:value={newPassword}
          autocomplete="new-password"
        />
        <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">Mindestens 10 Zeichen inkl. Gross/Kleinbuchstabe, Zahl und Sonderzeichen.</p>

        <label for="confirm-password" class="mt-3 block text-xs font-bold uppercase tracking-wide text-slate-500">Passwort bestaetigen</label>
        <input
          id="confirm-password"
          type="password"
          class="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-200/60 dark:border-slate-700 dark:bg-slate-800 dark:focus:border-orange-700 dark:focus:ring-orange-900/30"
          bind:value={confirmPassword}
          autocomplete="new-password"
        />

        <button
          class="mt-4 w-full rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-slate-200"
          onclick={submitForcedPasswordChange}
          disabled={!canSubmitPasswordChange}
          type="button"
        >
          {$app.adminPasswordChangeInFlight ? "Speichern..." : "Passwort aendern"}
        </button>
      </div>
    </section>
  {:else}
    <AdminDashboard />
  {/if}
{/if}
