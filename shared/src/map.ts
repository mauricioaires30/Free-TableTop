// Mapa: grid (quadrado ou hexagonal), névoa de guerra e medição de distância.

export interface GridSettings {
  enabled: boolean;
  type: 'square' | 'hex';
  /** Tamanho da célula em pixels do quadro. */
  size: number;
  /** Tokens grudam no grid ao soltar. */
  snap: boolean;
  /** Quanto vale uma célula (ex.: 1,5) e em que unidade (ex.: "m"). */
  unit: number;
  unitLabel: string;
  color: string;
  opacity: number;
}

export interface FogShape {
  op: 'reveal' | 'hide';
  kind: 'rect' | 'brush' | 'all';
  /** rect: [x, y, w, h]; brush: [x1, y1, x2, y2, ...]. */
  pts: number[];
  /** Raio do pincel. */
  r?: number;
}

export interface FogSettings {
  enabled: boolean;
  shapes: FogShape[];
}

export interface MapSettings {
  grid: GridSettings;
  fog: FogSettings;
}

export const DEFAULT_MAP: MapSettings = {
  grid: { enabled: false, type: 'square', size: 70, snap: true, unit: 1.5, unitLabel: 'm', color: '#ffffff', opacity: 0.18 },
  fog: { enabled: false, shapes: [] },
};

const SQRT3 = Math.sqrt(3);

/** Centro do hexágono (pontudo em cima) mais próximo de (x, y). */
function hexRound(x: number, y: number, size: number): { q: number; r: number } {
  // size = largura do hexágono; raio = size / √3
  const radius = size / SQRT3;
  const q = ((SQRT3 / 3) * x - (1 / 3) * y) / radius;
  const r = ((2 / 3) * y) / radius;
  let rx = Math.round(q);
  let rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - (-q - r));
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (!(dy > dz)) rz = -rx - ry;
  return { q: rx, r: rz };
}

export function hexCenter(q: number, r: number, size: number): { x: number; y: number } {
  const radius = size / SQRT3;
  return { x: radius * SQRT3 * (q + r / 2), y: radius * 1.5 * r };
}

/**
 * Ajusta a posição (canto superior esquerdo) de um item de largura w ao grid.
 * Quadrado: alinha às linhas. Hexagonal: centraliza no hexágono mais próximo.
 */
export function snapToGrid(x: number, y: number, w: number, h: number, g: GridSettings): { x: number; y: number } {
  if (g.type === 'square') {
    return { x: Math.round(x / g.size) * g.size, y: Math.round(y / g.size) * g.size };
  }
  const { q, r } = hexRound(x + w / 2, y + h / 2, g.size);
  const c = hexCenter(q, r, g.size);
  return { x: c.x - w / 2, y: c.y - h / 2 };
}

/** Distância em células: quadrado conta diagonal como 1; hex usa a distância hexagonal. */
export function gridDistance(x1: number, y1: number, x2: number, y2: number, g: GridSettings): number {
  if (g.type === 'square') {
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / g.size;
  }
  const a = hexRound(x1, y1, g.size);
  const b = hexRound(x2, y2, g.size);
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function formatDistance(cells: number, g: GridSettings): string {
  // Com grid ligado conta células inteiras; sem grid mostra uma casa decimal.
  const c = g.type === 'hex' || g.enabled ? Math.round(cells) : Math.round(cells * 10) / 10;
  const total = Math.round(c * g.unit * 10) / 10;
  const n = (v: number) => String(v).replace('.', ',');
  const word = g.type === 'hex' ? 'hex' : c === 1 ? 'quadrado' : 'quadrados';
  return `${n(c)} ${word}${g.unit ? ` · ${n(total)} ${g.unitLabel}` : ''}`;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInFogShape(s: FogShape, x: number, y: number): boolean {
  if (s.kind === 'all') return true;
  if (s.kind === 'rect') {
    const [rx, ry, rw, rh] = s.pts;
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }
  const r = s.r ?? 40;
  for (let i = 0; i + 3 < s.pts.length; i += 2) {
    if (distToSegment(x, y, s.pts[i], s.pts[i + 1], s.pts[i + 2], s.pts[i + 3]) <= r) return true;
  }
  return false;
}

/**
 * Se a névoa cobre este ponto (pra quem não é o mestre). Usado para bloquear
 * cliques em itens escondidos pela névoa, não só escondê-los visualmente.
 */
export function fogCovers(fog: FogSettings, x: number, y: number): boolean {
  if (!fog.enabled) return false;
  let covered = true;
  for (const s of fog.shapes) {
    if (pointInFogShape(s, x, y)) covered = s.op === 'hide';
  }
  return covered;
}

/** Descarta tudo o que veio antes de um "revelar/cobrir tudo" (não muda o resultado). */
export function compactFog(shapes: FogShape[]): FogShape[] {
  let last = -1;
  shapes.forEach((s, i) => {
    if (s.kind === 'all') last = i;
  });
  return last > 0 ? shapes.slice(last) : shapes;
}

/** Reduz pontos de um pincel: só guarda pontos a pelo menos `min` de distância. */
export function simplifyStroke(pts: number[], min: number): number[] {
  if (pts.length <= 4) return pts;
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const dx = pts[i] - out[out.length - 2];
    const dy = pts[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= min * min || i >= pts.length - 2) out.push(pts[i], pts[i + 1]);
  }
  return out;
}

export function isFogShape(x: unknown): x is FogShape {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as FogShape;
  if (s.op !== 'reveal' && s.op !== 'hide') return false;
  if (!['rect', 'brush', 'all'].includes(s.kind)) return false;
  if (!Array.isArray(s.pts) || s.pts.length > 4000 || !s.pts.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (s.kind === 'rect' && s.pts.length !== 4) return false;
  if (s.r !== undefined && (typeof s.r !== 'number' || s.r <= 0 || s.r > 2000)) return false;
  return true;
}

export const CONDITIONS = [
  'Caído', 'Agarrado', 'Atordoado', 'Cego', 'Envenenado', 'Paralisado',
  'Amedrontado', 'Invisível', 'Sangrando', 'Inconsciente', 'Concentrando', 'Abençoado',
];
