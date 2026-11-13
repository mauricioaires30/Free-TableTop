// Documentos da campanha (fichas, modelos...), cada um com suas permissões.
// Ficam em pastas próprias na pasta do mestre e são sincronizados um a um.
import { can, type Actor, type Perm } from './permissions';
import type { Sheet, SheetTemplate } from './sheets';

export interface DocMap {
  templates: SheetTemplate;
  sheets: Sheet;
}

export type Collection = keyof DocMap;
export type AnyDoc = DocMap[Collection];

export const COLLECTIONS: Collection[] = ['templates', 'sheets'];

/** Pasta de cada coleção dentro da pasta da campanha. */
export const COLLECTION_DIRS: Record<Collection, string> = {
  templates: 'modelos',
  sheets: 'fichas',
};

export interface TableSettings {
  /** Jogadores podem criar a própria ficha. */
  allowPlayerSheets: boolean;
}

export const DEFAULT_SETTINGS: TableSettings = { allowPlayerSheets: true };

export function docForPlayer<T extends { perm: Perm }>(doc: T, actor: Actor): T | null {
  return can(actor, 'view', doc) ? doc : null;
}

export const SHEET_PERM = (owner?: string): Perm =>
  owner ? { view: 'owner', move: 'gm', edit: 'owner', owner } : { view: 'gm', move: 'gm', edit: 'gm' };

export const TEMPLATE_PERM: Perm = { view: 'all', move: 'gm', edit: 'gm' };
