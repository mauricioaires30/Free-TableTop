<script lang="ts">
  import { onDestroy } from 'svelte';
  import { colorFor } from '@ftt/shared';
  import { go } from '../lib/router.svelte';
  import { myPlayerId, saveName, savedName } from '../lib/config';
  import { PlayerSession } from '../lib/session/player.svelte';
  import Table from './Table.svelte';

  let { roomId, invite }: { roomId: string; invite: string } = $props();

  const pid = myPlayerId();
  let name = $state(savedName());
  let session = $state<PlayerSession | null>(null);

  function join() {
    const n = name.trim().slice(0, 32);
    if (!n) return;
    saveName(n);
    session = new PlayerSession(roomId, invite, pid, n);
  }

  function leave() {
    session?.destroy();
    session = null;
  }

  onDestroy(() => session?.destroy());
</script>

{#if session && session.status !== 'fatal'}
  <Table {session} onLeave={leave} />
{:else}
  <div class="center">
    <div class="card box">
      {#if session?.status === 'fatal'}
        <h2>Não foi possível entrar</h2>
        <p class="err">{session.statusError}</p>
        <div class="row">
          <button onclick={leave}>Tentar de novo</button>
          <button onclick={() => go('/')}>Início</button>
        </div>
      {:else}
        <h2>Entrar na mesa</h2>
        <p class="muted">Como você quer ser chamado? O mestre e os outros jogadores verão esse nome no seu cursor.</p>
        <label for="pname">Seu nome</label>
        <div class="row">
          <span class="dot big" style:background={colorFor(pid)}></span>
          <input id="pname" bind:value={name} maxlength="32" placeholder="Ex.: Ana" onkeydown={(e) => e.key === 'Enter' && join()} />
        </div>
        <div class="row actions">
          <button class="primary" onclick={join} disabled={!name.trim()}>Entrar</button>
          <button onclick={() => go('/')}>Cancelar</button>
        </div>
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
    color: #ffb4b4;
  }
  .big {
    width: 14px;
    height: 14px;
  }
  .actions {
    margin-top: 16px;
  }
</style>
