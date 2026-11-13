<script lang="ts">
  import type { BoardItem } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmPatch } from '../lib/session/gm.svelte';

  let { session, item, onClose }: { session: TableSession; item: BoardItem; onClose: () => void } = $props();

  const gm = session.role === 'gm';
  let text = $state(item.text ?? '');
  let title = $state(item.title ?? '');
  let front = $state(item.front ?? '');
  let back = $state(item.back ?? '');
  let revealed = $state(!!item.revealed);
  let color = $state(item.color ?? (item.type === 'card' ? '#efe4cc' : item.type === 'clock' ? '#c0392b' : '#f5e6a8'));
  let segments = $state(item.segments ?? 6);

  const COLORS = item.type === 'card'
    ? ['#efe4cc', '#e6d3b3', '#d9e2ec', '#e8d5d5', '#dfe8d5']
    : item.type === 'clock'
      ? ['#c0392b', '#d9a75b', '#4caf7a', '#2e86de', '#8e44ad']
      : ['#f5e6a8', '#f7c6c7', '#c9e4c5', '#c6dbf0', '#e2d1f0', '#ffffff'];

  function save() {
    if (item.type === 'clock') {
      const n = Math.max(2, Math.min(24, segments));
      const patch: GmPatch = { title, color, segments: n, filled: Math.min(n, item.filled ?? 0) };
      session.edit(item.id, patch);
    } else if (item.type === 'note') session.edit(item.id, { text, color });
    else if (item.type === 'card') {
      // O verso e "revelado" só são aceitos quando quem edita é o mestre.
      const patch: GmPatch = gm ? { title, front, color, back, revealed } : { title, front, color };
      session.edit(item.id, patch);
    }
    onClose();
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title">
    <h2 id="edit-title">{item.type === 'note' ? 'Editar nota' : item.type === 'clock' ? 'Relógio de progresso' : 'Editar carta'}</h2>

    {#if item.type === 'clock'}
      <label for="ct">Nome</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="ct" bind:value={title} maxlength="60" autofocus placeholder="Ex.: A guarda chega" />
      <label for="cs">Fatias</label>
      <select id="cs" bind:value={segments}>
        {#each [2, 3, 4, 6, 8, 10, 12] as n (n)}<option value={n}>{n}</option>{/each}
      </select>
      <p class="muted small">Duplo clique no relógio avança uma fatia. Botão direito para voltar.</p>
    {:else if item.type === 'note'}
      <label for="t">Texto</label>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea id="t" rows="7" bind:value={text} maxlength="4000" autofocus></textarea>
    {:else}
      <label for="ti">Título</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="ti" bind:value={title} maxlength="80" autofocus />
      <label for="fr">Frente (o que todos veem)</label>
      <textarea id="fr" rows="4" bind:value={front} maxlength="4000"></textarea>
      {#if gm}
        <label for="bk">Verso (segredo até você revelar)</label>
        <textarea id="bk" rows="4" bind:value={back} maxlength="4000"></textarea>
        <label class="check"><input type="checkbox" bind:checked={revealed} /> Verso revelado para quem pode ver a carta</label>
      {/if}
    {/if}

    <label for="c0">Cor</label>
    <div class="swatches">
      {#each COLORS as c, i (c)}
        <button id={i === 0 ? 'c0' : undefined} class="sw" class:on={color === c} style:background={c} aria-label="Cor {c}" onclick={() => (color = c)}></button>
      {/each}
    </div>

    <div class="actions">
      <button class="ghost" onclick={onClose}>Cancelar</button>
      <button class="primary" onclick={save}>Salvar</button>
    </div>
  </div>
</div>

<style>
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--text);
    cursor: pointer;
  }
  .swatches {
    display: flex;
    gap: 6px;
  }
  .sw {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    padding: 0;
    border: 2px solid transparent;
  }
  .sw.on {
    border-color: var(--accent-2);
    box-shadow: 0 0 0 2px var(--panel);
  }
</style>
