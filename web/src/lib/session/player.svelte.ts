// Sessão do jogador: manda intenções ao mestre e mostra o que o mestre envia.
import {
  DiceError, parseDice, PROTOCOL_VERSION, WordFilter,
  type EditPatch, type GmMessage, type PlayerIntent, type RelayToClient, type TransformPatch,
} from '@ftt/shared';
import { RelayClient } from '../net/client';
import { PlayerImages } from '../images/images';
import { roomSocketUrl } from '../config';
import { TableSession } from './table.svelte';

export class PlayerSession extends TableSession {
  readonly role = 'player' as const;
  readonly myPid: string;
  readonly images: PlayerImages;
  readonly roomId: string;
  muted = $state(false);
  /** Recebeu o primeiro estado do mestre. */
  synced = $state(false);

  private net: RelayClient;
  private lastCursor = 0;
  private wf: WordFilter | null = null;

  constructor(roomId: string, invite: string, pid: string, readonly myName: string) {
    super();
    this.roomId = roomId;
    this.myPid = pid;
    this.images = new PlayerImages((hash) => this.intent({ k: 'img', hash }));
    this.net = new RelayClient(
      roomSocketUrl(roomId),
      () => ({ t: 'auth', role: 'player', invite, pid, name: myName, v: PROTOCOL_VERSION }),
      {
        onMessage: (m) => this.onRelay(m),
        onStatus: (s, err) => {
          this.status = s;
          this.statusError = err ?? '';
        },
      },
    );
    this.net.connect();
  }

  private intent(d: PlayerIntent): boolean {
    return this.net.send({ t: 'gm', d });
  }

  private onRelay(m: RelayToClient) {
    switch (m.t) {
      case 'welcome':
        this.onPresence(m.gmOnline, m.peers);
        if (m.gmOnline) this.intent({ k: 'sync' });
        break;
      case 'presence': {
        const was = this.gmOnline;
        this.onPresence(m.gmOnline, m.peers);
        if (!was && m.gmOnline) {
          this.intent({ k: 'sync' });
          this.images.retryPending();
        }
        break;
      }
      case 'cursor':
        this.onCursor(m.pid, m.x, m.y);
        break;
      case 'gm':
        this.onGm(m.d);
        break;
      case 'error':
        this.toast(m.message, 'error');
        break;
    }
  }

  private onGm(d: GmMessage) {
    switch (d.k) {
      case 'snapshot':
        this.campaignName = d.campaign;
        this.items = new Map(d.items.map((i) => [i.id, i]));
        this.log = d.log;
        this.roster = d.roster;
        this.filter = d.filter;
        this.wf = null;
        this.muted = !!d.roster[this.myPid]?.muted;
        this.synced = true;
        this.bump();
        break;
      case 'item':
        this.items.set(d.item.id, d.item);
        this.bump();
        break;
      case 'remove':
        this.items.delete(d.id);
        this.bump();
        break;
      case 'log':
        this.pushLog(d.entry);
        break;
      case 'roster':
        this.roster = d.roster;
        this.muted = !!d.roster[this.myPid]?.muted;
        break;
      case 'filter':
        this.filter = d.filter;
        this.wf = null;
        break;
      case 'imgChunk':
        this.images.receive(d);
        break;
      case 'imgMissing':
        this.images.missing(d.hash);
        break;
      case 'focus':
        this.focusHandler?.(d.x, d.y, d.scale);
        break;
      case 'notice':
        this.toast(d.text);
        break;
    }
  }

  private canSend(): boolean {
    if (this.status !== 'online') return this.toast('Sem conexão com a mesa.', 'error'), false;
    if (!this.gmOnline) return this.toast('O mestre está offline.', 'error'), false;
    return true;
  }

  chat(text: string): boolean {
    if (!text.trim()) return false;
    if (this.muted) return this.toast('O mestre silenciou você.', 'error'), false;
    // Aviso prévio: o mestre aplica o filtro de verdade.
    if (this.filter.enabled && this.filter.mode === 'block') {
      this.wf ??= new WordFilter(this.filter.words);
      if (this.wf.check(text)) return this.toast('Essa mensagem tem palavras bloqueadas nesta mesa.', 'error'), false;
    }
    if (!this.canSend()) return false;
    return this.intent({ k: 'chat', text });
  }

  roll(expr: string, priv: boolean) {
    try {
      parseDice(expr);
    } catch (e) {
      return this.toast(e instanceof DiceError ? `Rolagem inválida: ${e.message}` : 'Rolagem inválida', 'error');
    }
    if (this.muted) return this.toast('O mestre silenciou você.', 'error');
    if (this.canSend()) this.intent({ k: 'roll', expr, priv });
  }

  transform(id: string, patch: TransformPatch, final: boolean) {
    const item = this.items.get(id);
    if (!item || !this.can('move', item)) return;
    Object.assign(item, patch);
    if (final) this.bump();
    this.intent({ k: 'transform', id, patch, final });
  }

  edit(id: string, patch: EditPatch) {
    const item = this.items.get(id);
    if (!item || !this.can('edit', item)) return;
    if (!this.canSend()) return;
    this.intent({ k: 'edit', id, patch });
  }

  zorder(id: string, dir: 'front' | 'back') {
    this.intent({ k: 'z', id, dir });
  }

  sendCursor(x: number, y: number) {
    const now = performance.now();
    if (now - this.lastCursor < 50) return;
    this.lastCursor = now;
    this.net.send({ t: 'cursor', x, y });
  }

  destroy() {
    this.net.close();
    this.images.dispose();
  }
}
