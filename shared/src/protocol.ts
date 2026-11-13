// Mensagens trocadas entre navegadores e o relay (Cloudflare Durable Object).
import type { BoardItem, EditPatch, TransformPatch } from './board';
import type { RollResult } from './dice';
import type { FilterConfig } from './filter';
import { PLAYER_EDITABLE_FIELDS, TRANSFORM_FIELDS } from './board';
import type { Combat } from './combat';
import type { AnyDoc, Collection, TableSettings } from './docs';
import type { FieldValue } from './sheets';
import type { FogShape, MapSettings } from './map';

export const PROTOCOL_VERSION = 1;
/** Tamanho máximo de uma mensagem WebSocket aceita pelo relay. */
export const MAX_MESSAGE_BYTES = 600_000;
/** Pedaço de imagem (bytes brutos) por mensagem; em base64 fica ~256 KB. */
export const IMAGE_CHUNK_BYTES = 192 * 1024;

export interface Peer {
  pid: string;
  name: string;
}

// ---------- Nível relay ----------

export type ClientToRelay =
  | { t: 'auth'; role: 'gm'; key: string; invite: string; v: number }
  | { t: 'auth'; role: 'player'; invite: string; pid: string; name: string; v: number }
  | { t: 'cursor'; x: number; y: number }
  | { t: 'gm'; d: PlayerIntent }
  | { t: 'send'; to: string; d: GmMessage }
  | { t: 'setInvite'; invite: string }
  | { t: 'kick'; pid: string }
  | { t: 'unban'; pid: string }
  | { t: 'ping' };

export type RelayErrorCode =
  | 'bad_auth' | 'bad_invite' | 'banned' | 'wrong_gm_key' | 'replaced' | 'kicked'
  | 'too_big' | 'rate_limited' | 'bad_version' | 'bad_message';

export type RelayToClient =
  | { t: 'welcome'; role: 'gm' | 'player'; pid: string; gmOnline: boolean; peers: Peer[] }
  | { t: 'presence'; gmOnline: boolean; peers: Peer[] }
  | { t: 'from'; pid: string; d: PlayerIntent }
  | { t: 'gm'; d: GmMessage }
  | { t: 'cursor'; pid: string; x: number; y: number }
  | { t: 'error'; code: RelayErrorCode; message: string }
  | { t: 'pong' };

// ---------- Nível aplicação (dentro do relay) ----------

export interface RosterEntry {
  name: string;
  muted?: boolean;
  banned?: boolean;
}
export type Roster = Record<string, RosterEntry>;

export interface LogEntry {
  id: string;
  ts: number;
  /** 'gm' ou o pid do jogador. */
  from: string;
  name: string;
  kind: 'chat' | 'roll' | 'system' | 'table';
  text?: string;
  roll?: RollResult;
  /** O que foi rolado, ex.: "Força" ou "Iniciativa". */
  label?: string;
  /** undefined = todos veem. Lista = só o mestre, o autor e esses jogadores veem. */
  to?: string[];
  censored?: boolean;
}

export function logVisibleTo(entry: LogEntry, pid: string): boolean {
  return !entry.to || entry.from === pid || entry.to.includes(pid);
}

/** Jogador → mestre (sempre validado pelo mestre). */
export type PlayerIntent =
  | { k: 'sync' }
  | { k: 'chat'; text: string }
  | { k: 'roll'; expr: string; priv: boolean; label?: string }
  | { k: 'transform'; id: string; patch: TransformPatch; final: boolean }
  | { k: 'edit'; id: string; patch: EditPatch }
  | { k: 'z'; id: string; dir: 'front' | 'back' }
  | { k: 'img'; hash: string }
  | { k: 'sheetNew'; templateId: string; name: string }
  | { k: 'sheetSet'; id: string; values: Record<string, FieldValue>; name?: string }
  | { k: 'sheetRoll'; id: string; field: string; priv: boolean }
  | { k: 'initRoll'; sheetId: string }
  | { k: 'ruler'; pts: number[] | null }
  | { k: 'ping'; x: number; y: number }
  | { k: 'docEdit'; col: 'journal' | 'wiki'; id: string; patch: { title?: string; text?: string } }
  | { k: 'tableRoll'; id: string; priv: boolean }
  | { k: 'avatar'; sheetId: string; i: number; n: number; data: string };

/** Mestre → jogador (já filtrado pelo que o jogador pode ver). */
export type GmMessage =
  | {
      k: 'snapshot'; campaign: string; items: BoardItem[]; log: LogEntry[]; roster: Roster; filter: FilterConfig;
      combat: Combat; settings: TableSettings; map: MapSettings;
    }
  | { k: 'item'; item: BoardItem }
  | { k: 'remove'; id: string }
  | { k: 'log'; entry: LogEntry }
  | { k: 'roster'; roster: Roster }
  | { k: 'filter'; filter: FilterConfig }
  | { k: 'imgChunk'; hash: string; i: number; n: number; mime: string; data: string }
  | { k: 'imgMissing'; hash: string }
  | { k: 'focus'; x: number; y: number; scale: number }
  | { k: 'notice'; text: string }
  | { k: 'doc'; col: Collection; doc: AnyDoc }
  | { k: 'docRemove'; col: Collection; id: string }
  | { k: 'combat'; combat: Combat }
  | { k: 'settings'; settings: TableSettings }
  | { k: 'map'; map: MapSettings }
  | { k: 'fogAdd'; shape: FogShape }
  | { k: 'ruler'; pid: string; pts: number[] | null }
  | { k: 'ping'; pid: string; x: number; y: number };

// ---------- Validação (o mestre nunca confia no jogador) ----------

export const MAX_CHAT_LENGTH = 1000;
export const MAX_TEXT_FIELD = 4000;
const ID_RE = /^[a-z0-9]{4,64}$/;
const HASH_RE = /^[a-f0-9]{16,64}$/;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e7;
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;

export function parsePlayerIntent(x: unknown): PlayerIntent | null {
  if (!isObj(x) || typeof x.k !== 'string') return null;
  switch (x.k) {
    case 'sync':
      return { k: 'sync' };
    case 'chat':
      return isStr(x.text, MAX_CHAT_LENGTH) && x.text.trim() ? { k: 'chat', text: x.text } : null;
    case 'roll':
      if (!isStr(x.expr, 100)) return null;
      return { k: 'roll', expr: x.expr, priv: x.priv === true, ...(isStr(x.label, 80) && x.label ? { label: x.label } : {}) };
    case 'transform': {
      if (!isStr(x.id, 64) || !ID_RE.test(x.id) || !isObj(x.patch)) return null;
      const patch: TransformPatch = {};
      for (const f of TRANSFORM_FIELDS) {
        const v = x.patch[f];
        if (v === undefined) continue;
        if (!isNum(v)) return null;
        if ((f === 'w' || f === 'h') && (v < 10 || v > 10000)) return null;
        patch[f] = v;
      }
      return { k: 'transform', id: x.id, patch, final: x.final === true };
    }
    case 'edit': {
      if (!isStr(x.id, 64) || !ID_RE.test(x.id) || !isObj(x.patch)) return null;
      const patch: EditPatch = {};
      for (const f of PLAYER_EDITABLE_FIELDS) {
        const v = x.patch[f];
        if (v === undefined) continue;
        if (f === 'filled') {
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 24) return null;
          patch.filled = v;
          continue;
        }
        if (f === 'conditions') {
          if (!Array.isArray(v) || v.length > 12 || !v.every((c) => isStr(c, 24))) return null;
          patch.conditions = v as string[];
          continue;
        }
        if (!isStr(v, f === 'color' ? 20 : f === 'name' ? 40 : MAX_TEXT_FIELD)) return null;
        if (f === 'color' && !/^#[0-9a-f]{6}$/i.test(v)) return null;
        patch[f] = v;
      }
      return { k: 'edit', id: x.id, patch };
    }
    case 'z':
      return isStr(x.id, 64) && ID_RE.test(x.id) && (x.dir === 'front' || x.dir === 'back')
        ? { k: 'z', id: x.id, dir: x.dir }
        : null;
    case 'img':
      return isStr(x.hash, 64) && HASH_RE.test(x.hash) ? { k: 'img', hash: x.hash } : null;
    case 'sheetNew':
      return isStr(x.templateId, 64) && ID_RE.test(x.templateId) && isStr(x.name, 60) && x.name.trim()
        ? { k: 'sheetNew', templateId: x.templateId, name: x.name.trim() }
        : null;
    case 'sheetSet':
      // Os valores são conferidos com o modelo da ficha pelo mestre (sanitizeValues).
      if (!isStr(x.id, 64) || !ID_RE.test(x.id) || !isObj(x.values)) return null;
      if (x.name !== undefined && (!isStr(x.name, 60) || !x.name.trim())) return null;
      return { k: 'sheetSet', id: x.id, values: x.values as Record<string, FieldValue>, ...(x.name ? { name: x.name.trim() } : {}) };
    case 'sheetRoll':
      return isStr(x.id, 64) && ID_RE.test(x.id) && isStr(x.field, 30)
        ? { k: 'sheetRoll', id: x.id, field: x.field, priv: x.priv === true }
        : null;
    case 'initRoll':
      return isStr(x.sheetId, 64) && ID_RE.test(x.sheetId) ? { k: 'initRoll', sheetId: x.sheetId } : null;
    case 'ruler':
      if (x.pts === null) return { k: 'ruler', pts: null };
      return Array.isArray(x.pts) && x.pts.length >= 4 && x.pts.length <= 40 && x.pts.length % 2 === 0 && x.pts.every(isNum)
        ? { k: 'ruler', pts: x.pts as number[] }
        : null;
    case 'ping':
      return isNum(x.x) && isNum(x.y) ? { k: 'ping', x: x.x, y: x.y } : null;
    case 'docEdit': {
      if ((x.col !== 'journal' && x.col !== 'wiki') || !isStr(x.id, 64) || !ID_RE.test(x.id) || !isObj(x.patch)) return null;
      const patch: { title?: string; text?: string } = {};
      if (x.patch.title !== undefined) {
        if (!isStr(x.patch.title, 120)) return null;
        patch.title = x.patch.title;
      }
      if (x.patch.text !== undefined) {
        if (!isStr(x.patch.text, 50_000)) return null;
        patch.text = x.patch.text;
      }
      return { k: 'docEdit', col: x.col, id: x.id, patch };
    }
    case 'avatar': {
      const n = x.n;
      const i = x.i;
      if (!isStr(x.sheetId, 64) || !ID_RE.test(x.sheetId)) return null;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 4) return null;
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= n) return null;
      if (!isStr(x.data, 270_000) || !/^[A-Za-z0-9+/=]+$/.test(x.data)) return null;
      return { k: 'avatar', sheetId: x.sheetId, i, n, data: x.data };
    }
    case 'tableRoll':
      return isStr(x.id, 64) && ID_RE.test(x.id) ? { k: 'tableRoll', id: x.id, priv: x.priv === true } : null;
  }
  return null;
}
