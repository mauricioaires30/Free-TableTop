<script lang="ts">
  import { parseRows, rowsToText, type RandomTable } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';

  let {
    session,
    gm = null,
    onPerm,
  }: {
    session: TableSession;
    gm?: GmSession | null;
    onPerm: (col: 'journal' | 'wiki' | 'tables', id: string) => void;
  } = $props();

  let sub = $state<'journal' | 'wiki' | 'tables'>('journal');
  let search = $state('');
  let priv = $state(false);
  let editingTable = $state<{ id: string; name: string; category: string; rows: string } | null>(null);

  const journal = $derived(Object.values(session.docs.journal).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt));
  const wiki = $derived(
    Object.values(session.docs.wiki)
      .filter((p) => {
        const q = search.trim().toLowerCase();
        return !q || p.title.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)) || p.text.toLowerCase().includes(q);
      })
      .sort((a, b) => a.title.localeCompare(b.title)),
  );
  const tableGroups = $derived.by(() => {
    const groups = new Map<string, RandomTable[]>();
    for (const t of Object.values(session.docs.tables).sort((a, b) => a.name.localeCompare(b.name))) {
      const c = t.category?.trim() || 'Outras';
      groups.set(c, [...(groups.get(c) ?? []), t]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  const fmtDate = (d: string) => {
    const [y, m, day] = d.split('-');
    return day && m && y ? `${day}/${m}/${y}` : d;
  };

  function newWiki() {
    const title = search.trim() || 'Nova página';
    const p = gm?.createWiki(title);
    if (p) session.openNote('wiki', p.id);
    search = '';
  }

  function editTable(t: RandomTable) {
    editingTable = { id: t.id, name: t.name, category: t.category ?? '', rows: rowsToText(t.rows) };
  }

  function newTable() {
    const t = gm?.createTable();
    if (t) editTable(t);
  }

  function saveTable() {
    if (!gm || !editingTable) return;
    const t = gm.docs.tables[editingTable.id];
    if (!t) return;
    gm.saveTable({
      ...t,
      name: editingTable.name.trim().slice(0, 60) || 'Tabela',
      category: editingTable.category.trim().slice(0, 30) || undefined,
      rows: parseRows(editingTable.rows),
    });
    editingTable = null;
  }

  function shareTable(t: RandomTable) {
    const shared = t.perm.view === 'all';
    gm?.setDocPerm('tables', t.id, { ...t.perm, view: shared ? 'gm' : 'all' });
  }

  function removeTable(t: RandomTable) {
    if (confirm(`Apagar a tabela "${t.name}"?`)) gm?.removeDoc('tables', t.id);
  }
</script>

<div class="panel">
  <nav class="sub">
    <button class:on={sub === 'journal'} onclick={() => (sub = 'journal')}>📓 Diário</button>
    <button class:on={sub === 'wiki'} onclick={() => (sub = 'wiki')}>📖 Wiki</button>
    <button class:on={sub === 'tables'} onclick={() => (sub = 'tables')}>🎲 Tabelas</button>
  </nav>

  {#if sub === 'journal'}
    {#if gm}<button class="primary" onclick={() => session.openNote('journal', gm.createJournal().id)}>+ Nova sessão</button>{/if}
    {#if !journal.length}
      <p class="muted">{gm ? 'Anote o que aconteceu em cada sessão. Dá para puxar um rascunho do chat.' : 'O mestre ainda não compartilhou o diário.'}</p>
    {/if}
    <ul>
      {#each journal as e (e.id)}
        <li>
          <button class="ghost open" onclick={() => session.openNote('journal', e.id)}>
            <strong>{e.title}</strong>
            <span class="muted">{fmtDate(e.date)}{gm && e.perm.view === 'gm' ? ' · só você' : ''}</span>
          </button>
          {#if gm}<button class="ghost small" title="Quem vê" onclick={() => onPerm('journal', e.id)}>🔐</button>{/if}
        </li>
      {/each}
    </ul>
  {:else if sub === 'wiki'}
    <div class="row">
      <input bind:value={search} placeholder="Buscar ou nome da nova página" aria-label="Buscar na wiki" />
      {#if gm}<button class="primary" onclick={newWiki}>+ Página</button>{/if}
    </div>
    {#if !wiki.length}
      <p class="muted">{search ? 'Nada encontrado.' : gm ? 'Crie páginas para NPCs, lugares, itens… e ligue umas às outras com [[Nome]].' : 'Nenhuma página compartilhada ainda.'}</p>
    {/if}
    <ul>
      {#each wiki as p (p.id)}
        <li>
          <button class="ghost open" onclick={() => session.openNote('wiki', p.id)}>
            <strong>{p.title}</strong>
            <span class="muted">{p.tags.join(', ')}{gm && p.perm.view === 'gm' ? (p.tags.length ? ' · ' : '') + 'só você' : ''}</span>
          </button>
          {#if gm}<button class="ghost small" title="Quem vê e edita" onclick={() => onPerm('wiki', p.id)}>🔐</button>{/if}
        </li>
      {/each}
    </ul>
  {:else}
    <div class="row between">
      <label class="check"><input type="checkbox" bind:checked={priv} /> {gm ? 'Resultado oculto' : 'Só para o mestre'}</label>
      {#if gm}<button class="primary" onclick={newTable}>+ Tabela</button>{/if}
    </div>

    {#if editingTable}
      <div class="card edit">
        <label for="tbn">Nome</label>
        <input id="tbn" bind:value={editingTable.name} maxlength="60" />
        <label for="tbc">Grupo</label>
        <input id="tbc" bind:value={editingTable.category} maxlength="30" placeholder="Ex.: Nomes, Tesouros" />
        <label for="tbr">Resultados (um por linha)</label>
        <textarea id="tbr" rows="8" bind:value={editingTable.rows}></textarea>
        <p class="muted hint"><code>3: texto</code> sai 3× mais · <code>[Outra tabela]</code> rola outra · <code>&#123;2d6&#125;</code> rola dados</p>
        <div class="row end">
          <button class="ghost" onclick={() => (editingTable = null)}>Cancelar</button>
          <button class="primary" onclick={saveTable}>Salvar</button>
        </div>
      </div>
    {/if}

    {#if !tableGroups.length}
      <p class="muted">{gm ? 'Crie tabelas para rolar nomes, tesouros, encontros…' : 'O mestre não compartilhou tabelas.'}</p>
    {/if}
    {#each tableGroups as [cat, list] (cat)}
      <h4>{cat}</h4>
      <ul>
        {#each list as t (t.id)}
          <li>
            <button class="ghost open roll" onclick={() => session.rollTable(t.id, priv)} title="Rolar">
              <span>🎲 {t.name}</span>
              <span class="muted">{t.rows.length} resultados{gm && t.perm.view === 'all' ? ' · jogadores rolam' : ''}</span>
            </button>
            {#if gm}
              <button class="ghost small" title={t.perm.view === 'all' ? 'Parar de compartilhar' : 'Deixar os jogadores rolarem'} onclick={() => shareTable(t)}>{t.perm.view === 'all' ? '👥' : '🔒'}</button>
              <button class="ghost small" title="Editar" onclick={() => editTable(t)}>✏️</button>
              <button class="ghost small danger" title="Apagar" onclick={() => removeTable(t)}>🗑</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</div>

<style>
  .panel {
    padding: 12px;
    overflow-y: auto;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sub {
    display: flex;
    gap: 4px;
  }
  .sub button {
    flex: 1;
    font-size: 12px;
    padding: 6px 4px;
  }
  .sub button.on {
    border-color: var(--accent-2);
    color: var(--accent-2);
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
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    padding: 6px 8px;
  }
  .open span,
  .open strong {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open .muted {
    font-size: 12px;
  }
  .small {
    padding: 3px 6px;
  }
  h4 {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--muted);
    font-weight: 600;
  }
  .between {
    justify-content: space-between;
  }
  .end {
    justify-content: flex-end;
    margin-top: 8px;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    color: var(--text);
    font-size: 12px;
  }
  .edit {
    padding: 12px;
  }
  .hint {
    font-size: 11px;
    margin: 6px 0 0;
  }
  code {
    color: var(--accent-2);
  }
</style>
