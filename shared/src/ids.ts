// Gera IDs aleatórios legíveis (sem caracteres confundíveis como 0/o, 1/l).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function randomId(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** IDs de sala: 20 caracteres (~100 bits), impossível de adivinhar. */
export const newRoomId = () => randomId(20);
/** Segredo do mestre: nunca sai da pasta do mestre (o relay guarda só o hash). */
export const newGmKey = () => randomId(40);
/** Token do link de convite. */
export const newInvite = () => randomId(16);
/** ID estável de cada jogador, salvo no navegador dele. */
export const newPlayerId = () => randomId(14);
export const newItemId = () => randomId(12);

export const ROOM_ID_RE = /^[a-z0-9]{12,40}$/;
export const PLAYER_ID_RE = /^[a-z0-9]{8,40}$/;

const CURSOR_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
  '#9a6324', '#fffac8', '#aaffc3', '#ffd8b1',
];

/** Cor determinística por jogador (a mesma em todos os navegadores). */
export function colorFor(pid: string): string {
  let h = 0;
  for (let i = 0; i < pid.length; i++) h = (h * 31 + pid.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}
