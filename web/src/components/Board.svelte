<script lang="ts">
  import { untrack } from 'svelte';
  import { BoardRenderer, type FogBrush, type Tool } from '../lib/board/renderer';
  import type { TableSession } from '../lib/session/table.svelte';
  import type { GmSession } from '../lib/session/gm.svelte';

  let {
    session,
    gm = null,
    renderer = $bindable(null),
    tool = 'select',
    fogBrush,
    onContext,
    onEdit,
    onSelect,
    onToggleVisibility,
  }: {
    session: TableSession;
    gm?: GmSession | null;
    renderer?: BoardRenderer | null;
    tool?: Tool;
    fogBrush: FogBrush;
    onContext: (id: string | null, x: number, y: number) => void;
    onEdit: (id: string) => void;
    onSelect: (id: string | null) => void;
    onToggleVisibility: (id: string) => void;
  } = $props();

  let el: HTMLDivElement;
  let dropping = $state(false);

  $effect(() => {
    const r = untrack(() => new BoardRenderer(el, session, { onContext, onEdit, onSelect, onToggleVisibility }));
    renderer = r;
    return () => {
      r.destroy();
      renderer = null;
    };
  });

  $effect(() => {
    void session.itemsVersion;
    void session.hideBadWords;
    void session.filter.words.length;
    untrack(() => renderer?.sync());
  });

  // Grid e névoa: qualquer mudança no mapa redesenha.
  $effect(() => {
    void JSON.stringify(session.map.grid);
    void session.map.fog.enabled;
    void session.map.fog.shapes.length;
    untrack(() => renderer?.syncMap());
  });

  $effect(() => {
    const t = tool;
    const b = { ...fogBrush };
    untrack(() => renderer?.setTool(t, b));
  });

  function onDragOver(e: DragEvent) {
    if (!gm || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dropping = true;
  }

  async function onDrop(e: DragEvent) {
    dropping = false;
    if (!gm || !renderer) return;
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    let { x, y } = renderer.clientToBoard(e.clientX, e.clientY);
    for (const f of files) {
      await gm.addImage(f, x, y);
      x += 40;
      y += 40;
    }
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest?.('input, textarea, select, [contenteditable]')) return;
    // Ctrl+Z desfaz; Ctrl+Y ou Ctrl+Shift+Z refaz (Cmd no Mac). Campos de texto têm o próprio desfazer.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) session.redo();
        else session.undo();
        return;
      }
    }
    const id = renderer?.selectedId;
    if (!id) return;
    if (gm && (e.key === 'Delete' || e.key === 'Backspace')) {
      gm.deleteItem(id);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      renderer?.select(null);
    }
  }

  async function onPaste(e: ClipboardEvent) {
    if (!gm || !renderer) return;
    const t = e.target as HTMLElement;
    if (t.closest?.('input, textarea')) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    const c = renderer.viewCenter();
    await gm.addImage(file, c.x, c.y);
  }
</script>

<svelte:window onkeydown={onKey} onpaste={onPaste} />

<div
  class="board"
  class:dropping
  bind:this={el}
  ondragover={onDragOver}
  ondragleave={() => (dropping = false)}
  ondrop={onDrop}
  role="application"
  aria-label="Quadro da mesa"
></div>

<style>
  .board {
    position: absolute;
    inset: 0;
    background-color: transparent;
    background-image:
      linear-gradient(rgba(212, 175, 106, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(212, 175, 106, 0.035) 1px, transparent 1px),
      linear-gradient(rgba(212, 175, 106, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(212, 175, 106, 0.06) 1px, transparent 1px);
    overflow: hidden;
    touch-action: none;
  }
  .board:global(.mapgrid) {
    background-image: none;
  }
  .board.dropping {
    outline: 3px dashed var(--accent-2);
    outline-offset: -8px;
  }
</style>
