<script lang="ts">
  import { onMount } from "svelte";

  import AppShell from "./components/app/AppShell.svelte";
  import { initApp } from "./controllers/init";

  let cleanup: (() => void) | null = null;

  onMount(async () => {
    cleanup = await initApp();
    return () => {
      cleanup?.();
      cleanup = null;
    };
  });
</script>

<AppShell />

