// Rastreador de iniciativa.
import { can, type Actor } from './permissions';
import type { Sheet } from './sheets';

export interface CombatEntry {
  id: string;
  name: string;
  init: number;
  sheetId?: string;
  /** Oculto dos jogadores (ex.: emboscada). */
  hidden?: boolean;
}

export interface Combat {
  active: boolean;
  round: number;
  /** id da entrada que está no turno. */
  current?: string;
  entries: CombatEntry[];
}

export const EMPTY_COMBAT: Combat = { active: false, round: 1, entries: [] };

/** Maior iniciativa primeiro; empate mantém a ordem de entrada. */
export function sortEntries(entries: CombatEntry[]): CombatEntry[] {
  return entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.init - a.e.init || a.i - b.i).map((x) => x.e);
}

/** Avança (ou volta) o turno, contando rodadas. */
export function stepTurn(c: Combat, dir: 1 | -1): Combat {
  const list = c.entries;
  if (!list.length) return c;
  const idx = list.findIndex((e) => e.id === c.current);
  let next = idx + dir;
  let round = c.round;
  if (idx === -1) next = dir === 1 ? 0 : list.length - 1;
  else if (next >= list.length) {
    next = 0;
    round++;
  } else if (next < 0) {
    next = list.length - 1;
    round = Math.max(1, round - 1);
  }
  return { ...c, round, current: list[next].id };
}

/** O que o jogador vê: sem entradas ocultas; se o turno é de alguém oculto, não revela quem. */
export function combatForPlayer(c: Combat, actor: Actor, sheets: Record<string, Sheet>): Combat {
  if (actor.role === 'gm') return c;
  const entries = c.entries
    .filter((e) => !e.hidden)
    .map((e) => {
      const s = e.sheetId ? sheets[e.sheetId] : undefined;
      // Não vaza o id de fichas que o jogador não pode ver.
      return s && can(actor, 'view', s) ? e : { ...e, sheetId: undefined };
    });
  const current = entries.some((e) => e.id === c.current) ? c.current : undefined;
  return { ...c, entries, current };
}
