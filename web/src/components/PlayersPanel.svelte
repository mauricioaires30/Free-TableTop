<script lang="ts">
  import { colorFor } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';

  let { session, gm = null }: { session: TableSession; gm?: GmSession | null } = $props();

  const players = $derived.by(() => {
    const ids = new Set([...Object.keys(session.roster), ...session.peers.map((p) => p.pid)]);
    return [...ids]
      .map((pid) => ({ pid, r: session.roster[pid], online: session.isOnline(pid), name: session.nameOf(pid) }))
      .filter((p) => !p.r?.banned)
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  });
  const banned = $derived(Object.entries(session.roster).filter(([, r]) => r.banned));

  function kick(pid: string) {
    if (confirm(`Remover ${session.nameOf(pid)} da mesa? Ele será desconectado e não poderá voltar com este navegador.`)) gm?.kick(pid);
  }
</script>

<div class="panel">
  <div class="who">
    <span class="dot" style:background={session.gmOnline ? 'var(--ok)' : 'var(--muted)'}></span>
    <strong style:color="var(--accent-2)">Mestre</strong>
    <span class="muted">{session.gmOnline ? 'online' : 'offline'}</span>
  </div>

  <label class="hidebw" title="Só na sua tela: palavrões aparecem como ****">
    <input type="checkbox" checked={session.hideBadWords} onchange={(e) => session.setHideBadWords(e.currentTarget.checked)} />
    Esconder palavrões (só para você)
  </label>

  <h3>Jogadores</h3>
  {#if players.length === 0}
    <p class="muted">Ninguém entrou ainda.{gm ? ' Mande o link de convite!' : ''}</p>
  {/if}
  <ul>
    {#each players as p (p.pid)}
      <li>
        <span class="dot" style:background={p.online ? colorFor(p.pid) : 'transparent'} style:border="2px solid {colorFor(p.pid)}"></span>
        <span class="name" class:off={!p.online}>
          {p.name}{p.pid === session.myPid ? ' (você)' : ''}
          {#if p.r?.muted}<span class="tag">silenciado</span>{/if}
        </span>
        {#if gm}
          <button class="ghost small" onclick={() => gm.setMuted(p.pid, !p.r?.muted)} title={p.r?.muted ? 'Liberar chat' : 'Silenciar no chat'}>
            {p.r?.muted ? '🔊' : '🔇'}
          </button>
          <button class="ghost small danger" onclick={() => kick(p.pid)} title="Remover da mesa">⨯</button>
        {/if}
      </li>
    {/each}
  </ul>

  {#if gm && banned.length}
    <h3>Removidos</h3>
    <ul>
      {#each banned as [pid, r] (pid)}
        <li>
          <span class="name off">{r.name}</span>
          <button class="ghost small" onclick={() => gm.unban(pid)}>Permitir de volta</button>
          <button class="ghost small" onclick={() => gm.forget(pid)} title="Apagar da lista">✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if gm}
    <p class="muted hint">
      Dica: clique com o botão direito num item do quadro → <em>Permissões</em> para escolher quem vê, move e edita.
    </p>
  {/if}
</div>

<style>
  .hidebw {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin: 10px 0 4px;
    cursor: pointer;
  }
  .panel {
    padding: 12px;
    overflow-y: auto;
    height: 100%;
  }
  h3 {
    font-size: 15px;
    margin-top: 16px;
    color: var(--muted);
  }
  .who {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  li .dot {
    width: 10px;
    height: 10px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name.off {
    color: var(--muted);
  }
  .tag {
    font-size: 11px;
    color: var(--warn);
    margin-left: 4px;
  }
  .small {
    padding: 2px 7px;
  }
  .hint {
    font-size: 12px;
    margin-top: 20px;
  }
</style>
