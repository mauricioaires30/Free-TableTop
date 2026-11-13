import type { Perm } from './permissions';
import { can, type Actor } from './permissions';

export type ItemType = 'image' | 'note' | 'card';

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
}

/** Campos que o jogador pode alterar via "edit" (o resto só o mestre). */
export const PLAYER_EDITABLE_FIELDS = ['text', 'title', 'front', 'color'] as const;
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
