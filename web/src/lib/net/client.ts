// Conexão WebSocket com o relay, com reconexão automática.
import type { ClientToRelay, RelayErrorCode, RelayToClient } from '@ftt/shared';

export type NetStatus = 'connecting' | 'online' | 'offline' | 'fatal';

/** Erros após os quais não adianta tentar de novo. */
const FATAL: RelayErrorCode[] = ['bad_invite', 'banned', 'wrong_gm_key', 'replaced', 'kicked', 'bad_version', 'bad_auth'];

export interface ClientHandlers {
  onMessage(m: RelayToClient): void;
  onStatus(s: NetStatus, error?: string): void;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private fatal = false;
  status: NetStatus = 'connecting';

  constructor(
    private url: string,
    private auth: () => ClientToRelay,
    private h: ClientHandlers,
  ) {}

  connect() {
    if (this.closed) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.setStatus('fatal', `Endereço do relay inválido: ${this.url}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.auth()));
    };
    ws.onmessage = (e) => {
      let m: RelayToClient;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.attempt = 0;
        this.setStatus('online');
        this.startPing();
      }
      if (m.t === 'error' && FATAL.includes(m.code)) {
        this.fatal = true;
        this.setStatus('fatal', m.message);
      }
      this.h.onMessage(m);
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed || this.fatal) return;
      this.setStatus('offline');
      const delay = Math.min(15000, 800 * 2 ** this.attempt++) + Math.random() * 500;
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Envia se estiver conectado. Retorna false se a mensagem não pôde ser enviada. */
  send(msg: ClientToRelay): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.setStatus('offline');
  }

  private setStatus(s: NetStatus, err?: string) {
    this.status = s;
    this.h.onStatus(s, err);
  }

  private startPing() {
    this.stopPing();
    this.ping = setInterval(() => this.send({ t: 'ping' }), 25000);
  }

  private stopPing() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
  }
}
