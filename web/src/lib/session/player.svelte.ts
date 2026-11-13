// Sessão do jogador: manda intenções ao mestre e mostra o que o mestre envia.
import {
  can, DiceError, parseDice, PROTOCOL_VERSION, WordFilter,
  type AnyDoc, type EditPatch, type FieldValue, type GmMessage, type PlayerIntent, type RelayToClient,
  type TransformPatch,
} from '@ftt/shared';
import { RelayClient } from '../net/client';
import { PlayerImages } from '../images/images';
import { roomSocketUrl } from '../config';
import { emptyDocs, TableSession } from './table.svelte';

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
        this.combat = d.combat;
        this.settings = d.settings;
        this.map = d.map;
        // Os documentos chegam logo depois, um por mensagem.
        this.docs = emptyDocs();
        this.synced = true;
        this.bump();
        break;
      case 'doc':
        (this.docs[d.col] as Record<string, AnyDoc>)[d.doc.id] = d.doc;
        if (d.col === 'sheets') this.bump(); // tokens mostram a vida das fichas
        break;
      case 'docRemove':
        delete this.docs[d.col][d.id];
        if (d.col === 'sheets') this.closeSheet(d.id);
        if (d.col === 'journal' || d.col === 'wiki') this.closeNote(d.id);
        break;
      case 'combat':
        this.combat = d.combat;
        break;
      case 'settings':
        this.settings = d.settings;
        break;
      case 'map':
        this.map = d.map;
        break;
      case 'fogAdd':
        this.map.fog.shapes.push(d.shape);
        break;
      case 'ruler':
        this.onRuler(d.pid, d.pts);
        break;
      case 'ping':
        this.onPing(d.pid, d.x, d.y);
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

  roll(expr: string, priv: boolean, label?: string) {
    try {
      parseDice(expr);
    } catch (e) {
      return this.toast(e instanceof DiceError ? `Rolagem inválida: ${e.message}` : 'Rolagem inválida', 'error');
    }
    if (this.muted) return this.toast('O mestre silenciou você.', 'error');
    if (this.canSend()) this.intent({ k: 'roll', expr, priv, ...(label ? { label } : {}) });
  }

  newSheet(templateId: string, name: string) {
    if (this.canSend()) this.intent({ k: 'sheetNew', templateId, name });
  }

  setSheet(id: string, values: Record<string, FieldValue>, name?: string) {
    const sheet = this.docs.sheets[id];
    if (!sheet || !can(this.actor, 'edit', sheet)) return;
    if (!this.canSend()) return;
    // Otimista: mostra já; o mestre confirma (ou corrige) em seguida.
    Object.assign(sheet.values, values);
    if (name) sheet.name = name;
    this.intent({ k: 'sheetSet', id, values, ...(name ? { name } : {}) });
  }

  rollSheet(id: string, field: string, priv: boolean) {
    if (this.muted) return this.toast('O mestre silenciou você.', 'error');
    if (this.canSend()) this.intent({ k: 'sheetRoll', id, field, priv });
  }

  rollInitiative(sheetId: string) {
    if (this.canSend()) this.intent({ k: 'initRoll', sheetId });
  }

  editNote(col: 'journal' | 'wiki', id: string, patch: { title?: string; text?: string }) {
    const d = this.docs[col][id];
    if (!d || !can(this.actor, 'edit', d) || !this.canSend()) return;
    Object.assign(d, patch);
    this.intent({ k: 'docEdit', col, id, patch });
  }

  rollTable(id: string, priv: boolean) {
    if (this.muted) return this.toast('O mestre silenciou você.', 'error');
    if (this.canSend()) this.intent({ k: 'tableRoll', id, priv });
  }

  private lastRuler = 0;
  sendRuler(pts: number[] | null) {
    const now = performance.now();
    if (pts && now - this.lastRuler < 90) return;
    this.lastRuler = now;
    this.intent({ k: 'ruler', pts });
  }

  ping(x: number, y: number) {
    this.onPing(this.myPid, x, y);
    this.intent({ k: 'ping', x, y });
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
