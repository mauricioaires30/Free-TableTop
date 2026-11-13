<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { active, go } from '../lib/router.svelte';
  import { GmSession } from '../lib/session/gm.svelte';
  import { ensurePermission, FsStore, getRecent, IdbStore, rememberCampaign, type RecentCampaign } from '../lib/storage/store';
  import Table from './Table.svelte';

  let { roomId }: { roomId: string } = $props();

  let session = $state<GmSession | null>(active.gm?.roomId === roomId ? active.gm : null);
  let recent = $state<RecentCampaign | null>(null);
  let error = $state('');
  let loading = $state(false);

  onMount(async () => {
    if (!session) recent = (await getRecent(roomId)) ?? null;
  });

  // Ao recarregar a página, o navegador exige um clique para liberar a pasta de novo.
  async function reopen() {
    if (!recent) return;
    loading = true;
    error = '';
    try {
      let store;
      if (recent.kind === 'fs') {
        if (!recent.handle || !(await ensurePermission(recent.handle))) throw new Error('Sem permissão para acessar a pasta.');
        store = new FsStore(recent.handle);
      } else {
        store = new IdbStore(recent.roomId);
      }
      const s = await GmSession.open(store);
      if (!s) throw new Error('Campanha não encontrada na pasta.');
      await rememberCampaign({ ...recent, name: s.campaignName, lastOpened: Date.now() });
      active.gm = s;
      session = s;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function beforeUnload(e: BeforeUnloadEvent) {
    if (session && session.saving !== 'idle') {
      void session.flush();
      e.preventDefault();
    }
  }

  onDestroy(() => {
    session?.destroy();
    if (active.gm === session) active.gm = null;
  });
</script>

<svelte:window onbeforeunload={beforeUnload} />

{#if session}
  <Table {session} gm={session} />
{:else}
  <div class="center">
    <div class="card box">
      {#if recent}
        <h2>{recent.name}</h2>
        <p class="muted">Para continuar a mesa, libere o acesso à pasta da campanha.</p>
        {#if error}<p class="err">{error}</p>{/if}
        <div class="row">
          <button class="primary" onclick={reopen} disabled={loading}>{loading ? 'Abrindo…' : 'Reabrir campanha'}</button>
          <button onclick={() => go('/')}>Início</button>
        </div>
      {:else}
        <h2>Mesa não encontrada</h2>
        <p class="muted">Abra a campanha pela tela inicial.</p>
        <button class="primary" onclick={() => go('/')}>Ir para o início</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .center {
    display: grid;
    place-items: center;
    min-height: 100%;
    padding: 16px;
  }
  .box {
    width: min(420px, 100%);
  }
  .err {
    color: var(--danger);
  }
</style>
