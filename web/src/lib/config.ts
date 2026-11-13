import { newPlayerId, PLAYER_ID_RE } from '@ftt/shared';

/** Relay na Cloudflare. Em desenvolvimento, o `wrangler dev` roda em localhost:8787. */
export const RELAY_URL = (import.meta.env.VITE_RELAY_URL || 'ws://127.0.0.1:8787').replace(/\/$/, '');

export function roomSocketUrl(roomId: string) {
  return `${RELAY_URL}/room/${roomId}`;
}

export function inviteUrl(roomId: string, invite: string) {
  return `${location.origin}${import.meta.env.BASE_URL}#/sala/${roomId}?c=${encodeURIComponent(invite)}`;
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* modo privado */
  }
}

/** ID estável do jogador neste navegador: as permissões do mestre ficam ligadas a ele. */
export function myPlayerId(): string {
  let id = safeGet('ftt:pid');
  if (!id || !PLAYER_ID_RE.test(id)) {
    id = newPlayerId();
    safeSet('ftt:pid', id);
  }
  return id;
}

export const savedName = () => safeGet('ftt:name') ?? '';
export const saveName = (n: string) => safeSet('ftt:name', n);
