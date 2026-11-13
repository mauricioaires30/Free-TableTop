// Desenha o quadro livre com Konva: itens, seleção, pan/zoom e cursores dos jogadores.
import Konva from 'konva';
import { colorFor, isHiddenFromPlayers, TRANSFORM_FIELDS, type BoardItem, type TransformPatch } from '@ftt/shared';
import type { TableSession } from '../session/table.svelte';

export interface BoardCallbacks {
  onContext(id: string | null, clientX: number, clientY: number): void;
  onEdit(id: string): void;
  onSelect(id: string | null): void;
}

const GRID = 40;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const MIN_SIZE: Record<BoardItem['type'], { w: number; h: number }> = {
  note: { w: 80, h: 60 },
  card: { w: 140, h: 120 },
  image: { w: 30, h: 30 },
};
const CURSOR_PATH = 'M0 0 L0 17 L4.5 13 L7.5 20 L10.5 18.8 L7.6 12 L13 12 Z';

export class BoardRenderer {
  readonly stage: Konva.Stage;
  private itemsLayer = new Konva.Layer();
  private cursorLayer = new Konva.Layer({ listening: false });
  private tr: Konva.Transformer;
  private nodes = new Map<string, Konva.Group>();
  private cursorNodes = new Map<string, Konva.Group>();
  private images = new Map<string, HTMLImageElement | 'loading' | 'missing'>();
  private dragging: string | null = null;
  private transforming: string | null = null;
  private selected: string | null = null;
  private lastSend = 0;
  private raf = 0;
  private ro: ResizeObserver;

  constructor(
    private container: HTMLDivElement,
    private s: TableSession,
    private cb: BoardCallbacks,
  ) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
      draggable: true,
    });
    this.tr = new Konva.Transformer({
      rotationSnaps: [0, 90, 180, 270],
      flipEnabled: false,
      ignoreStroke: true,
      anchorSize: 9,
      borderStroke: '#c0392b',
      anchorStroke: '#c0392b',
      anchorFill: '#f1e9da',
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 30 || Math.abs(newBox.height) < 30 ? oldBox : newBox),
    });
    this.itemsLayer.add(this.tr);
    this.stage.add(this.itemsLayer, this.cursorLayer);
    this.stage.position({ x: this.stage.width() / 2, y: this.stage.height() / 2 });

    this.bindStage();
    this.ro = new ResizeObserver(() => {
      this.stage.size({ width: container.clientWidth, height: container.clientHeight });
    });
    this.ro.observe(container);
    this.updateGrid();
    this.sync();
    document.fonts?.ready.then(() => this.rebuildAll());
    s.focusHandler = (x, y, scale) => this.focus(x, y, scale);
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------- visão ----------

  private bindStage() {
    const st = this.stage;
    st.on('wheel', (e) => {
      e.evt.preventDefault();
      const old = st.scaleX();
      const p = st.getPointerPosition();
      if (!p) return;
      const m = { x: (p.x - st.x()) / old, y: (p.y - st.y()) / old };
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * Math.exp(-e.evt.deltaY * 0.0015)));
      st.scale({ x: ns, y: ns });
      st.position({ x: p.x - m.x * ns, y: p.y - m.y * ns });
      this.updateGrid();
    });
    st.on('dragmove', (e) => {
      if (e.target === st) this.updateGrid();
    });
    st.on('click tap', (e) => {
      if (e.target === st) this.select(null);
    });
    st.on('contextmenu', (e) => {
      e.evt.preventDefault();
      if (e.target === st) {
        this.select(null);
        this.cb.onContext(null, e.evt.clientX, e.evt.clientY);
      }
    });
    st.on('mousemove touchmove', () => {
      const p = st.getRelativePointerPosition();
      if (p) this.s.sendCursor(p.x, p.y);
    });
  }

  private updateGrid() {
    const sc = this.stage.scaleX();
    const size = GRID * sc;
    const big = size * 5;
    this.container.style.backgroundSize = `${size}px ${size}px, ${size}px ${size}px, ${big}px ${big}px, ${big}px ${big}px`;
    this.container.style.backgroundPosition = `${this.stage.x()}px ${this.stage.y()}px`;
  }

  /** Centro da tela em coordenadas do quadro. */
  viewCenter(): { x: number; y: number; scale: number } {
    const sc = this.stage.scaleX();
    return {
      x: (this.stage.width() / 2 - this.stage.x()) / sc,
      y: (this.stage.height() / 2 - this.stage.y()) / sc,
      scale: sc,
    };
  }

  clientToBoard(clientX: number, clientY: number) {
    const r = this.container.getBoundingClientRect();
    const sc = this.stage.scaleX();
    return { x: (clientX - r.left - this.stage.x()) / sc, y: (clientY - r.top - this.stage.y()) / sc };
  }

  focus(x: number, y: number, scale: number) {
    const sc = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    new Konva.Tween({
      node: this.stage,
      duration: 0.5,
      easing: Konva.Easings.EaseInOut,
      scaleX: sc,
      scaleY: sc,
      x: this.stage.width() / 2 - x * sc,
      y: this.stage.height() / 2 - y * sc,
      onUpdate: () => this.updateGrid(),
      onFinish: () => this.updateGrid(),
    }).play();
  }

  zoomBy(f: number) {
    const c = this.viewCenter();
    this.focus(c.x, c.y, c.scale * f);
  }

  /** Enquadra todos os itens visíveis. */
  fitAll() {
    const items = [...this.s.items.values()];
    if (!items.length) return this.focus(0, 0, 1);
    const minX = Math.min(...items.map((i) => i.x));
    const minY = Math.min(...items.map((i) => i.y));
    const maxX = Math.max(...items.map((i) => i.x + i.w));
    const maxY = Math.max(...items.map((i) => i.y + i.h));
    const sc = Math.min(1.5, (this.stage.width() - 80) / (maxX - minX || 1), (this.stage.height() - 80) / (maxY - minY || 1));
    this.focus((minX + maxX) / 2, (minY + maxY) / 2, sc);
  }

  // ---------- itens ----------

  select(id: string | null) {
    this.selected = id;
    const g = id ? this.nodes.get(id) : null;
    const item = id ? this.s.items.get(id) : null;
    if (g && item && this.s.can('move', item)) {
      const min = MIN_SIZE[item.type];
      this.tr.boundBoxFunc((oldBox, newBox) => {
        const sc = this.stage.scaleX();
        return Math.abs(newBox.width) < min.w * sc || Math.abs(newBox.height) < min.h * sc ? oldBox : newBox;
      });
      this.tr.keepRatio(item.type === 'image');
      this.tr.enabledAnchors(
        item.type === 'image'
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right'],
      );
      this.tr.nodes([g]);
      this.tr.moveToTop();
    } else {
      this.tr.nodes([]);
    }
    this.cb.onSelect(id);
  }

  get selectedId() {
    return this.selected;
  }

  sync() {
    const sorted = [...this.s.items.values()].sort((a, b) => a.z - b.z);
    const seen = new Set<string>();
    for (const item of sorted) {
      seen.add(item.id);
      let g = this.nodes.get(item.id);
      if (!g) {
        g = this.create(item);
        this.nodes.set(item.id, g);
        this.itemsLayer.add(g);
      }
      this.update(g, item);
      g.moveToTop();
    }
    for (const [id, g] of this.nodes) {
      if (seen.has(id)) continue;
      g.destroy();
      this.nodes.delete(id);
      if (this.selected === id) this.select(null);
    }
    if (this.selected) this.select(this.selected);
    this.tr.moveToTop();
    this.itemsLayer.batchDraw();
  }

  private rebuildAll() {
    for (const [id, g] of this.nodes) {
      const item = this.s.items.get(id);
      if (item) this.build(g, item, item.w, item.h);
    }
    this.tr.forceUpdate();
    this.itemsLayer.batchDraw();
  }

  private create(item: BoardItem): Konva.Group {
    const g = new Konva.Group({ id: item.id });
    const id = item.id;
    g.on('click tap', (e) => {
      e.cancelBubble = true;
      this.select(id);
    });
    g.on('dblclick dbltap', () => this.cb.onEdit(id));
    g.on('contextmenu', (e) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      this.select(id);
      this.cb.onContext(id, e.evt.clientX, e.evt.clientY);
    });
    g.on('dragstart', () => {
      this.dragging = id;
      this.select(id);
    });
    g.on('dragmove', () => this.sendTransform(id, { x: g.x(), y: g.y() }, false));
    g.on('dragend', () => {
      this.dragging = null;
      this.sendTransform(id, { x: g.x(), y: g.y() }, true);
    });
    g.on('transformstart', () => (this.transforming = id));
    g.on('transform', () => {
      const item = this.s.items.get(id);
      if (!item) return;
      const min = MIN_SIZE[item.type];
      const w = Math.max(min.w, g.width() * g.scaleX());
      const h = Math.max(min.h, g.height() * g.scaleY());
      g.scale({ x: 1, y: 1 });
      this.build(g, item, w, h);
      this.sendTransform(id, { x: g.x(), y: g.y(), w, h, rotation: g.rotation() }, false);
    });
    g.on('transformend', () => {
      this.transforming = null;
      this.sendTransform(id, { x: g.x(), y: g.y(), w: g.width(), h: g.height(), rotation: g.rotation() }, true);
    });
    return g;
  }

  private sendTransform(id: string, patch: Partial<BoardItem>, final: boolean) {
    const now = performance.now();
    if (!final && now - this.lastSend < 70) return;
    this.lastSend = now;
    const out: TransformPatch = {};
    for (const k of TRANSFORM_FIELDS) {
      const v = patch[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 10) / 10;
    }
    this.s.transform(id, out, final);
  }

  private update(g: Konva.Group, item: BoardItem) {
    const busy = this.dragging === item.id || this.transforming === item.id;
    g.draggable(this.s.can('move', item));
    if (!busy) {
      g.position({ x: item.x, y: item.y });
      g.rotation(item.rotation);
      this.build(g, item, item.w, item.h);
    }
  }

  private build(g: Konva.Group, item: BoardItem, w: number, h: number) {
    g.destroyChildren();
    g.size({ width: w, height: h });
    const gm = this.s.role === 'gm';
    const hidden = gm && isHiddenFromPlayers(item);
    g.opacity(hidden ? 0.55 : 1);
    const shadow = { shadowColor: '#000', shadowBlur: 14, shadowOpacity: 0.45, shadowOffset: { x: 0, y: 4 } };

    // Texto fica num grupo recortado para nunca vazar do item.
    const clip = () => new Konva.Group({ clip: { x: 0, y: 0, width: w, height: h } });

    if (item.type === 'note') {
      g.add(new Konva.Rect({ width: w, height: h, fill: item.color ?? '#f5e6a8', cornerRadius: 3, ...shadow }));
      g.add(clip().add(new Konva.Text({
        x: 14, y: 14, width: Math.max(10, w - 28), height: Math.max(10, h - 28), text: item.text ?? '',
        fontFamily: 'Patrick Hand, cursive', fontSize: 22, lineHeight: 1.15, fill: '#2b2620', ellipsis: true,
      })));
    } else if (item.type === 'card') {
      const showBack = item.back !== undefined && (item.revealed || gm);
      g.add(new Konva.Rect({ width: w, height: h, fill: item.color ?? '#efe4cc', stroke: '#6b1d1d', strokeWidth: 2, cornerRadius: 8, ...shadow }));
      let body = item.front ?? '';
      if (showBack) body += `\n\n— ${item.revealed ? 'revelado' : 'verso (só você vê)'} —\n${item.back}`;
      g.add(clip().add(
        new Konva.Text({
          x: 16, y: 14, width: Math.max(10, w - 32), text: item.title ?? '', fontFamily: 'Special Elite, monospace',
          fontSize: 22, fill: '#6b1d1d', ellipsis: true, wrap: 'none',
        }),
        new Konva.Line({ points: [16, 48, w - 16, 48], stroke: '#6b1d1d', strokeWidth: 1, opacity: 0.5 }),
        new Konva.Text({
          x: 16, y: 58, width: Math.max(10, w - 32), height: Math.max(10, h - 72), text: body,
          fontFamily: 'Special Elite, monospace', fontSize: 15, lineHeight: 1.3, fill: '#2b2620', ellipsis: true,
        }),
      ));
      if (gm && !item.revealed) {
        g.add(new Konva.Text({ x: w - 30, y: 16, text: '🔒', fontSize: 16 }));
      }
    } else if (item.type === 'image') {
      const img = item.img ? this.images.get(item.img) : undefined;
      if (img instanceof HTMLImageElement) {
        g.add(new Konva.Image({ image: img, width: w, height: h, ...shadow }));
      } else {
        g.add(new Konva.Rect({ width: w, height: h, fill: '#23262f', stroke: '#3a3f4b', dash: [6, 6], cornerRadius: 6 }));
        g.add(new Konva.Text({
          width: w, height: h, align: 'center', verticalAlign: 'middle', fill: '#8a90a0', fontSize: 15,
          text: img === 'missing' ? 'imagem indisponível' : 'carregando imagem…',
        }));
        if (item.img && img === undefined) this.loadImage(item.img);
      }
    }

    if (hidden) {
      g.add(new Konva.Label({ x: 0, y: -26 }).add(
        new Konva.Tag({ fill: '#000', opacity: 0.7, cornerRadius: 4 }),
        new Konva.Text({ text: '👁 oculto dos jogadores', fontSize: 12, padding: 5, fill: '#ddd' }),
      ));
    }
  }

  private async loadImage(hash: string) {
    this.images.set(hash, 'loading');
    const url = await this.s.images.url(hash);
    if (!url) {
      this.images.set(hash, 'missing');
      return this.rebuildHash(hash);
    }
    const el = new Image();
    el.onload = () => {
      this.images.set(hash, el);
      this.rebuildHash(hash);
    };
    el.onerror = () => {
      this.images.set(hash, 'missing');
      this.rebuildHash(hash);
    };
    el.src = url;
  }

  private rebuildHash(hash: string) {
    for (const [id, g] of this.nodes) {
      const item = this.s.items.get(id);
      if (item?.img === hash && this.dragging !== id && this.transforming !== id) this.build(g, item, item.w, item.h);
    }
    this.itemsLayer.batchDraw();
  }

  /** Tenta de novo imagens que falharam (ex.: o mestre voltou). */
  retryImages() {
    for (const [hash, v] of this.images) if (v === 'missing') this.images.delete(hash);
    this.sync();
  }

  // ---------- cursores ----------

  private tick = () => {
    const now = performance.now();
    const inv = 1 / this.stage.scaleX();
    let changed = false;
    for (const [pid, c] of this.s.cursors) {
      let n = this.cursorNodes.get(pid);
      if (!n) {
        n = this.makeCursor(pid);
        this.cursorNodes.set(pid, n);
        this.cursorLayer.add(n);
      }
      const dx = c.tx - c.x;
      const dy = c.ty - c.y;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
        c.x += dx * 0.35;
        c.y += dy * 0.35;
        changed = true;
      }
      const op = now - c.last > 8000 ? 0.25 : 1;
      if (n.opacity() !== op || n.scaleX() !== inv || n.x() !== c.x || n.y() !== c.y) changed = true;
      n.opacity(op);
      n.position({ x: c.x, y: c.y });
      n.scale({ x: inv, y: inv });
    }
    for (const [pid, n] of this.cursorNodes) {
      if (this.s.cursors.has(pid)) continue;
      n.destroy();
      this.cursorNodes.delete(pid);
      changed = true;
    }
    if (changed) this.cursorLayer.batchDraw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private makeCursor(pid: string): Konva.Group {
    const color = colorFor(pid);
    const g = new Konva.Group();
    g.add(new Konva.Path({ data: CURSOR_PATH, fill: color, stroke: '#111', strokeWidth: 1.2, scale: { x: 1.2, y: 1.2 } }));
    g.add(new Konva.Label({ x: 14, y: 20 }).add(
      new Konva.Tag({ fill: color, cornerRadius: 4 }),
      new Konva.Text({ text: this.s.nameOf(pid), fontSize: 12, fontFamily: 'Inter, sans-serif', padding: 4, fill: '#111' }),
    ));
    return g;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    if (this.s.focusHandler) this.s.focusHandler = null;
    this.stage.destroy();
  }
}
