// Modelo de permissões compartilhado entre o mestre (autoridade) e o jogador (só para a interface).

/** Quem pode: todos, só o mestre, o dono do objeto, ou uma lista de jogadores. */
export type Who = 'all' | 'gm' | 'owner' | string[];

export interface Perm {
  view: Who;
  move: Who;
  edit: Who;
  owner?: string;
}

export type Action = 'view' | 'move' | 'edit';

export interface Actor {
  role: 'gm' | 'player';
  pid: string;
}

export interface WithPerm {
  perm: Perm;
}

export const DEFAULT_ITEM_PERM: Perm = { view: 'all', move: 'gm', edit: 'gm' };

function allows(who: Who, pid: string, owner?: string): boolean {
  if (who === 'all') return true;
  if (who === 'gm') return false;
  if (who === 'owner') return !!owner && owner === pid;
  return who.includes(pid);
}

/** O mestre pode tudo. Mover/editar exige também poder ver. */
export function can(actor: Actor, action: Action, obj: WithPerm): boolean {
  if (actor.role === 'gm') return true;
  const p = obj.perm;
  if (!allows(p.view, actor.pid, p.owner)) return false;
  if (action === 'view') return true;
  return allows(p[action], actor.pid, p.owner);
}

export function isHiddenFromPlayers(obj: WithPerm): boolean {
  return obj.perm.view === 'gm' || (Array.isArray(obj.perm.view) && obj.perm.view.length === 0);
}

export function describeWho(who: Who, names: (pid: string) => string): string {
  if (who === 'all') return 'Todos';
  if (who === 'gm') return 'Só o mestre';
  if (who === 'owner') return 'Dono';
  if (who.length === 0) return 'Só o mestre';
  return who.map(names).join(', ');
}
