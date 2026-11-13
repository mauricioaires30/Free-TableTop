<script lang="ts">
  import { router } from './lib/router.svelte';
  import Home from './views/Home.svelte';
  import GmPage from './views/GmPage.svelte';
  import PlayerPage from './views/PlayerPage.svelte';
</script>

{#if router.route.name === 'gm'}
  {#key router.route.roomId}
    <GmPage roomId={router.route.roomId} />
  {/key}
{:else if router.route.name === 'player'}
  {#key router.route.roomId + router.route.invite}
    <PlayerPage roomId={router.route.roomId} invite={router.route.invite} />
  {/key}
{:else}
  <Home />
{/if}
