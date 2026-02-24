<script lang="ts">
  import { app } from "../../stores/app";
  import ListenerQuickJoin from "./ListenerQuickJoin.svelte";
  import ListenerTokenJoin from "./ListenerTokenJoin.svelte";
  import ListenerQrPopup from "./ListenerQrPopup.svelte";
</script>

{#if $app.isQuickJoinMode}
  <ListenerQuickJoin />
{:else}
  <ListenerTokenJoin />
{/if}

<ListenerQrPopup />

