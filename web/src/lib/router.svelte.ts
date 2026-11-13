// Roteador por hash (funciona no GitHub Pages sem configuração de servidor).
import type { GmSession } from './session/gm.svelte';

export type Route =
  | { name: 'home' }
  | { name: 'gm'; roomId: string }
  | { name: 'player'; roomId: string; invite: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  if (parts[0] === 'mestre' && parts[1]) return { name: 'gm', roomId: parts[1] };
  if (parts[0] === 'sala' && parts[1]) return { name: 'player', roomId: parts[1], invite: q.get('c') ?? '' };
  return { name: 'home' };
}

export const router = $state({ route: parse() });
window.addEventListener('hashchange', () => (router.route = parse()));

export function go(hash: string) {
  location.hash = hash;
}

/** Sessão do mestre aberta pela tela inicial (não sobrevive a recarregar a página). */
export const active: { gm: GmSession | null } = { gm: null };

/** Extrai sala e convite de um link colado. */
export function parseInviteLink(link: string): { roomId: string; invite: string } | null {
  const m = /#\/sala\/([a-z0-9]+)\?c=([^&\s]+)/.exec(link.trim());
  return m ? { roomId: m[1], invite: decodeURIComponent(m[2]) } : null;
}
