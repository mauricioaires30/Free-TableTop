<script lang="ts">
  import { colorFor, hpOf, type Sheet } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';

  let {
    session,
    gm = null,
    onTemplates,
    onPerm,
  }: {
    session: TableSession;
    gm?: GmSession | null;
    onTemplates: () => void;
    onPerm: (id: string) => void;
  } = $props();

  const templates = $derived(Object.values(session.docs.templates).sort((a, b) => a.name.localeCompare(b.name)));
  const sheets = $derived(Object.values(session.docs.sheets).sort((a, b) => a.name.localeCompare(b.name)));
  const pcs = $derived(sheets.filter((s) => s.kind === 'pc'));
  const npcs = $derived(sheets.filter((s) => s.kind === 'npc'));
  const canCreate = $derived(!!gm || session.settings.allowPlayerSheets);

  let creating = $state(false);
  let name = $state('');
  let templateId = $state('');
  let kind = $state<Sheet['kind']>('pc');
  let owner = $state('');

  const players = $derived(
    Object.entries(session.roster)
      .filter(([, r]) => !r.banned)
      .map(([pid, r]) => ({ pid, name: r.name })),
  );

  function startCreate() {
    creating = true;
    name = '';
    templateId = templateId && session.docs.templates[templateId] ? templateId : (templates[0]?.id ?? '');
    kind = gm ? 'npc' : 'pc';
    owner = '';
  }

  function create() {
    if (!name.trim() || !templateId) return;
    if (gm) {
      const s = gm.createSheet({ templateId, name, kind, owner: kind === 'pc' ? owner || undefined : undefined });
      if (s) session.openSheet(s.id);
    } else {
      session.newSheet(templateId, name);
    }
    creating = false;
  }

  function ownerName(s: Sheet) {
    return s.perm.owner ? session.nameOf(s.perm.owner) : s.kind === 'pc' ? 'sem dono' : '';
  }

  function remove(s: Sheet) {
    if (confirm(`Apagar a ficha "${s.name}"? Isso não pode ser desfeito.`)) gm?.deleteSheet(s.id);
  }
</script>

{#snippet row(s: Sheet)}
  {@const hp = hpOf(s, session.templateOf(s))}
  <li>
    <button class="ghost open" onclick={() => session.openSheet(s.id)}>
      <span class="dot" style:background={s.perm.owner ? colorFor(s.perm.owner) : 'var(--muted)'}></span>
      <span class="nm">
        <strong>{s.name}</strong>
        <span class="muted">{session.templateOf(s)?.name ?? '?'}{ownerName(s) ? ` · ${ownerName(s)}` : ''}</span>
      </span>
      {#if hp}
        <span class="hp" title="{hp.cur}/{hp.max}">
          <span style:width="{hp.max > 0 ? Math.max(0, Math.min(100, (hp.cur / hp.max) * 100)) : 0}%"></span>
        </span>
      {/if}
    </button>
    {#if gm}
      <button class="ghost small" title="Permissões" onclick={() => onPerm(s.id)}>🔐</button>
      <button class="ghost small" title="Duplicar" onclick={() => gm.duplicateSheet(s.id)}>📄</button>
      <button class="ghost small danger" title="Apagar" onclick={() => remove(s)}>🗑</button>
    {/if}
  </li>
{/snippet}

<div class="panel">
  <div class="row top">
    {#if canCreate}<button class="primary" onclick={startCreate} disabled={!templates.length}>+ Nova ficha</button>{/if}
    {#if gm}<button onclick={onTemplates}>Modelos de ficha…</button>{/if}
  </div>

  {#if creating}
    <div class="create card">
      <label for="sn">Nome</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="sn" bind:value={name} maxlength="60" autofocus onkeydown={(e) => e.key === 'Enter' && create()} />
      <label for="st">Modelo</label>
      <select id="st" bind:value={templateId}>
        {#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </select>
      {#if gm}
        <label for="sk">Tipo</label>
        <select id="sk" bind:value={kind}>
          <option value="pc">Personagem de jogador</option>
          <option value="npc">NPC / criatura (oculto dos jogadores)</option>
        </select>
        {#if kind === 'pc'}
          <label for="so">Dono (vê e edita a ficha)</label>
          <select id="so" bind:value={owner}>
            <option value="">Ninguém por enquanto</option>
            {#each players as p (p.pid)}<option value={p.pid}>{p.name}</option>{/each}
          </select>
        {/if}
      {/if}
      <div class="row end">
        <button class="ghost" onclick={() => (creating = false)}>Cancelar</button>
        <button class="primary" onclick={create} disabled={!name.trim() || !templateId}>Criar</button>
      </div>
    </div>
  {/if}

  <h3>{gm ? 'Personagens' : 'Fichas'}</h3>
  {#if pcs.length === 0}
    <p class="muted">
      {gm ? 'Nenhum personagem ainda.' : session.settings.allowPlayerSheets ? 'Crie sua ficha em "+ Nova ficha".' : 'O mestre ainda não te deu uma ficha.'}
    </p>
  {/if}
  <ul>
    {#each pcs as s (s.id)}{@render row(s)}{/each}
  </ul>

  {#if npcs.length || gm}
    <h3>NPCs e criaturas</h3>
    {#if npcs.length === 0}<p class="muted">Crie NPCs com "+ Nova ficha". Ficam ocultos até você liberar.</p>{/if}
    <ul>
      {#each npcs as s (s.id)}{@render row(s)}{/each}
    </ul>
  {/if}
</div>

<style>
  .panel {
    padding: 12px;
    overflow-y: auto;
    height: 100%;
  }
  .top {
    flex-wrap: wrap;
  }
  .create {
    margin-top: 10px;
    padding: 12px;
  }
  .end {
    justify-content: flex-end;
    margin-top: 12px;
  }
  h3 {
    font-size: 15px;
    margin-top: 18px;
    color: var(--muted);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
    min-width: 0;
    padding: 6px 8px;
  }
  .nm {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .nm strong,
  .nm span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nm span {
    font-size: 12px;
  }
  .hp {
    width: 44px;
    height: 6px;
    background: var(--bg);
    border-radius: 99px;
    overflow: hidden;
    flex: none;
  }
  .hp span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .small {
    padding: 3px 6px;
  }
</style>
