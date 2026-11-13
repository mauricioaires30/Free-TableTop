// Desenha o quadro com Konva: itens, tokens, camadas, grid, névoa de guerra,
// seleção, pan/zoom, régua, pings e cursores dos jogadores.
import Konva from 'konva';
import {
  colorFor, drawOrder, formatDistance, gridDistance, hexCenter, hpOf, isHiddenFromPlayers, layerOf, rotateAroundCenter, snapToGrid,
  TRANSFORM_FIELDS, type BoardItem, type FogShape, type TransformPatch,
} from '@ftt/shared';
import type { TableSession } from '../session/table.svelte';

export interface BoardCallbacks {
  onContext(id: string | null, clientX: number, clientY: number): void;
  onEdit(id: string): void;
  onSelect(id: string | null): void;
}

export type Tool = 'select' | 'ruler' | 'ping' | 'fog';
export interface FogBrush {
  op: 'reveal' | 'hide';
  shape: 'rect' | 'brush';
  r: number;
}

const DECOR_GRID = 40;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const FOG_COLOR = '#05060a';
const HUGE = 100000;
const MIN_SIZE: Record<BoardItem['type'], { w: number; h: number }> = {
  note: { w: 80, h: 60 },
  card: { w: 140, h: 120 },
  image: { w: 30, h: 30 },
  token: { w: 20, h: 20 },
  clock: { w: 60, h: 60 },
};
const CURSOR_PATH = 'M0 0 L0 17 L4.5 13 L7.5 20 L10.5 18.8 L7.6 12 L13 12 Z';
const SQRT3 = Math.sqrt(3);

export class BoardRenderer {
  readonly stage: Konva.Stage;
  private itemsLayer = new Konva.Layer();
  private fogLayer = new Konva.Layer({ listening: false });
  private overlay = new Konva.Layer({ listening: false });
  private tr: Konva.Transformer;
  private gridShape: Konva.Shape;
  private nodes = new Map<string, Konva.Group>();
  private cursorNodes = new Map<string, Konva.Group>();
  private rulerNodes = new Map<string, Konva.Group>();
  private pingNodes = new Map<object, Konva.Circle>();
  private images = new Map<string, HTMLImageElement | 'loading' | 'missing'>();
  private dragging: string | null = null;
  private transforming: string | null = null;
  private selected: string | null = null;
  private lastSend = 0;
  private raf = 0;
  private ro: ResizeObserver;

  private tool: Tool = 'select';
  private fogBrush: FogBrush = { op: 'reveal', shape: 'rect', r: 60 };
  /** Gesto em andamento (régua ou névoa). */
  private gesture: { x: number; y: number; pts: number[]; node: Konva.Node } | null = null;
  private myRuler: number[] | null = null;
  private rulerClear: ReturnType<typeof setTimeout> | undefined;
  private fogKey = '';
  private rotTimer: ReturnType<typeof setTimeout> | undefined;

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
    });
    this.gridShape = new Konva.Shape({ listening: false, sceneFunc: (ctx) => this.drawGrid(ctx) });
    this.itemsLayer.add(this.gridShape, this.tr);
    this.stage.add(this.itemsLayer, this.fogLayer, this.overlay);
    this.stage.position({ x: this.stage.width() / 2, y: this.stage.height() / 2 });

    this.bindStage();
    this.ro = new ResizeObserver(() => {
      this.stage.size({ width: container.clientWidth, height: container.clientHeight });
    });
    this.ro.observe(container);
    this.updateDecor();
    this.sync();
    this.syncMap();
    document.fonts?.ready.then(() => this.rebuildAll());
    s.focusHandler = (x, y, scale) => this.focus(x, y, scale);
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------- ferramentas ----------

  setTool(tool: Tool, brush?: FogBrush) {
    if (tool === 'fog' && this.s.role !== 'gm') tool = 'select';
    this.tool = tool;
    if (brush) this.fogBrush = brush;
    const sel = tool === 'select';
    this.stage.draggable(sel);
    this.itemsLayer.listening(sel);
    if (!sel) this.select(null);
    this.container.style.cursor = sel ? '' : 'crosshair';
  }

  private boardPoint(): { x: number; y: number } | null {
    return this.stage.getRelativePointerPosition();
  }

  private bindStage() {
    const st = this.stage;
    st.on('wheel', (e) => {
      e.evt.preventDefault();
      // Roda em cima do item selecionado gira o item; no resto do quadro dá zoom.
      if (this.tool === 'select' && this.selected) {
        const item = this.s.items.get(this.selected);
        const g = this.nodes.get(this.selected);
        if (item && g && this.canDrag(item) && g.isAncestorOf(e.target)) {
          const d = e.evt.deltaY || e.evt.deltaX;
          if (d) this.rotateBy(item.id, g, (d > 0 ? 1 : -1) * (e.evt.shiftKey ? 1 : 15));
          return;
        }
      }
      const old = st.scaleX();
      const p = st.getPointerPosition();
      if (!p) return;
      const m = { x: (p.x - st.x()) / old, y: (p.y - st.y()) / old };
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * Math.exp(-e.evt.deltaY * 0.0015)));
      st.scale({ x: ns, y: ns });
      st.position({ x: p.x - m.x * ns, y: p.y - m.y * ns });
      this.updateDecor();
    });
    st.on('dragmove', (e) => {
      if (e.target === st) this.updateDecor();
    });
    st.on('click tap', (e) => {
      if (this.tool === 'select' && e.target === st) this.select(null);
    });
    st.on('contextmenu', (e) => {
      e.evt.preventDefault();
      if (e.target === st || this.tool !== 'select') {
        this.select(null);
        this.cb.onContext(null, e.evt.clientX, e.evt.clientY);
      }
    });
    st.on('mousedown touchstart', (e) => {
      const p = this.boardPoint();
      if (!p) return;
      const evt = e.evt as MouseEvent;
      if (evt.button === 2) return;
      if (this.tool === 'ping' || (this.tool === 'select' && evt.altKey)) {
        this.s.ping(p.x, p.y);
        return;
      }
      if (this.tool === 'ruler') this.startRuler(p.x, p.y);
      if (this.tool === 'fog') this.startFog(p.x, p.y);
    });
    st.on('mousemove touchmove', () => {
      const p = this.boardPoint();
      if (!p) return;
      this.s.sendCursor(p.x, p.y);
      if (this.gesture) this.moveGesture(p.x, p.y);
    });
    st.on('mouseup touchend', () => this.endGesture());
    st.on('mouseleave', () => this.endGesture());
  }

  private startRuler(x: number, y: number) {
    clearTimeout(this.rulerClear);
    this.myRuler = [x, y, x, y];
    this.gesture = { x, y, pts: this.myRuler, node: new Konva.Group() };
    this.s.sendRuler(this.myRuler);
  }

  private startFog(x: number, y: number) {
    const b = this.fogBrush;
    const color = b.op === 'reveal' ? '#4caf7a' : '#e05252';
    const node =
      b.shape === 'rect'
        ? new Konva.Rect({ x, y, width: 0, height: 0, stroke: color, dash: [8, 6], strokeWidth: 2, fill: color + '22' })
        : new Konva.Line({ points: [x, y], stroke: color + '88', strokeWidth: b.r * 2, lineCap: 'round', lineJoin: 'round' });
    this.overlay.add(node);
    this.gesture = { x, y, pts: [x, y], node };
  }

  private moveGesture(x: number, y: number) {
    const g = this.gesture!;
    if (this.tool === 'ruler') {
      g.pts[2] = x;
      g.pts[3] = y;
      this.s.sendRuler([...g.pts]);
      return;
    }
    if (g.node instanceof Konva.Rect) {
      g.node.position({ x: Math.min(g.x, x), y: Math.min(g.y, y) });
      g.node.size({ width: Math.abs(x - g.x), height: Math.abs(y - g.y) });
    } else if (g.node instanceof Konva.Line) {
      g.pts.push(x, y);
      g.node.points(g.pts);
    }
    this.overlay.batchDraw();
  }

  private endGesture() {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (this.tool === 'ruler') {
      // A régua fica um instante na tela e depois some para todos.
      this.rulerClear = setTimeout(() => {
        this.myRuler = null;
        this.s.sendRuler(null);
      }, 1500);
      return;
    }
    g.node.destroy();
    this.overlay.batchDraw();
    const gm = this.s as unknown as { addFog?: (s: FogShape) => void };
    const b = this.fogBrush;
    if (g.node instanceof Konva.Rect) {
      const w = g.node.width();
      const h = g.node.height();
      if (w > 4 && h > 4) gm.addFog?.({ op: b.op, kind: 'rect', pts: [g.node.x(), g.node.y(), w, h] });
    } else {
      gm.addFog?.({ op: b.op, kind: 'brush', pts: g.pts.length === 2 ? [...g.pts, g.pts[0] + 0.1, g.pts[1]] : g.pts, r: b.r });
    }
  }

  // ---------- visão ----------

  /** Grade decorativa do fundo (CSS) acompanha pan/zoom. */
  private updateDecor() {
    const sc = this.stage.scaleX();
    const size = DECOR_GRID * sc;
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
      onUpdate: () => this.updateDecor(),
      onFinish: () => this.updateDecor(),
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

  // ---------- grid e névoa ----------

  private visibleRect() {
    const sc = this.stage.scaleX();
    const x0 = -this.stage.x() / sc;
    const y0 = -this.stage.y() / sc;
    return { x0, y0, x1: x0 + this.stage.width() / sc, y1: y0 + this.stage.height() / sc, sc };
  }

  private drawGrid(kctx: Konva.Context) {
    const g = this.s.map.grid;
    if (!g.enabled || g.size < 8) return;
    const { x0, y0, x1, y1, sc } = this.visibleRect();
    if ((x1 - x0) / g.size > 300) return; // longe demais: não vale desenhar
    const ctx = kctx._context;
    ctx.save();
    ctx.beginPath();
    if (g.type === 'square') {
      for (let x = Math.floor(x0 / g.size) * g.size; x <= x1; x += g.size) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = Math.floor(y0 / g.size) * g.size; y <= y1; y += g.size) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
    } else {
      const R = g.size / SQRT3;
      const rowH = R * 1.5;
      for (let r = Math.floor(y0 / rowH) - 1; r <= Math.ceil(y1 / rowH) + 1; r++) {
        for (let q = Math.floor(x0 / g.size - r / 2) - 1; q <= Math.ceil(x1 / g.size - r / 2) + 1; q++) {
          const c = hexCenter(q, r, g.size);
          for (let i = 0; i <= 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            const px = c.x + R * Math.cos(a);
            const py = c.y + R * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
      }
    }
    ctx.strokeStyle = g.color;
    ctx.globalAlpha = g.opacity;
    ctx.lineWidth = 1 / sc;
    ctx.stroke();
    ctx.restore();
  }

  /** Redesenha grid e névoa quando as configurações do mapa mudam. */
  syncMap() {
    this.container.classList.toggle('mapgrid', this.s.map.grid.enabled);
    this.itemsLayer.batchDraw();
    const f = this.s.map.fog;
    const key = `${f.enabled}:${f.shapes.length}:${this.s.role}`;
    if (key === this.fogKey) return;
    this.fogKey = key;
    this.fogLayer.destroyChildren();
    if (!f.enabled) return this.fogLayer.batchDraw();
    this.fogLayer.opacity(this.s.role === 'gm' ? 0.45 : 1);
    const full = () => new Konva.Rect({ x: -HUGE, y: -HUGE, width: HUGE * 2, height: HUGE * 2, fill: FOG_COLOR });
    this.fogLayer.add(full());
    for (const sh of f.shapes) {
      const gco = sh.op === 'reveal' ? 'destination-out' : 'source-over';
      let node: Konva.Shape;
      if (sh.kind === 'all') node = full();
      else if (sh.kind === 'rect') node = new Konva.Rect({ x: sh.pts[0], y: sh.pts[1], width: sh.pts[2], height: sh.pts[3], fill: FOG_COLOR });
      else node = new Konva.Line({ points: sh.pts, stroke: FOG_COLOR, strokeWidth: (sh.r ?? 40) * 2, lineCap: 'round', lineJoin: 'round' });
      node.globalCompositeOperation(gco);
      this.fogLayer.add(node);
    }
    this.fogLayer.batchDraw();
  }

  // ---------- itens ----------

  select(id: string | null) {
    this.selected = id;
    const g = id ? this.nodes.get(id) : null;
    const item = id ? this.s.items.get(id) : null;
    if (g && item && this.canDrag(item)) {
      const min = MIN_SIZE[item.type];
      this.tr.boundBoxFunc((oldBox, newBox) => {
        const sc = this.stage.scaleX();
        return Math.abs(newBox.width) < min.w * sc || Math.abs(newBox.height) < min.h * sc ? oldBox : newBox;
      });
      const square = item.type === 'image' || item.type === 'token' || item.type === 'clock';
      this.tr.keepRatio(square);
      this.tr.rotateEnabled(true);
      this.tr.enabledAnchors(
        square
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

  private canDrag(item: BoardItem) {
    return !item.locked && this.s.can('move', item);
  }

  sync() {
    const sorted = [...this.s.items.values()].sort(drawOrder);
    const seen = new Set<string>();
    let gridPlaced = false;
    for (const item of sorted) {
      seen.add(item.id);
      let g = this.nodes.get(item.id);
      if (!g) {
        g = this.create(item);
        this.nodes.set(item.id, g);
        this.itemsLayer.add(g);
      }
      this.update(g, item);
      // O grid fica logo acima da camada do mapa.
      if (!gridPlaced && layerOf(item) !== 'map') {
        this.gridShape.moveToTop();
        gridPlaced = true;
      }
      g.moveToTop();
    }
    if (!gridPlaced) this.gridShape.moveToTop();
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
      if ((e.evt as MouseEvent).altKey) return;
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
      const item = this.s.items.get(id);
      const grid = this.s.map.grid;
      if (item && grid.enabled && grid.snap && layerOf(item) === 'tokens') {
        g.position(snapToGrid(g.x(), g.y(), g.width(), g.height(), grid));
      }
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

  private rotateBy(id: string, g: Konva.Group, deg: number) {
    const r = rotateAroundCenter({ x: g.x(), y: g.y(), w: g.width(), h: g.height(), rotation: g.rotation() }, deg);
    // Enquanto gira, ignora atualizações do próprio item vindas da rede.
    this.transforming = id;
    g.position({ x: r.x, y: r.y });
    g.rotation(r.rotation);
    this.tr.forceUpdate();
    this.itemsLayer.batchDraw();
    this.sendTransform(id, r, false);
    clearTimeout(this.rotTimer);
    this.rotTimer = setTimeout(() => {
      this.transforming = null;
      this.sendTransform(id, { x: g.x(), y: g.y(), rotation: g.rotation() }, true);
    }, 300);
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
    g.draggable(this.canDrag(item));
    if (!busy) {
      g.position({ x: item.x, y: item.y });
      g.rotation(item.rotation);
      this.build(g, item, item.w, item.h);
    }
  }

  private imageFor(hash: string | undefined): HTMLImageElement | 'loading' | 'missing' | undefined {
    if (!hash) return undefined;
    const img = this.images.get(hash);
    if (img === undefined) this.loadImage(hash);
    return img;
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
      if (gm && !item.revealed) g.add(new Konva.Text({ x: w - 30, y: 16, text: '🔒', fontSize: 16 }));
    } else if (item.type === 'image') {
      const img = this.imageFor(item.img);
      if (img instanceof HTMLImageElement) {
        g.add(new Konva.Image({ image: img, width: w, height: h, ...(layerOf(item) === 'map' ? {} : shadow) }));
      } else {
        g.add(new Konva.Rect({ width: w, height: h, fill: '#23262f', stroke: '#3a3f4b', dash: [6, 6], cornerRadius: 6 }));
        g.add(new Konva.Text({
          width: w, height: h, align: 'center', verticalAlign: 'middle', fill: '#8a90a0', fontSize: 15,
          text: img === 'missing' ? 'imagem indisponível' : 'carregando imagem…',
        }));
      }
    } else if (item.type === 'token') {
      this.buildToken(g, item, w, h);
    } else if (item.type === 'clock') {
      this.buildClock(g, item, w, h);
    }

    if (hidden) {
      g.add(new Konva.Label({ x: 0, y: -26 }).add(
        new Konva.Tag({ fill: '#000', opacity: 0.7, cornerRadius: 4 }),
        new Konva.Text({ text: '👁 oculto dos jogadores', fontSize: 12, padding: 5, fill: '#ddd' }),
      ));
    }
    if (gm && item.locked && layerOf(item) !== 'map') {
      g.add(new Konva.Text({ x: 4, y: 4, text: '📌', fontSize: 14 }));
    }
  }

  private buildToken(g: Konva.Group, item: BoardItem, w: number, h: number) {
    const r = Math.min(w, h) / 2;
    const sheet = item.sheetId ? this.s.docs.sheets[item.sheetId] : undefined;
    const ring = item.color ?? (sheet?.perm.owner ? colorFor(sheet.perm.owner) : sheet?.kind === 'npc' ? '#c0392b' : '#d9a75b');
    const ringW = Math.max(3, r * 0.09);
    g.add(new Konva.Circle({ x: r, y: r, radius: r, fill: '#23262f', shadowColor: '#000', shadowBlur: 10, shadowOpacity: 0.5 }));
    const img = this.imageFor(item.img ?? sheet?.avatar);
    if (img instanceof HTMLImageElement) {
      // Cobre o círculo mantendo a proporção da imagem.
      const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
      const iw = img.width * scale;
      const ih = img.height * scale;
      const inner = new Konva.Group({ clipFunc: (ctx) => ctx.arc(r, r, r - ringW / 2, 0, Math.PI * 2) });
      inner.add(new Konva.Image({ image: img, x: r - iw / 2, y: r - ih / 2, width: iw, height: ih }));
      g.add(inner);
    } else {
      const name = item.name ?? sheet?.name ?? '?';
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
      g.add(new Konva.Text({
        width: r * 2, height: r * 2, align: 'center', verticalAlign: 'middle', text: initials,
        fontSize: r * 0.75, fontStyle: 'bold', fill: '#ebe5d8', fontFamily: 'Inter, sans-serif',
      }));
    }
    g.add(new Konva.Circle({ x: r, y: r, radius: r - ringW / 2, stroke: ring, strokeWidth: ringW }));

    // Vida (só se a ficha ligada chegou até este navegador).
    const hp = sheet ? hpOf(sheet, this.s.templateOf(sheet)) : null;
    if (hp && hp.max > 0) {
      const ratio = Math.max(0, Math.min(1, hp.cur / hp.max));
      const color = ratio > 0.5 ? '#4caf7a' : ratio > 0.25 ? '#e0a43a' : '#e05252';
      g.add(new Konva.Rect({ x: 0, y: -10, width: r * 2, height: 6, fill: '#000', opacity: 0.7, cornerRadius: 3 }));
      g.add(new Konva.Rect({ x: 0, y: -10, width: r * 2 * ratio, height: 6, fill: color, cornerRadius: 3 }));
    }

    const label = item.name ?? sheet?.name;
    if (label) {
      const lbl = new Konva.Label({ y: r * 2 + 4 });
      lbl.add(
        new Konva.Tag({ fill: '#000', opacity: 0.65, cornerRadius: 4 }),
        new Konva.Text({ text: label, fontSize: 12, padding: 3, fill: '#fff', fontFamily: 'Inter, sans-serif' }),
      );
      lbl.x(r - lbl.width() / 2);
      g.add(lbl);
    }
    const conds = item.conditions ?? [];
    if (conds.length) {
      const c = new Konva.Label({ y: r * 2 + (label ? 24 : 4) });
      c.add(
        new Konva.Tag({ fill: '#6b1d1d', opacity: 0.9, cornerRadius: 4 }),
        new Konva.Text({ text: conds.join(' · '), fontSize: 11, padding: 3, fill: '#ffe1e1', fontFamily: 'Inter, sans-serif' }),
      );
      c.x(r - c.width() / 2);
      g.add(c);
    }
  }

  /** Relógio de progresso: fatias preenchidas no sentido horário a partir do topo. */
  private buildClock(g: Konva.Group, item: BoardItem, w: number, h: number) {
    const n = Math.max(2, Math.min(24, item.segments ?? 6));
    const filled = Math.max(0, Math.min(n, item.filled ?? 0));
    const r = Math.min(w, h) / 2;
    const color = item.color ?? '#c0392b';
    g.add(new Konva.Circle({ x: r, y: r, radius: r, fill: '#1d2129', shadowColor: '#000', shadowBlur: 12, shadowOpacity: 0.5 }));
    for (let i = 0; i < n; i++) {
      g.add(new Konva.Wedge({
        x: r, y: r, radius: r - 5, angle: 360 / n, rotation: -90 + (i * 360) / n,
        fill: i < filled ? color : '#2a2f3a', stroke: '#0e1014', strokeWidth: 2,
      }));
    }
    g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, stroke: filled === n ? color : '#ebe5d8', strokeWidth: 3 }));
    const lbl = new Konva.Label({ y: r * 2 + 6 });
    lbl.add(
      new Konva.Tag({ fill: '#000', opacity: 0.7, cornerRadius: 4 }),
      new Konva.Text({ text: `${item.title ?? 'Relógio'} · ${filled}/${n}`, fontSize: 13, padding: 4, fill: '#fff', fontFamily: 'Inter, sans-serif' }),
    );
    lbl.x(r - lbl.width() / 2);
    g.add(lbl);
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
      if (!item || this.dragging === id || this.transforming === id) continue;
      const avatar = item.sheetId ? this.s.docs.sheets[item.sheetId]?.avatar : undefined;
      if (item.img === hash || (!item.img && avatar === hash)) this.build(g, item, item.w, item.h);
    }
    this.itemsLayer.batchDraw();
  }

  /** Tenta de novo imagens que falharam (ex.: o mestre voltou). */
  retryImages() {
    for (const [hash, v] of this.images) if (v === 'missing') this.images.delete(hash);
    this.sync();
  }

  // ---------- camada de cima: cursores, réguas e pings ----------

  private tick = () => {
    const now = performance.now();
    const inv = 1 / this.stage.scaleX();
    let changed = false;

    for (const [pid, c] of this.s.cursors) {
      let n = this.cursorNodes.get(pid);
      if (!n) {
        n = this.makeCursor(pid);
        this.cursorNodes.set(pid, n);
        this.overlay.add(n);
      }
      const dx = c.tx - c.x;
      const dy = c.ty - c.y;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
        c.x += dx * 0.35;
        c.y += dy * 0.35;
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

    // Réguas (a minha + as que chegam). Réguas paradas há muito tempo somem.
    const rulers = new Map<string, number[]>();
    if (this.myRuler) rulers.set(this.s.myPid, this.myRuler);
    for (const [pid, r] of this.s.rulers) {
      if (now - r.last > 10000) this.s.rulers.delete(pid);
      else rulers.set(pid, r.pts);
    }
    for (const [pid, pts] of rulers) {
      this.drawRuler(pid, pts, inv);
      changed = true;
    }
    for (const [pid, n] of this.rulerNodes) {
      if (rulers.has(pid)) continue;
      n.destroy();
      this.rulerNodes.delete(pid);
      changed = true;
    }

    // Pings: anel que cresce e some em 1,6 s.
    this.s.pings = this.s.pings.filter((p) => now - p.start < 1600);
    const alive = new Set<object>(this.s.pings);
    for (const p of this.s.pings) {
      let c = this.pingNodes.get(p);
      if (!c) {
        c = new Konva.Circle({ x: p.x, y: p.y, stroke: p.pid === 'gm' ? '#d9a75b' : colorFor(p.pid), strokeWidth: 4 });
        this.pingNodes.set(p, c);
        this.overlay.add(c);
      }
      const t = (now - p.start) / 1600;
      c.radius((10 + 60 * t) * inv);
      c.strokeWidth(4 * inv);
      c.opacity(1 - t);
      changed = true;
    }
    for (const [p, c] of this.pingNodes) {
      if (alive.has(p)) continue;
      c.destroy();
      this.pingNodes.delete(p);
      changed = true;
    }

    if (changed) this.overlay.batchDraw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private drawRuler(pid: string, pts: number[], inv: number) {
    let g = this.rulerNodes.get(pid);
    if (!g) {
      g = new Konva.Group();
      this.rulerNodes.set(pid, g);
      this.overlay.add(g);
    }
    g.destroyChildren();
    const color = pid === 'gm' ? '#d9a75b' : colorFor(pid);
    const [x1, y1, x2, y2] = pts;
    g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: color, strokeWidth: 3 * inv, dash: [10 * inv, 6 * inv], lineCap: 'round' }));
    g.add(new Konva.Circle({ x: x1, y: y1, radius: 5 * inv, fill: color }));
    g.add(new Konva.Circle({ x: x2, y: y2, radius: 5 * inv, fill: color }));
    const grid = this.s.map.grid.enabled ? this.s.map.grid : { ...this.s.map.grid, size: 70 };
    const text = formatDistance(gridDistance(x1, y1, x2, y2, grid), grid);
    const lbl = new Konva.Label({ x: x2 + 12 * inv, y: y2 + 12 * inv, scaleX: inv, scaleY: inv });
    lbl.add(new Konva.Tag({ fill: '#000', opacity: 0.8, cornerRadius: 5 }), new Konva.Text({ text, fontSize: 14, padding: 6, fill: color, fontStyle: 'bold' }));
    g.add(lbl);
  }

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
    clearTimeout(this.rulerClear);
    clearTimeout(this.rotTimer);
    this.ro.disconnect();
    if (this.s.focusHandler) this.s.focusHandler = null;
    this.stage.destroy();
  }
}
