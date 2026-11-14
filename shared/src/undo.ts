// Desfazer/refazer do quadro: cada passo guarda só os itens que mudaram
// (antes e depois, em JSON) e, se for o caso, o mapa (grid e névoa).

export interface ItemChange {
  id: string;
  /** null = o item não existia. */
  before: string | null;
  after: string | null;
}

export interface BoardChange {
  items: ItemChange[];
  map?: { before: string; after: string };
}

/** Diferença entre dois retratos do quadro (id -> JSON do item). */
export function diffBoard(prev: Map<string, string>, next: Map<string, string>): ItemChange[] {
  const out: ItemChange[] = [];
  for (const [id, after] of next) {
    const before = prev.get(id) ?? null;
    if (before !== after) out.push({ id, before, after });
  }
  for (const [id, before] of prev) if (!next.has(id)) out.push({ id, before, after: null });
  return out;
}

export class UndoHistory {
  private undoStack: BoardChange[] = [];
  private redoStack: BoardChange[] = [];
  constructor(private limit = 100) {}

  /** Uma mudança nova apaga o que dava para refazer. */
  push(c: BoardChange) {
    if (!c.items.length && !c.map) return;
    this.undoStack.push(c);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): BoardChange | undefined {
    const c = this.undoStack.pop();
    if (c) this.redoStack.push(c);
    return c;
  }

  redo(): BoardChange | undefined {
    const c = this.redoStack.pop();
    if (c) this.undoStack.push(c);
    return c;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
