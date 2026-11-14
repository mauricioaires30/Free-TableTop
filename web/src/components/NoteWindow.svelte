<script lang="ts">
  import { can, renderNote } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';
  import LiveInput from './LiveInput.svelte';

  let {
    session,
    gm = null,
    col,
    id,
    index,
    z,
    onFocus,
    onPerm,
  }: {
    session: TableSession;
    gm?: GmSession | null;
    col: 'journal' | 'wiki';
    id: string;
    index: number;
    z: number;
    onFocus: () => void;
    onPerm?: () => void;
  } = $props();

  const doc = $derived(col === 'journal' ? session.docs.journal[id] : session.docs.wiki[id]);
  const editable = $derived(!!doc && can(session.actor, 'edit', doc));
  let editing = $state(false);
  let tags = $state('');

  $effect(() => {
    if (doc && col === 'wiki' && 'tags' in doc) tags = doc.tags.join(', ');
  });

  // Página nova e vazia já abre em edição.
  $effect(() => {
    if (doc && editable && !doc.text) editing = true;
  });

  const html = $derived(doc ? renderNote(session.clean(doc.text), (t) => !!session.wikiByTitle(t)) : '');

  const start = Math.min(index, 6);
  let pos = $state({ x: 120 + start * 32, y: 80 + start * 28 });
  let drag: { dx: number; dy: number } | null = null;

  function down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button, input')) return;
    drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onFocus();
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    pos = {
      x: Math.max(-300, Math.min(window.innerWidth - 80, e.clientX - drag.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 50, e.clientY - drag.dy)),
    };
  }

  /** Clique num [[link]]: abre a página; se não existe, o mestre pode criá-la. */
  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a.wl') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const title = a.dataset.page ?? '';
    const page = session.wikiByTitle(title);
    if (page) session.openNote('wiki', page.id);
    else if (gm && confirm(`A página "${title}" não existe. Criar agora?`)) session.openNote('wiki', gm.createWiki(title).id);
    else if (!gm) session.toast('Essa página não existe ou não foi compartilhada com você.');
  }

  function draft() {
    if (!gm || !doc || col !== 'journal' || !('date' in doc)) return;
    const txt = gm.journalDraft(doc.date);
    if (!txt) return gm.toast('Não há mensagens públicas no chat nesse dia.');
    gm.editNote('journal', id, { text: (doc.text ? doc.text + '\n\n' : '') + '# Do chat\n' + txt });
    editing = true;
  }

  function remove() {
    if (!gm || !doc) return;
    if (!confirm(`Apagar "${doc.title}"? Isso não pode ser desfeito.`)) return;
    gm.removeDoc(col, id);
    session.closeNote(id);
  }
</script>

{#if doc}
  <section class="win parchment" style:left="{pos.x}px" style:top="{pos.y}px" style:z-index={z} onpointerdown={onFocus} aria-label={doc.title}>
    <header onpointerdown={down} onpointermove={move} onpointerup={() => (drag = null)}>
      <span class="kind">{col === 'journal' ? '📓' : '📖'}</span>
      {#if editable}
        <LiveInput class="title" value={doc.title} maxlength={120} label="Título" onCommit={(v) => session.editNote(col, id, { title: String(v) })} />
      {:else}
        <strong class="title">{session.clean(doc.title)}</strong>
      {/if}
      {#if editable}
        <button class="ghost icon" title={editing ? 'Ver' : 'Editar'} onclick={() => (editing = !editing)}>{editing ? '👁' : '✏️'}</button>
      {/if}
      {#if onPerm}<button class="ghost icon" title="Quem vê e edita" onclick={onPerm}>🔐</button>{/if}
      <button class="ghost icon" title="Fechar" aria-label="Fechar" onclick={() => session.closeNote(id)}>✕</button>
    </header>

    {#if gm && (col === 'journal' || editing)}
      <div class="meta">
        {#if col === 'journal' && 'date' in doc}
          <input type="date" value={doc.date} onchange={(e) => gm.setNoteDate(id, e.currentTarget.value)} aria-label="Data da sessão" />
          <button class="small" onclick={draft} title="Traz as falas e rolagens públicas do chat desse dia">Rascunho do chat</button>
        {/if}
        {#if col === 'wiki'}
          <input
            class="tags"
            bind:value={tags}
            placeholder="etiquetas: npc, cidade…"
            aria-label="Etiquetas"
            onchange={() => gm.setWikiTags(id, tags.split(','))}
          />
        {/if}
        <span class="spacer"></span>
        <button class="ghost small danger" onclick={remove}>Apagar</button>
      </div>
    {/if}

    <div class="body">
      {#if editing && editable}
        <LiveInput type="textarea" rows={16} value={doc.text} maxlength={50000} label="Texto" placeholder="Escreva aqui. # título, **negrito**, *itálico*, - lista, [[Outra página]]" onCommit={(v) => session.editNote(col, id, { text: String(v) })} />
        <p class="muted hint"># título · **negrito** · *itálico* · - lista · [[Nome de página]] vira link para a wiki</p>
      {:else if doc.text}
        <!-- O texto é escapado antes de formatar (renderNote). -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="prose" onclick={onClick}>{@html html}</div>
      {:else}
        <p class="muted">Página em branco.</p>
      {/if}
    </div>
  </section>
{/if}

<style>
  .win {
    position: fixed;
    width: min(520px, calc(100vw - 24px));
    max-height: calc(100vh - 90px);
    display: flex;
    flex-direction: column;
    border-radius: 4px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--border);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  header :global(.title) {
    flex: 1;
    min-width: 0;
    font-family: var(--font-title);
    font-size: 17px;
    font-weight: 400;
    background: transparent;
    border-color: transparent;
    padding: 4px 6px;
  }
  .icon {
    padding: 3px 7px;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
  }
  .meta input[type='date'] {
    width: auto;
    padding: 4px 8px;
  }
  .tags {
    padding: 4px 8px;
  }
  .small {
    font-size: 12px;
    padding: 4px 8px;
  }
  .spacer {
    flex: 1;
  }
  .body {
    overflow-y: auto;
    padding: 12px 14px;
  }
  .hint {
    font-size: 11px;
    margin: 6px 0 0;
  }
  .prose {
    font-size: 14px;
    line-height: 1.55;
  }
  .prose :global(p) {
    margin: 0 0 8px;
  }
  .prose :global(h3),
  .prose :global(h4),
  .prose :global(h5) {
    font-family: var(--font-title);
    font-weight: 400;
    color: var(--accent-2);
    margin: 14px 0 6px;
  }
  .prose :global(li) {
    margin: 0 0 4px 18px;
  }
  .prose :global(a.wl) {
    color: var(--accent-2);
    text-decoration: underline dotted;
  }
  .prose :global(a.wl.missing) {
    color: var(--muted);
  }
</style>
