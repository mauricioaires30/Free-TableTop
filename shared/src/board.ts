import type { Perm } from './permissions';
import { can, type Actor } from './permissions';

export type ItemType = 'image' | 'note' | 'card' | 'token' | 'clock';

/** Camadas do quadro, de baixo para cima. */
export type Layer = 'map' | 'objects' | 'tokens';
export const LAYERS: Layer[] = ['map', 'objects', 'tokens'];
export const LAYER_LABELS: Record<Layer, string> = { map: 'Mapa (fundo)', objects: 'Objetos', tokens: 'Tokens' };

export interface BoardItem {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  perm: Perm;
  /** image: hash da imagem (arquivo imagens/<hash>.webp na pasta do mestre). */
  img?: string;
  /** note: texto livre. */
  text?: string;
  /** note/card: cor de fundo. */
  color?: string;
  /** card: título, frente, verso e se o verso já foi revelado. */
  title?: string;
  front?: string;
  back?: string;
  revealed?: boolean;
  /** Camada (padrão: tokens para tokens, objetos para o resto). */
  layer?: Layer;
  /** Travado: ninguém arrasta (útil para o mapa de fundo). */
  locked?: boolean;
  /** token: nome, ficha ligada e condições. */
  name?: string;
  sheetId?: string;
  conditions?: string[];
  /** clock: relógio de progresso com N fatias, `filled` preenchidas. */
  segments?: number;
  filled?: number;
}

/**
 * Gira um item em torno do próprio centro. O Konva gira pelo canto superior
 * esquerdo, então a posição é corrigida para o centro não sair do lugar.
 */
export function rotateAroundCenter(
  item: Pick<BoardItem, 'x' | 'y' | 'w' | 'h' | 'rotation'>,
  deg: number,
): { x: number; y: number; rotation: number } {
  const rad = (a: number) => (a * Math.PI) / 180;
  const off = (a: number) => {
    const c = Math.cos(rad(a));
    const s = Math.sin(rad(a));
    return { x: (item.w / 2) * c - (item.h / 2) * s, y: (item.w / 2) * s + (item.h / 2) * c };
  };
  const o1 = off(item.rotation);
  const cx = item.x + o1.x;
  const cy = item.y + o1.y;
  const rotation = (((item.rotation + deg) % 360) + 360) % 360;
  const o2 = off(rotation);
  return { x: cx - o2.x, y: cy - o2.y, rotation };
}

export function layerOf(item: BoardItem): Layer {
  return item.layer ?? (item.type === 'token' ? 'tokens' : 'objects');
}

/** Ordem de desenho: camada primeiro, depois z. */
export function drawOrder(a: BoardItem, b: BoardItem): number {
  return LAYERS.indexOf(layerOf(a)) - LAYERS.indexOf(layerOf(b)) || a.z - b.z;
}

/** Campos que o jogador pode alterar via "edit" (o resto só o mestre). */
export const PLAYER_EDITABLE_FIELDS = ['text', 'title', 'front', 'color', 'name', 'conditions', 'filled'] as const;
export const TRANSFORM_FIELDS = ['x', 'y', 'w', 'h', 'rotation'] as const;

export type TransformPatch = Partial<Pick<BoardItem, (typeof TRANSFORM_FIELDS)[number]>>;
export type EditPatch = Partial<Pick<BoardItem, (typeof PLAYER_EDITABLE_FIELDS)[number]>>;

/**
 * Versão do item que um jogador pode receber. Retorna null se ele não pode ver.
 * O verso de uma carta só é enviado depois de revelado.
 */
export function itemForPlayer(item: BoardItem, actor: Actor): BoardItem | null {
  if (!can(actor, 'view', item)) return null;
  if (actor.role === 'gm') return item;
  const copy: BoardItem = { ...item };
  if (copy.type === 'card' && !copy.revealed) delete copy.back;
  return copy;
}
