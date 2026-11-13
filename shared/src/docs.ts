// Documentos da campanha (fichas, modelos...), cada um com suas permissões.
// Ficam em pastas próprias na pasta do mestre e são sincronizados um a um.
import { can, type Actor, type Perm } from './permissions';
import { DEFAULT_ATTRIBUTES, type AttributeDef, type Sheet, type SheetTemplate } from './sheets';
import { CONDITIONS } from './map';
import type { JournalEntry, WikiPage } from './notes';
import type { RandomTable } from './tables';

export interface DocMap {
  templates: SheetTemplate;
  sheets: Sheet;
  journal: JournalEntry;
  wiki: WikiPage;
  tables: RandomTable;
}

export type Collection = keyof DocMap;
export type AnyDoc = DocMap[Collection];

export const COLLECTIONS: Collection[] = ['templates', 'sheets', 'journal', 'wiki', 'tables'];

/** Pasta de cada coleção dentro da pasta da campanha. */
export const COLLECTION_DIRS: Record<Collection, string> = {
  templates: 'modelos',
  sheets: 'fichas',
  journal: 'diario',
  wiki: 'wiki',
  tables: 'tabelas',
};

export interface TableSettings {
  /** Jogadores podem criar a própria ficha. */
  allowPlayerSheets: boolean;
  /** Atributos que existem nesta campanha (o mestre define; os modelos escolhem quais usar). */
  attributes: AttributeDef[];
  /** Condições que os tokens podem ter (o mestre edita para o sistema dele). */
  conditions: string[];
  /** Ordem da iniciativa: maior primeiro (desc) ou menor primeiro (asc). */
  initiativeOrder: 'desc' | 'asc';
}

export const DEFAULT_SETTINGS: TableSettings = {
  allowPlayerSheets: true,
  attributes: DEFAULT_ATTRIBUTES,
  conditions: CONDITIONS,
  initiativeOrder: 'desc',
};

export function docForPlayer<T extends { perm: Perm }>(doc: T, actor: Actor): T | null {
  return can(actor, 'view', doc) ? doc : null;
}

export const SHEET_PERM = (owner?: string): Perm =>
  owner ? { view: 'owner', move: 'gm', edit: 'owner', owner } : { view: 'gm', move: 'gm', edit: 'gm' };

export const TEMPLATE_PERM: Perm = { view: 'all', move: 'gm', edit: 'gm' };
