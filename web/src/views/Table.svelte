<script lang="ts">
  import { centerOf, colorFor, isHiddenFromPlayers, LAYER_LABELS, LAYERS, layerOf, type BoardItem } from '@ftt/shared';
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
  import Icon, { type IconName } from '../components/Icon.svelte';

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

  /** Abas do painel, com uma frase explicando o que tem em cada uma. */
  const TABS: Array<{ id: Tab; icon: IconName; name: string; gmOnly?: boolean; help: (gm: boolean) => string }> = [
    { id: 'chat', icon: 'chat', name: 'Chat', help: () => 'Conversa da mesa. /w nome para sussurrar; os dados ficam na bandeja 🎲.' },
    { id: 'sheets', icon: 'scroll', name: 'Fichas', help: (g) => (g ? 'Personagens, NPCs e inimigos. A moeda põe o token no mapa; o cadeado libera a ficha para alguém.' : 'Sua ficha. Clique num atributo para rolar.') },
    { id: 'combat', icon: 'swords', name: 'Combate', help: (g) => (g ? 'Ordem de iniciativa, turnos e vida. Botão direito num token: entrar no combate.' : 'Ordem dos turnos. Role sua iniciativa aqui.') },
    { id: 'notes', icon: 'book', name: 'Notas', help: (g) => (g ? 'Diário das sessões, wiki da campanha e tabelas aleatórias.' : 'Páginas e tabelas que o mestre liberou.') },
    { id: 'players', icon: 'group', name: 'Grupo', help: (g) => (g ? 'Quem está na mesa: silenciar, expulsar e convidar.' : 'Quem está na mesa.') },
    { id: 'settings', icon: 'gear', name: 'Mesa', gmOnly: true, help: () => 'Convite, mapa, atributos, combate, fichas e filtro.' },
  ];
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
    const r = gm?.placeSheet(sheetId, c.x, c.y);
    if (!r) return;
    if (r.existing) {
      // PJ/NPC já tem token: leva a visão até ele em vez de duplicar.
      const ctr = centerOf(r.item);
      renderer?.focus(ctr.x, ctr.y, Math.max(1, c.scale));
      renderer?.select(r.item.id);
      gm?.toast('Esse personagem já está no mapa.');
    }
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

  function toggleVisibility(id: string) {
    const item = session.items.get(id);
    if (!item || !gm) return;
    const hidden = isHiddenFromPlayers(item);
    gm.setPerm(item.id, { ...item.perm, view: hidden ? 'all' : 'gm' });
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
        if (item.type === 'token') {
          items.push({ label: '🖼️ Imagem do token…', action: () => pickTokenImage(item.id), divider: true });
          const inCombat = session.combat.entries.some((e) => e.tokenId === item.id || (!!item.sheetId && e.sheetId === item.sheetId && !e.tokenId && session.docs.sheets[item.sheetId]?.kind !== 'monster'));
          if (!inCombat) items.push({ label: '⚔️ Entrar no combate', action: () => gm.tokenToCombat(item.id) });
        }
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
            action: () => toggleVisibility(item.id),
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
  <header class="top wood">
    <button class="ghost brand" onclick={leave} title="Sair para o início">
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="26" height="26" />
      <span class="hide-sm">Free TableTop</span>
    </button>
    <div class="title">
      <strong class="banner-name">{session.campaignName || 'Mesa'}</strong>
      <span class="status"><span class="dot" style:background={statusColor}></span>{statusLabel}</span>
      {#if gm}
        <span class="status muted hide-sm">
          {gm.saving === 'saving' ? '💾 salvando…' : gm.saving === 'error' ? '⚠️ erro ao salvar' : '💾 salvo'}
        </span>
      {/if}
    </div>

    <div class="tools">
      {#if gm}
        <div class="group" role="group" aria-label="Adicionar ao quadro">
          <span class="glabel hide-sm">Pôr no quadro</span>
          <button onclick={() => gm.addNote(center().x, center().y)} title="Nova nota (só você vê até mostrar no olho)"><Icon name="note" size={17} /><span class="hide-sm">Nota</span></button>
          <button onclick={() => gm.addCard(center().x, center().y)} title="Nova pista com verso secreto"><Icon name="clue" size={17} /><span class="hide-sm">Pista</span></button>
          <button onclick={() => pickImage()} title="Adicionar imagem ou mapa (também dá para arrastar ou colar no quadro)"><Icon name="image" size={17} /><span class="hide-sm">Imagem</span></button>
        </div>
        <button class="ib" onclick={bringAll} title="Leva a visão de todos os jogadores para o que você está vendo"><Icon name="target" size={17} /><span class="hide-sm">Chamar todos aqui</span></button>
        <button class="primary ib" onclick={() => (showInvite = true)}><Icon name="seal" size={17} />Convidar</button>
      {:else}
        <span class="me hide-sm"><span class="dot" style:background={colorFor(session.myPid)}></span>{session.nameOf(session.myPid)}</span>
      {/if}
      <button class="ghost ib" onclick={() => (sidebarOpen = !sidebarOpen)} title={sidebarOpen ? 'Esconder o painel' : 'Mostrar o painel (chat, fichas, combate...)'} aria-label="Painel lateral">
        <Icon name="panel" size={18} /><span class="hide-sm">{sidebarOpen ? 'Fechar painel' : 'Painel'}</span>
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
        onToggleVisibility={toggleVisibility}
      />
      {#if !gm && session.status === 'online' && !session.gmOnline}
        <div class="banner">O mestre está offline. A mesa volta quando ele abrir a campanha.</div>
      {/if}
      <ToolPalette bind:tool bind:fogBrush {gm} />
      <DiceTray {session} />
      <div class="zoom wood frame" role="toolbar" aria-label="Visão e desfazer">
        <button class="ghost" onclick={() => renderer?.zoomBy(1.25)} aria-label="Aproximar" title="Aproximar (ou roda do mouse)"><Icon name="plus" /></button>
        <button class="ghost" onclick={() => renderer?.zoomBy(0.8)} aria-label="Afastar" title="Afastar (ou roda do mouse)"><Icon name="minus" /></button>
        <button class="ghost" onclick={() => renderer?.fitAll()} aria-label="Ver tudo" title="Enquadrar tudo"><Icon name="fit" /></button>
        <span class="sep"></span>
        <button class="ghost" onclick={() => session.undo()} disabled={!session.canUndo} aria-label="Desfazer" title={gm ? 'Desfazer (Ctrl+Z)' : 'Desfazer o movimento do seu token (Ctrl+Z)'}><Icon name="undo" /></button>
        <button class="ghost" onclick={() => session.redo()} disabled={!session.canRedo} aria-label="Refazer" title="Refazer (Ctrl+Y)"><Icon name="redo" /></button>
      </div>
      {#if gm && session.itemsVersion >= 0 && session.items.size === 0}
        <div class="empty-hint parchment">
          <h2>Mesa vazia</h2>
          <p>Arraste a imagem do mapa para cá (ou cole com Ctrl+V). Depois use a moeda na aba <strong>Fichas</strong> para pôr os personagens.</p>
          <p class="muted">Botão direito em qualquer coisa mostra o que dá para fazer. Roda do mouse dá zoom; arraste o fundo para andar.</p>
        </div>
      {/if}
    </div>

    {#if sidebarOpen}
      <aside class="side leather">
        <nav class="tabs wood" aria-label="Painéis">
          {#each TABS.filter((t) => !t.gmOnly || gm) as t (t.id)}
            <button class:on={tab === t.id} onclick={() => (tab = t.id)} title={t.help(!!gm)} aria-label={t.name}>
              <span class="ti"><Icon name={t.icon} size={19} /></span>
              <span class="tn">{t.id === 'players' ? `${t.name} (${onlineCount})` : t.name}</span>
              {#if t.id === 'combat' && session.combat.active}<span class="live" title="Combate em andamento"></span>{/if}
            </button>
          {/each}
        </nav>
        {#each TABS.filter((t) => t.id === tab) as t (t.id)}
          <div class="tab-head">
            <strong>{t.name}</strong>
            <span>{t.help(!!gm)}</span>
          </div>
        {/each}
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
    <PermissionDialog
      {gm}
      title="Quem pode ver"
      perm={it.perm}
      keys={['view']}
      hints={{ view: it.type === 'token' ? 'Esconde o token dos jogadores (ex.: emboscada).' : 'Só o mestre move e edita; cada jogador só mexe no próprio token.' }}
      onSave={(p) => gm.setPerm(it.id, p)}
      onClose={() => (permItem = null)}
    />
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
      <div class="toast parchment" class:error={t.kind === 'error'}>{t.text}</div>
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
    background: var(--wood);
    border-bottom: 1px solid #4a3a28;
    box-shadow: 0 1px 0 rgba(201, 164, 92, 0.25), 0 4px 14px rgba(0, 0, 0, 0.45);
    min-height: 52px;
    z-index: 5;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px 3px 10px;
    border: 1px solid #4a3a28;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.18);
  }
  .glabel {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-right: 4px;
  }
  .group button {
    background: transparent;
    border-color: transparent;
    padding: 5px 9px;
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
    font-weight: 700;
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
    background: var(--wood-dark);
    border-left: 1px solid #4a3a28;
    box-shadow: inset 1px 0 0 rgba(201, 164, 92, 0.15);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tabs {
    display: flex;
    background: var(--wood);
    border-bottom: 1px solid #4a3a28;
  }
  .tabs button {
    flex: 1 1 0;
    min-width: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    padding: 7px 2px 6px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    font-size: 11px;
    white-space: nowrap;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    position: relative;
  }
  .ti {
    font-size: 17px;
    line-height: 1;
    filter: grayscale(0.6);
    opacity: 0.8;
  }
  .tn {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .tabs button:hover:not(.on) {
    background: rgba(201, 164, 92, 0.06);
  }
  .tab-head {
    padding: 8px 12px 9px;
    border-bottom: 1px solid #3b2f22;
    background: rgba(0, 0, 0, 0.18);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tab-head strong {
    font-family: var(--font-title);
    color: var(--brass);
    font-size: 15px;
  }
  .tab-head span {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.35;
  }
  .live {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
    position: absolute;
    top: 6px;
    right: calc(50% - 16px);
  }
  .tabs button.on {
    color: var(--brass);
    border-bottom-color: var(--brass);
    background: linear-gradient(180deg, transparent, rgba(201, 164, 92, 0.1));
  }
  .tabs button.on .ti {
    filter: none;
    opacity: 1;
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
    gap: 2px;
    padding: 4px;
    border-radius: 10px;
  }
  .zoom button {
    width: 36px;
    height: 32px;
    padding: 0;
    background: transparent;
    border-color: transparent;
    font-size: 16px;
  }
  .zoom .sep {
    height: 1px;
    margin: 3px 4px;
    background: #4a3a28;
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
    opacity: 0.85;
    background: rgba(15, 12, 9, 0.6);
    border: 1px dashed #5a4630;
    border-radius: 12px;
    padding: 18px 22px;
  }
  .empty-hint h2 {
    color: var(--brass);
    font-size: 20px;
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
    background: var(--wood);
    border: 1px solid #5a4630;
    padding: 9px 14px;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    text-align: center;
  }
  .toast.error {
    border-color: var(--danger);
    color: #ffc2c2;
  }

  /* ===== arte ===== */
  .top {
    position: relative;
    border-bottom: 0 !important;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.55) !important;
  }
  /* trilho de latão com pregos embaixo da barra */
  .top::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -5px;
    height: 6px;
    background: var(--nails) 0 50% / 90px 6px repeat-x, var(--metal);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }
  .brand {
    font-family: var(--font-deco) !important;
    color: var(--brass);
    text-shadow: 0 1px 0 #000, 0 0 10px rgba(201, 164, 92, 0.25);
  }
  /* nome da campanha numa faixa de pergaminho */
  .banner-name {
    color: #3a2410 !important;
    font-family: var(--font-deco) !important;
    font-size: 15px !important;
    text-shadow: none;
    padding: 4px 22px 5px;
    background: #e8d4a6 var(--tex-leather);
    background-image: radial-gradient(ellipse at 50% 40%, #f4e6c3, #dcc08a);
    clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 50%, 100% 100%, 0 100%, 10px 50%);
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6));
    max-width: 280px;
    min-width: 120px;
  }
  .title {
    overflow: hidden;
  }
  .ib,
  .group button {
    display: inline-flex !important;
    align-items: center;
    gap: 6px;
  }
  .group {
    background: rgba(0, 0, 0, 0.28) !important;
    border: 1px solid #120c07 !important;
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.6), 0 1px 0 rgba(255, 222, 160, 0.1);
  }
  .glabel {
    font-family: var(--font-fell);
    text-transform: none !important;
    font-size: 13px !important;
    color: var(--brass) !important;
  }
  .side {
    position: relative;
    border-left: 0 !important;
    box-shadow: inset 4px 0 8px rgba(0, 0, 0, 0.5), -2px 0 0 #120c07, -4px 0 0 #6d4f22 !important;
  }
  /* costura do couro */
  .side::after {
    content: '';
    position: absolute;
    inset: 82px 6px 6px 6px;
    border: 1.5px dashed rgba(201, 164, 92, 0.22);
    border-radius: 6px;
    pointer-events: none;
  }
  .tabs {
    border-bottom: 0 !important;
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.5);
    padding: 4px 4px 0;
    gap: 2px;
  }
  .tabs button {
    font-family: var(--font-fell);
    font-size: 12px !important;
    border-radius: 6px 6px 0 0 !important;
    border-bottom: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
    color: #bda57d !important;
  }
  .tabs button:hover:not(.on) {
    color: #f0dcae !important;
    background: rgba(0, 0, 0, 0.2) !important;
  }
  /* aba ativa: placa de latão gravada */
  .tabs button.on {
    background: var(--metal) !important;
    color: #2b1a08 !important;
    text-shadow: 0 1px 0 rgba(255, 240, 200, 0.6) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 -1px 4px rgba(0, 0, 0, 0.5) !important;
  }
  .tabs button.on .ti :global(.ico) {
    filter: drop-shadow(0 1px 0 rgba(255, 240, 200, 0.6));
  }
  .ti {
    filter: none !important;
    opacity: 1 !important;
  }
  /* cabeçalho do painel: etiqueta de pergaminho */
  .tab-head {
    margin: 10px 12px 2px;
    padding: 7px 26px 8px 14px !important;
    border: 0 !important;
    background: radial-gradient(ellipse at 40% 40%, #f4e6c3, #dcc08a) !important;
    clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 50%, 100% 100%, 0 100%);
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.6));
  }
  .tab-head strong {
    font-family: var(--font-deco) !important;
    color: #5a1f0c !important;
    font-size: 15px !important;
  }
  .tab-head span {
    color: #4a3519 !important;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 13.5px !important;
  }
  .tab-body {
    position: relative;
    z-index: 1;
  }
  /* mesa de madeira (o quadro fica por cima) */
  .board-wrap {
    background-color: #1a120b;
    background-image:
      radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(0, 0, 0, 0.75) 100%),
      repeating-linear-gradient(0deg, transparent 0 158px, rgba(0, 0, 0, 0.55) 158px 160px, rgba(255, 220, 160, 0.04) 160px 161px),
      var(--tex-wood),
      linear-gradient(180deg, #2b1d12, #22170e);
    background-size: 100% 100%, 100% 100%, 600px 220px, 100% 100%;
  }
  .zoom {
    padding: 2px !important;
    border-radius: 0 !important;
  }
  .zoom button {
    color: #e6cf9c;
  }
  .zoom .sep {
    background: linear-gradient(90deg, transparent, #c9a45c, transparent) !important;
  }
  .empty-hint {
    opacity: 1 !important;
    border: 0 !important;
    border-radius: 3px !important;
    padding: 22px 26px !important;
    color: var(--ink);
  }
  .empty-hint h2 {
    font-family: var(--font-deco);
    color: #5a1f0c !important;
  }
  .toast {
    border-radius: 3px !important;
    color: var(--ink) !important;
    font-family: 'Crimson Pro', Georgia, serif;
    font-size: 15px;
  }
  .toast.error {
    color: #8b1e1e !important;
    font-weight: 600;
  }
  @media (max-width: 1360px) {
    .glabel,
    .title .status.muted {
      display: none;
    }
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
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.4) !important;
      position: absolute !important;
    }
    .tools {
      gap: 4px;
    }
    .tools button {
      padding: 6px 8px;
    }
  }
</style>
