<script lang="ts">
  import { colorFor, isHiddenFromPlayers, LAYER_LABELS, LAYERS, layerOf, type BoardItem } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';
  import type { BoardRenderer, FogBrush, Tool } from '../lib/board/renderer';
  import { go } from '../lib/router.svelte';
  import Board from '../components/Board.svelte';
  import ChatPanel from '../components/ChatPanel.svelte';
  import PlayersPanel from '../components/PlayersPanel.svelte';
  import SettingsPanel from '../components/SettingsPanel.svelte';
  import ContextMenu, { type MenuItem } from '../components/ContextMenu.svelte';
  import EditDialog from '../components/EditDialog.svelte';
  import PermissionDialog from '../components/PermissionDialog.svelte';
  import InviteBox from '../components/InviteBox.svelte';
  import SheetsPanel from '../components/SheetsPanel.svelte';
  import SheetWindow from '../components/SheetWindow.svelte';
  import TemplateEditor from '../components/TemplateEditor.svelte';
  import CombatPanel from '../components/CombatPanel.svelte';
  import ToolPalette from '../components/ToolPalette.svelte';
  import TokenDialog from '../components/TokenDialog.svelte';
  import NotesPanel from '../components/NotesPanel.svelte';
  import NoteWindow from '../components/NoteWindow.svelte';
  import DiceTray from '../components/DiceTray.svelte';

  let { session, gm = null, onLeave }: { session: TableSession; gm?: GmSession | null; onLeave?: () => void } = $props();

  // Só em desenvolvimento: facilita inspecionar a mesa pelo console.
  if (import.meta.env.DEV) (window as unknown as { __ftt: unknown }).__ftt = session;

  let renderer = $state<BoardRenderer | null>(null);
  let tool = $state<Tool>('select');
  let fogBrush = $state<FogBrush>({ op: 'reveal', shape: 'rect', r: 60 });
  let tokenEditing = $state<BoardItem | null>(null);
  /** O seletor de arquivo serve para imagens novas ou para a imagem de um token. */
  let tokenImageFor: string | null = null;
  type Tab = 'chat' | 'sheets' | 'combat' | 'notes' | 'players' | 'settings';
  let permNote = $state<{ col: 'journal' | 'wiki' | 'tables'; id: string } | null>(null);
  let tab = $state<Tab>('chat');
  let showTemplates = $state(false);
  let permSheet = $state<string | null>(null);
  /** Ordem de empilhamento das janelas de ficha (a última fica na frente). */
  let sheetOrder = $state<string[]>([]);
  const windowZ = (id: string) => 20 + Math.max(0, sheetOrder.indexOf(id));
  function focusSheet(id: string) {
    sheetOrder = [...sheetOrder.filter((x) => x !== id), id];
  }
  let sidebarOpen = $state(typeof window === 'undefined' || window.innerWidth > 760);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let editing = $state<BoardItem | null>(null);
  let permItem = $state<BoardItem | null>(null);
  let showInvite = $state(false);
  let fileInput: HTMLInputElement;
  let pendingImagePos: { x: number; y: number } | null = null;

  const statusLabel = $derived.by(() => {
    if (session.status === 'online') return gm ? 'Mesa aberta' : session.gmOnline ? 'Conectado' : 'Mestre offline';
    if (session.status === 'connecting') return 'Conectando…';
    if (session.status === 'offline') return 'Reconectando…';
    return 'Desconectado';
  });
  const statusColor = $derived(
    session.status === 'online' ? (gm || session.gmOnline ? 'var(--ok)' : 'var(--warn)') : session.status === 'fatal' ? 'var(--danger)' : 'var(--warn)',
  );
  const onlineCount = $derived(session.peers.length);

  function center() {
    return renderer?.viewCenter() ?? { x: 0, y: 0, scale: 1 };
  }

  function pickImage(pos?: { x: number; y: number }) {
    pendingImagePos = pos ?? null;
    tokenImageFor = null;
    fileInput.multiple = true;
    fileInput.click();
  }

  function pickTokenImage(id: string) {
    tokenImageFor = id;
    fileInput.multiple = false;
    fileInput.click();
  }

  function placeSheet(sheetId: string) {
    const c = center();
    gm?.addToken(c.x, c.y, { sheetId });
  }

  async function onFile() {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (tokenImageFor) {
      if (files[0]) await gm?.setTokenImage(tokenImageFor, files[0]);
      tokenImageFor = null;
      return;
    }
    let p = pendingImagePos ?? center();
    for (const f of files) {
      await gm?.addImage(f, p.x, p.y);
      p = { x: p.x + 40, y: p.y + 40 };
    }
  }

  function openEdit(id: string) {
    const item = session.items.get(id);
    if (!item || item.type === 'image' || !session.can('edit', item)) return;
    if (item.type === 'clock') {
      // Duplo clique avança o relógio (volta ao zero depois de cheio).
      const n = item.segments ?? 6;
      const f = item.filled ?? 0;
      session.edit(id, { filled: f >= n ? 0 : f + 1 });
      return;
    }
    if (item.type === 'token') tokenEditing = $state.snapshot(item) as BoardItem;
    else editing = { ...item };
  }

  function onContext(id: string | null, cx: number, cy: number) {
    const items: MenuItem[] = [];
    const item = id ? session.items.get(id) : null;
    if (!item) {
      const p = renderer?.clientToBoard(cx, cy) ?? center();
      if (gm) {
        items.push(
          { label: '📝 Nova nota aqui', action: () => gm.addNote(p.x, p.y) },
          { label: '🃏 Nova carta aqui', action: () => gm.addCard(p.x, p.y) },
          { label: '🖼️ Imagem aqui…', action: () => pickImage(p) },
          { label: '🪙 Token aqui', action: () => gm.addToken(p.x, p.y) },
          { label: '⏱️ Relógio aqui', action: () => gm.addClock(p.x, p.y) },
        );
      }
      items.push({ label: '🔍 Ver tudo', action: () => renderer?.fitAll(), divider: !!gm });
    } else {
      if (item.type === 'clock' && session.can('edit', item)) {
        items.push(
          { label: '➕ Avançar relógio', action: () => session.edit(item.id, { filled: Math.min(item.segments ?? 6, (item.filled ?? 0) + 1) }) },
          { label: '➖ Voltar relógio', action: () => session.edit(item.id, { filled: Math.max(0, (item.filled ?? 0) - 1) }) },
        );
        if (gm) items.push({ label: '✏️ Editar relógio', action: () => (editing = { ...item }) });
      } else if (item.type !== 'image' && session.can('edit', item)) {
        items.push({ label: item.type === 'token' ? '✏️ Nome e condições' : '✏️ Editar', action: () => openEdit(item.id) });
      }
      if (item.type === 'token' && item.sheetId && session.docs.sheets[item.sheetId]) {
        items.push({ label: '📜 Abrir ficha', action: () => session.openSheet(item.sheetId!) });
      }
      if (session.can('move', item)) {
        items.push(
          { label: '⬆️ Trazer para frente', action: () => session.zorder(item.id, 'front') },
          { label: '⬇️ Enviar para trás', action: () => session.zorder(item.id, 'back') },
        );
      }
      if (gm) {
        if (item.type === 'card') {
          items.push({
            label: item.revealed ? '🙈 Esconder verso' : '👁️ Revelar verso',
            action: () => gm.edit(item.id, { revealed: !item.revealed }),
            divider: true,
          });
        }
        if (item.type === 'token') items.push({ label: '🖼️ Imagem do token…', action: () => pickTokenImage(item.id), divider: true });
        const cur = layerOf(item);
        for (const l of LAYERS) {
          if (l !== cur) items.push({ label: `↕ Mover para: ${LAYER_LABELS[l]}`, action: () => gm.setLayer(item.id, l) });
        }
        items.push({
          label: item.locked ? '🔓 Destravar' : '📌 Travar no lugar',
          action: () => gm.updateItem(item.id, { locked: item.locked ? undefined : true }),
        });
        const hidden = isHiddenFromPlayers(item);
        items.push(
          {
            label: hidden ? '👁️ Mostrar aos jogadores' : '🙈 Ocultar dos jogadores',
            action: () => gm.setPerm(item.id, { ...item.perm, view: hidden ? 'all' : 'gm' }),
            divider: item.type !== 'card',
          },
          { label: '🔐 Permissões…', action: () => (permItem = { ...item, perm: structuredClone($state.snapshot(item.perm)) }) },
          { label: '📄 Duplicar', action: () => gm.duplicate(item.id) },
          { label: '🗑️ Excluir', action: () => gm.deleteItem(item.id), danger: true, divider: true },
        );
      }
    }
    if (items.length) menu = { x: cx, y: cy, items };
  }

  function bringAll() {
    const c = center();
    gm?.focusAll(c.x, c.y, c.scale);
  }

  function leave() {
    if (gm) go('/');
    else {
      onLeave?.();
      go('/');
    }
  }
</script>

<div class="table">
  <header class="top">
    <button class="ghost brand" onclick={leave} title="Sair para o início">
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="26" height="26" />
      <span class="hide-sm">Free TableTop</span>
    </button>
    <div class="title">
      <strong>{session.campaignName || 'Mesa'}</strong>
      <span class="status"><span class="dot" style:background={statusColor}></span>{statusLabel}</span>
      {#if gm}
        <span class="status muted hide-sm">
          {gm.saving === 'saving' ? '💾 salvando…' : gm.saving === 'error' ? '⚠️ erro ao salvar' : '💾 salvo'}
        </span>
      {/if}
    </div>

    <div class="tools">
      {#if gm}
        <button onclick={() => gm.addNote(center().x, center().y)} title="Nova nota">📝<span class="hide-sm"> Nota</span></button>
        <button onclick={() => gm.addCard(center().x, center().y)} title="Nova carta de pista">🃏<span class="hide-sm"> Carta</span></button>
        <button onclick={() => pickImage()} title="Adicionar imagem (ou arraste/cole no quadro)">🖼️<span class="hide-sm"> Imagem</span></button>
        <button onclick={bringAll} title="Centraliza a visão de todos os jogadores no que você está vendo">🎯<span class="hide-sm"> Trazer todos</span></button>
        <button class="primary" onclick={() => (showInvite = true)}>Convidar</button>
      {:else}
        <span class="me hide-sm"><span class="dot" style:background={colorFor(session.myPid)}></span>{session.nameOf(session.myPid)}</span>
      {/if}
      <button class="ghost" onclick={() => (sidebarOpen = !sidebarOpen)} title="Mostrar/esconder painel" aria-label="Painel lateral">
        {sidebarOpen ? '⟩' : '⟨'} 💬
      </button>
    </div>
  </header>

  <div class="main">
    <div class="board-wrap">
      <Board
        {session}
        {gm}
        {tool}
        {fogBrush}
        bind:renderer
        {onContext}
        onEdit={openEdit}
        onSelect={() => {}}
      />
      {#if !gm && session.status === 'online' && !session.gmOnline}
        <div class="banner">O mestre está offline. A mesa volta quando ele abrir a campanha.</div>
      {/if}
      <ToolPalette bind:tool bind:fogBrush {gm} />
      <DiceTray {session} />
      <div class="zoom">
        <button onclick={() => renderer?.zoomBy(1.25)} aria-label="Aproximar">＋</button>
        <button onclick={() => renderer?.zoomBy(0.8)} aria-label="Afastar">－</button>
        <button onclick={() => renderer?.fitAll()} aria-label="Ver tudo" title="Ver tudo">⛶</button>
      </div>
      {#if gm && session.itemsVersion >= 0 && session.items.size === 0}
        <div class="empty-hint">
          <p>Quadro vazio. Arraste imagens para cá, cole com Ctrl+V, ou use <strong>📝 Nota</strong> e <strong>🃏 Carta</strong>.</p>
          <p class="muted">Botão direito em qualquer item para permissões. Roda do mouse dá zoom; arraste o fundo para mover.</p>
        </div>
      {/if}
    </div>

    {#if sidebarOpen}
      <aside class="side">
        <nav class="tabs">
          <button class:on={tab === 'chat'} onclick={() => (tab = 'chat')}>Chat</button>
          <button class:on={tab === 'sheets'} onclick={() => (tab = 'sheets')}>Fichas</button>
          <button class:on={tab === 'combat'} onclick={() => (tab = 'combat')}>
            Combate{#if session.combat.active}<span class="live" title="Combate em andamento"></span>{/if}
          </button>
          <button class:on={tab === 'notes'} onclick={() => (tab = 'notes')} title="Diário, wiki e tabelas">Notas</button>
          <button class:on={tab === 'players'} onclick={() => (tab = 'players')} title="Jogadores">Grupo ({onlineCount})</button>
          {#if gm}<button class:on={tab === 'settings'} onclick={() => (tab = 'settings')} title="Configurações da mesa">Mesa</button>{/if}
        </nav>
        <div class="tab-body">
          {#if tab === 'chat'}
            <ChatPanel {session} />
          {:else if tab === 'sheets'}
            <SheetsPanel {session} {gm} onTemplates={() => (showTemplates = true)} onPerm={(id) => (permSheet = id)} onPlace={placeSheet} />
          {:else if tab === 'combat'}
            <CombatPanel {session} {gm} />
          {:else if tab === 'notes'}
            <NotesPanel {session} {gm} onPerm={(col, id) => (permNote = { col, id })} />
          {:else if tab === 'players'}
            <PlayersPanel {session} {gm} />
          {:else if gm}
            <SettingsPanel {gm} />
          {/if}
        </div>
      </aside>
    {/if}
  </div>

  <input type="file" accept="image/*" multiple hidden bind:this={fileInput} onchange={onFile} />

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}
  {#if tokenEditing}
    <TokenDialog {session} {gm} item={tokenEditing} onClose={() => (tokenEditing = null)} />
  {/if}
  {#if editing}
    <EditDialog {session} item={editing} onClose={() => (editing = null)} />
  {/if}
  {#if permItem && gm}
    {@const it = permItem}
    <PermissionDialog {gm} perm={it.perm} onSave={(p) => gm.setPerm(it.id, p)} onClose={() => (permItem = null)} />
  {/if}
  {#each session.openSheets as id, i (id)}
    <SheetWindow
      {session}
      {id}
      index={i}
      z={windowZ(id)}
      onFocus={() => focusSheet(id)}
      onPerm={gm ? (sid) => (permSheet = sid) : undefined}
    />
  {/each}
  {#each session.openNotes as n, i (n.id)}
    <NoteWindow
      {session}
      {gm}
      col={n.col}
      id={n.id}
      index={i}
      z={windowZ(n.id)}
      onFocus={() => focusSheet(n.id)}
      onPerm={gm ? () => (permNote = { col: n.col, id: n.id }) : undefined}
    />
  {/each}
  {#if permNote && gm && gm.docs[permNote.col][permNote.id]}
    {@const pn = permNote}
    <PermissionDialog
      {gm}
      title={pn.col === 'tables' ? 'Quem pode rolar esta tabela' : 'Quem vê e edita esta página'}
      perm={gm.docs[pn.col][pn.id].perm}
      keys={pn.col === 'tables' ? ['view'] : ['view', 'edit']}
      hints={{ view: pn.col === 'tables' ? 'Quem vê a tabela pode rolá-la.' : 'Quem não pode ver não recebe nada desta página.', edit: 'Mudar título e texto.' }}
      onSave={(p) => gm.setDocPerm(pn.col, pn.id, p)}
      onClose={() => (permNote = null)}
    />
  {/if}
  {#if showTemplates && gm}
    <TemplateEditor {gm} onClose={() => (showTemplates = false)} />
  {/if}
  {#if permSheet && gm && gm.docs.sheets[permSheet]}
    {@const sid = permSheet}
    <PermissionDialog
      {gm}
      title="Permissões da ficha"
      perm={gm.docs.sheets[sid].perm}
      keys={['view', 'edit']}
      hints={{ view: 'Quem não pode ver não recebe nada desta ficha.', edit: 'Mudar valores, nome e rolar iniciativa pela ficha.' }}
      onSave={(p) => gm.setDocPerm('sheets', sid, p)}
      onClose={() => (permSheet = null)}
    />
  {/if}
  {#if showInvite && gm}
    <div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && (showInvite = false)}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="inv-title">
        <h2 id="inv-title">Convidar jogadores</h2>
        <p class="muted">Mande este link (ou o QR code). Quem tiver o link entra na sua mesa enquanto ela estiver aberta.</p>
        <InviteBox {gm} />
        <div class="actions"><button onclick={() => (showInvite = false)}>Fechar</button></div>
      </div>
    </div>
  {/if}

  <div class="toasts" aria-live="polite">
    {#each session.toasts as t (t.id)}
      <div class="toast" class:error={t.kind === 'error'}>{t.text}</div>
    {/each}
  </div>
</div>

<style>
  .table {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    min-height: 50px;
    z-index: 5;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-title);
    font-size: 16px;
    padding: 4px 8px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }
  .title strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-title);
    font-size: 17px;
    font-weight: 400;
    color: var(--paper);
  }
  .status {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    white-space: nowrap;
  }
  .tools {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .tools button {
    white-space: nowrap;
  }
  .me {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-right: 6px;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .board-wrap {
    flex: 1;
    position: relative;
    min-width: 0;
  }
  .side {
    width: 360px;
    flex: none;
    background: var(--panel);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    flex: 1 1 auto;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 10px 4px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    font-size: 12px;
    white-space: nowrap;
  }
  .live {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    margin-left: 4px;
    vertical-align: middle;
  }
  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .tab-body {
    flex: 1;
    min-height: 0;
  }
  .zoom {
    position: absolute;
    left: 12px;
    bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .zoom button {
    width: 34px;
    height: 34px;
    padding: 0;
    background: rgba(22, 25, 32, 0.9);
  }
  .banner {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(224, 164, 58, 0.15);
    border: 1px solid var(--warn);
    color: #ffd99a;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 13px;
    max-width: calc(100% - 32px);
    text-align: center;
  }
  .empty-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    pointer-events: none;
    max-width: min(460px, calc(100% - 32px));
    color: var(--text);
    opacity: 0.8;
  }
  .toasts {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 60;
    pointer-events: none;
    width: min(440px, calc(100% - 32px));
  }
  .toast {
    background: #232833;
    border: 1px solid var(--border);
    padding: 9px 14px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    text-align: center;
  }
  .toast.error {
    border-color: var(--danger);
    color: #ffc2c2;
  }

  @media (max-width: 760px) {
    .hide-sm {
      display: none;
    }
    .side {
      position: absolute;
      inset: 0 0 0 auto;
      width: min(360px, 100%);
      z-index: 6;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.4);
    }
    .tools {
      gap: 4px;
    }
    .tools button {
      padding: 6px 8px;
    }
  }
</style>
