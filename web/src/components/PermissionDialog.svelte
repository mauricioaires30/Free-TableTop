<script lang="ts">
  import { colorFor, type Perm, type Who } from '@ftt/shared';
  import type { GmSession } from '../lib/session/gm.svelte';

  type Key = 'view' | 'move' | 'edit';

  let {
    gm,
    perm: initial,
    title = 'Permissões',
    keys = ['view', 'move', 'edit'],
    hints = {},
    onSave,
    onClose,
  }: {
    gm: GmSession;
    perm: Perm;
    title?: string;
    /** Quais linhas mostrar (fichas não têm "mover"). */
    keys?: Key[];
    hints?: Partial<Record<Key, string>>;
    onSave: (perm: Perm) => void;
    onClose: () => void;
  } = $props();

  type Mode = 'all' | 'gm' | 'owner' | 'list';
  type Row = { mode: Mode; list: string[] };

  const toRow = (w: Who): Row =>
    Array.isArray(w) ? (w.length ? { mode: 'list', list: [...w] } : { mode: 'gm', list: [] }) : { mode: w, list: [] };
  const fromRow = (r: Row): Who => (r.mode === 'list' ? (r.list.length ? [...r.list] : 'gm') : r.mode);

  let rows = $state<Record<'view' | 'move' | 'edit', Row>>({
    view: toRow(initial.view),
    move: toRow(initial.move),
    edit: toRow(initial.edit),
  });
  let owner = $state(initial.owner ?? '');

  const players = $derived(
    Object.entries(gm.roster)
      .filter(([, r]) => !r.banned)
      .map(([pid, r]) => ({ pid, name: r.name })),
  );

  const LABELS = {
    view: { title: 'Quem pode ver', hint: 'Quem não pode ver não recebe nada deste item.' },
    move: { title: 'Quem pode mover', hint: 'Arrastar, redimensionar, girar e mudar a camada.' },
    edit: { title: 'Quem pode editar', hint: 'Mudar texto e cor (o verso de cartas é só seu).' },
  } as const;

  function preset(p: 'public' | 'hidden' | 'free' | 'owner') {
    if (p === 'public') rows = { view: { mode: 'all', list: [] }, move: { mode: 'gm', list: [] }, edit: { mode: 'gm', list: [] } };
    if (p === 'hidden') rows = { view: { mode: 'gm', list: [] }, move: { mode: 'gm', list: [] }, edit: { mode: 'gm', list: [] } };
    if (p === 'free') rows = { view: { mode: 'all', list: [] }, move: { mode: 'all', list: [] }, edit: { mode: 'all', list: [] } };
    if (p === 'owner') rows = { view: { mode: 'all', list: [] }, move: { mode: 'owner', list: [] }, edit: { mode: 'owner', list: [] } };
  }

  function toggle(row: Row, pid: string) {
    row.list = row.list.includes(pid) ? row.list.filter((p) => p !== pid) : [...row.list, pid];
  }

  const needsOwner = $derived(keys.some((k) => rows[k].mode === 'owner'));

  function save() {
    const perm: Perm = { view: fromRow(rows.view), move: fromRow(rows.move), edit: fromRow(rows.edit) };
    if (owner) perm.owner = owner;
    onSave(perm);
    onClose();
  }
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="perm-title">
    <h2 id="perm-title">{title}</h2>
    <p class="muted">Você (mestre) sempre pode tudo. Isto vale para os jogadores.</p>

    <div class="presets">
      <button onclick={() => preset('public')}>Todos veem, só eu mexo</button>
      <button onclick={() => preset('hidden')}>Oculto</button>
      <button onclick={() => preset('owner')}>Do dono</button>
      <button onclick={() => preset('free')}>Livre para todos</button>
    </div>

    {#each keys as key (key)}
      {@const row = rows[key]}
      <fieldset>
        <legend>{LABELS[key].title}</legend>
        <div class="modes">
          {#each [['all', 'Todos'], ['gm', 'Só o mestre'], ['owner', 'Dono'], ['list', 'Escolher…']] as [m, label] (m)}
            <label class="pill" class:on={row.mode === m}>
              <input type="radio" name={key} value={m} bind:group={row.mode} />{label}
            </label>
          {/each}
        </div>
        {#if row.mode === 'list'}
          {#if players.length === 0}
            <p class="muted small">Nenhum jogador entrou ainda.</p>
          {/if}
          <div class="players">
            {#each players as p (p.pid)}
              <label class="pl">
                <input type="checkbox" checked={row.list.includes(p.pid)} onchange={() => toggle(row, p.pid)} />
                <span class="dot" style:background={colorFor(p.pid)}></span>{p.name}
              </label>
            {/each}
          </div>
        {/if}
        <p class="muted small">{hints[key] ?? LABELS[key].hint}</p>
      </fieldset>
    {/each}

    <label for="owner">Dono do item {needsOwner ? '' : '(opcional)'}</label>
    <select id="owner" bind:value={owner}>
      <option value="">Ninguém</option>
      {#each players as p (p.pid)}
        <option value={p.pid}>{p.name}</option>
      {/each}
    </select>
    {#if needsOwner && !owner}
      <p class="warn small">Escolha um dono, senão "Dono" vale como "Só o mestre".</p>
    {/if}

    <div class="actions">
      <button class="ghost" onclick={onClose}>Cancelar</button>
      <button class="primary" onclick={save}>Salvar</button>
    </div>
  </div>
</div>

<style>
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .presets button {
    font-size: 12px;
    padding: 5px 9px;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 10px 0 0;
    padding: 8px 12px 4px;
  }
  legend {
    font-weight: 600;
    padding: 0 4px;
  }
  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    margin: 0;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
  }
  .pill.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .pill input {
    display: none;
  }
  .players {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin-top: 8px;
  }
  .pl {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .small {
    font-size: 12px;
    margin: 6px 0;
  }
  .warn {
    color: var(--warn);
  }
</style>
