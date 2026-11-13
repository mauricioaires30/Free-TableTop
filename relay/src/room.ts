import { DurableObject } from 'cloudflare:workers';
import {
  MAX_MESSAGE_BYTES,
  PLAYER_ID_RE,
  PROTOCOL_VERSION,
  type ClientToRelay,
  type Peer,
  type RelayErrorCode,
  type RelayToClient,
} from '@ftt/shared';
import type { Env } from './index';

interface Attachment {
  authed: boolean;
  role?: 'gm' | 'player';
  pid?: string;
  name?: string;
}

/** Único estado guardado pelo relay. Nada de campanha, chat ou imagens. */
interface Meta {
  gmKeyHash?: string;
  invite?: string;
  banned: string[];
}

/** Erros que encerram a conexão sem nova tentativa automática. */
const CLOSE_CODES: Record<RelayErrorCode, number> = {
  bad_auth: 4001, bad_invite: 4002, banned: 4003, wrong_gm_key: 4004, replaced: 4005,
  kicked: 4006, too_big: 4007, rate_limited: 4008, bad_version: 4009, bad_message: 4010,
};

const MESSAGES: Record<RelayErrorCode, string> = {
  bad_auth: 'Autenticação inválida.',
  bad_invite: 'Convite inválido ou expirado. Peça um link novo ao mestre.',
  banned: 'Você foi removido desta mesa.',
  wrong_gm_key: 'Esta sala pertence a outra campanha.',
  replaced: 'Você abriu a mesa em outra aba.',
  kicked: 'O mestre removeu você da mesa.',
  too_big: 'Mensagem grande demais.',
  rate_limited: 'Mensagens demais em pouco tempo.',
  bad_version: 'Versão do site desatualizada. Recarregue a página.',
  bad_message: 'Mensagem inválida.',
};

/** Salas sem o mestre por 180 dias têm os metadados apagados. */
const EXPIRY_MS = 180 * 24 * 60 * 60 * 1000;
const PLAYER_RATE = { perSecond: 40, burst: 120 };

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isStr = (x: unknown, min: number, max: number): x is string =>
  typeof x === 'string' && x.length >= min && x.length <= max;

export class Room extends DurableObject<Env> {
  private meta: Meta | null = null;
  private buckets = new WeakMap<WebSocket, { tokens: number; last: number }>();

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ authed: false } satisfies Attachment);
    setTimeout(() => {
      const att = this.att(server);
      if (!att?.authed) this.fail(server, 'bad_auth');
    }, 10_000);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- helpers ----------

  private async loadMeta(): Promise<Meta> {
    if (!this.meta) this.meta = (await this.ctx.storage.get<Meta>('meta')) ?? { banned: [] };
    return this.meta;
  }

  private async saveMeta() {
    if (this.meta) await this.ctx.storage.put('meta', this.meta);
  }

  private att(ws: WebSocket): Attachment | null {
    try {
      return ws.deserializeAttachment() as Attachment;
    } catch {
      return null;
    }
  }

  private sockets(except?: WebSocket): Array<{ ws: WebSocket; att: Attachment }> {
    const out: Array<{ ws: WebSocket; att: Attachment }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
      const att = this.att(ws);
      if (att?.authed) out.push({ ws, att });
    }
    return out;
  }

  private send(ws: WebSocket, msg: RelayToClient | string) {
    try {
      ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } catch {
      /* socket já fechado */
    }
  }

  private fail(ws: WebSocket, code: RelayErrorCode) {
    this.send(ws, { t: 'error', code, message: MESSAGES[code] });
    try {
      ws.close(CLOSE_CODES[code], code);
    } catch {
      /* ignore */
    }
  }

  private presence(except?: WebSocket): { gmOnline: boolean; peers: Peer[] } {
    const peers = new Map<string, Peer>();
    let gmOnline = false;
    for (const { att } of this.sockets(except)) {
      if (att.role === 'gm') gmOnline = true;
      else if (att.pid) peers.set(att.pid, { pid: att.pid, name: att.name ?? '?' });
    }
    return { gmOnline, peers: [...peers.values()] };
  }

  private broadcastPresence(except?: WebSocket) {
    const p = this.presence(except);
    const msg = JSON.stringify({ t: 'presence', ...p } satisfies RelayToClient);
    for (const { ws } of this.sockets(except)) this.send(ws, msg);
  }

  private rateOk(ws: WebSocket): boolean {
    const now = Date.now();
    const b = this.buckets.get(ws) ?? { tokens: PLAYER_RATE.burst, last: now };
    b.tokens = Math.min(PLAYER_RATE.burst, b.tokens + ((now - b.last) / 1000) * PLAYER_RATE.perSecond);
    b.last = now;
    this.buckets.set(ws, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // ---------- eventos WebSocket (com hibernação) ----------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return this.fail(ws, 'bad_message');
    if (raw.length > MAX_MESSAGE_BYTES) return this.fail(ws, 'too_big');
    const att = this.att(ws);
    if (!att) return this.fail(ws, 'bad_message');
    if (att.role === 'player' && !this.rateOk(ws)) {
      // Cursor em excesso é só descartado; o resto derruba a conexão.
      if (raw.startsWith('{"t":"cursor"')) return;
      return this.fail(ws, 'rate_limited');
    }

    let msg: ClientToRelay;
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.fail(ws, 'bad_message');
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return this.fail(ws, 'bad_message');

    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (!att.authed) {
      if (msg.t !== 'auth') return this.fail(ws, 'bad_auth');
      return this.auth(ws, msg);
    }
    if (att.role === 'gm') return this.fromGm(ws, msg);
    return this.fromPlayer(ws, att, msg);
  }

  private async auth(ws: WebSocket, msg: Extract<ClientToRelay, { t: 'auth' }>) {
    if (msg.v !== PROTOCOL_VERSION) return this.fail(ws, 'bad_version');
    const meta = await this.loadMeta();

    if (msg.role === 'gm') {
      if (!isStr(msg.key, 20, 200) || !isStr(msg.invite, 8, 100)) return this.fail(ws, 'bad_auth');
      const hash = await sha256(msg.key);
      if (meta.gmKeyHash && meta.gmKeyHash !== hash) return this.fail(ws, 'wrong_gm_key');
      meta.gmKeyHash = hash;
      meta.invite = msg.invite;
      await this.saveMeta();
      await this.ctx.storage.setAlarm(Date.now() + EXPIRY_MS);
      for (const { ws: other, att } of this.sockets(ws)) if (att.role === 'gm') this.fail(other, 'replaced');
      ws.serializeAttachment({ authed: true, role: 'gm', pid: 'gm', name: 'Mestre' } satisfies Attachment);
      const p = this.presence();
      this.send(ws, { t: 'welcome', role: 'gm', pid: 'gm', ...p });
      this.broadcastPresence();
      return;
    }

    if (msg.role === 'player') {
      if (!isStr(msg.pid, 8, 40) || !PLAYER_ID_RE.test(msg.pid) || !isStr(msg.invite, 1, 100)) {
        return this.fail(ws, 'bad_auth');
      }
      const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 32) : '';
      if (!name) return this.fail(ws, 'bad_auth');
      if (!meta.invite || meta.invite !== msg.invite) return this.fail(ws, 'bad_invite');
      if (meta.banned.includes(msg.pid)) return this.fail(ws, 'banned');
      for (const { ws: other, att } of this.sockets(ws)) if (att.pid === msg.pid) this.fail(other, 'replaced');
      ws.serializeAttachment({ authed: true, role: 'player', pid: msg.pid, name } satisfies Attachment);
      const p = this.presence();
      this.send(ws, { t: 'welcome', role: 'player', pid: msg.pid, ...p });
      this.broadcastPresence();
      return;
    }
    return this.fail(ws, 'bad_auth');
  }

  private async fromGm(ws: WebSocket, msg: ClientToRelay) {
    switch (msg.t) {
      case 'send': {
        const payload = JSON.stringify({ t: 'gm', d: msg.d } satisfies RelayToClient);
        for (const { ws: p, att } of this.sockets(ws)) {
          if (att.role === 'player' && (msg.to === '*' || att.pid === msg.to)) this.send(p, payload);
        }
        return;
      }
      case 'setInvite': {
        if (!isStr(msg.invite, 8, 100)) return;
        const meta = await this.loadMeta();
        meta.invite = msg.invite;
        await this.saveMeta();
        return;
      }
      case 'kick': {
        if (!isStr(msg.pid, 1, 40)) return;
        const meta = await this.loadMeta();
        if (!meta.banned.includes(msg.pid)) meta.banned.push(msg.pid);
        await this.saveMeta();
        for (const { ws: p, att } of this.sockets(ws)) if (att.pid === msg.pid) this.fail(p, 'kicked');
        this.broadcastPresence();
        return;
      }
      case 'unban': {
        const meta = await this.loadMeta();
        meta.banned = meta.banned.filter((p) => p !== msg.pid);
        await this.saveMeta();
        return;
      }
      // O cursor do mestre nunca é transmitido.
    }
  }

  private fromPlayer(ws: WebSocket, att: Attachment, msg: ClientToRelay) {
    switch (msg.t) {
      case 'cursor': {
        if (typeof msg.x !== 'number' || typeof msg.y !== 'number' || !Number.isFinite(msg.x + msg.y)) return;
        const out = JSON.stringify({ t: 'cursor', pid: att.pid!, x: Math.round(msg.x), y: Math.round(msg.y) } satisfies RelayToClient);
        for (const { ws: other } of this.sockets(ws)) this.send(other, out);
        return;
      }
      case 'gm': {
        const gm = this.sockets(ws).find((s) => s.att.role === 'gm');
        if (gm) this.send(gm.ws, { t: 'from', pid: att.pid!, d: msg.d });
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastPresence(ws);
  }

  async alarm() {
    if (this.sockets().some((s) => s.att.role === 'gm')) {
      await this.ctx.storage.setAlarm(Date.now() + EXPIRY_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.meta = null;
  }
}
