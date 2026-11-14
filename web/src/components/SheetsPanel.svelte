<script lang="ts">
  import { colorFor, hpOf, type Sheet } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    session,
    gm = null,
    onTemplates,
    onPerm,
    onPlace,
  }: {
    session: TableSession;
    gm?: GmSession | null;
    onTemplates: () => void;
    onPerm: (id: string) => void;
    onPlace: (id: string) => void;
  } = $props();

  const templates = $derived(Object.values(session.docs.templates).sort((a, b) => a.name.localeCompare(b.name)));
  const sheets = $derived(Object.values(session.docs.sheets).sort((a, b) => a.name.localeCompare(b.name)));
  const pcs = $derived(sheets.filter((s) => s.kind === 'pc'));
  const npcs = $derived(sheets.filter((s) => s.kind === 'npc'));
  const monsters = $derived(sheets.filter((s) => s.kind === 'monster'));
  // O jogador não escolhe modelo: a ficha dele segue o que o mestre definiu.
  const playerTemplate = $derived(session.docs.templates[session.settings.playerTemplateId ?? '']);
  const canCreate = $derived(!!gm || (session.settings.allowPlayerSheets && !!playerTemplate));

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
    templateId = gm
      ? templateId && session.docs.templates[templateId]
        ? templateId
        : (session.settings.playerTemplateId && session.docs.templates[session.settings.playerTemplateId] ? session.settings.playerTemplateId : (templates[0]?.id ?? ''))
      : (playerTemplate?.id ?? '');
    kind = 'pc';
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

  /** Ao trocar o tipo, sugere o modelo de criatura para NPC/inimigo e o dos jogadores para PJ. */
  function pickKind(k: Sheet['kind']) {
    kind = k;
    const creature = templates.find((t) => /criatura/i.test(t.name));
    if (k !== 'pc' && creature) templateId = creature.id;
    else if (k === 'pc' && session.settings.playerTemplateId && session.docs.templates[session.settings.playerTemplateId]) templateId = session.settings.playerTemplateId;
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
      <Avatar {session} hash={s.avatar} name={s.name} size={30} color={s.perm.owner ? colorFor(s.perm.owner) : 'var(--muted)'} />
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
      <button class="ghost small" title={s.kind === 'monster' ? 'Pôr mais um token no mapa' : 'Pôr o token no mapa'} aria-label="Pôr no mapa" onclick={() => onPlace(s.id)}><Icon name="coin" size={17} /></button>
      <button class="ghost small" title="Quem vê e edita" aria-label="Permissões" onclick={() => onPerm(s.id)}><Icon name="lock" size={17} /></button>
      <button class="ghost small" title="Duplicar" aria-label="Duplicar" onclick={() => gm.duplicateSheet(s.id)}><Icon name="copy" size={17} /></button>
      <button class="ghost small danger" title="Apagar" aria-label="Apagar" onclick={() => remove(s)}><Icon name="trash" size={17} /></button>
    {/if}
  </li>
{/snippet}

<div class="panel">
  <div class="row top">
    {#if canCreate}<button class="primary" onclick={startCreate} disabled={!templates.length}>+ Nova ficha</button>{/if}
    {#if !gm && session.settings.allowPlayerSheets && !playerTemplate}<span class="muted">O mestre ainda não escolheu o modelo das fichas.</span>{/if}
    {#if gm}<button onclick={onTemplates}>Modelos de ficha…</button>{/if}
  </div>

  {#if creating}
    <div class="create card">
      <label for="sn">Nome</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="sn" bind:value={name} maxlength="60" autofocus onkeydown={(e) => e.key === 'Enter' && create()} />
      {#if gm}
        <label for="sk">Tipo</label>
        <select id="sk" value={kind} onchange={(e) => pickKind(e.currentTarget.value as Sheet['kind'])}>
          <option value="pc">Personagem de jogador (um token)</option>
          <option value="npc">NPC (um token, oculto dos jogadores)</option>
          <option value="monster">Inimigo / criatura (vários tokens, cada um com sua vida)</option>
        </select>
        <label for="st">Modelo</label>
        <select id="st" bind:value={templateId}>
          {#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
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
    <h3>NPCs</h3>
    {#if npcs.length === 0}<p class="muted">Crie NPCs com "+ Nova ficha". Ficam ocultos até você liberar.</p>{/if}
    <ul>
      {#each npcs as s (s.id)}{@render row(s)}{/each}
    </ul>
  {/if}

  {#if monsters.length || gm}
    <h3>Inimigos</h3>
    {#if monsters.length === 0}<p class="muted">Uma ficha de inimigo vira quantos tokens você quiser (🪙), cada um com a própria vida.</p>{/if}
    <ul>
      {#each monsters as s (s.id)}{@render row(s)}{/each}
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
