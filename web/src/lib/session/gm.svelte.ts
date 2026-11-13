// Sessão do mestre: é a autoridade da mesa. Valida tudo o que os jogadores pedem,
// rola os dados, salva na pasta e envia a cada jogador só o que ele pode ver.
import {
  applyFilter, can, DEFAULT_ITEM_PERM, DiceError, itemForPlayer, logVisibleTo, newInvite, newItemId,
  parsePlayerIntent, PROTOCOL_VERSION, rollDice, TRANSFORM_FIELDS, WordFilter,
  type Actor, type BoardItem, type EditPatch, type FilterConfig, type GmMessage, type LogEntry,
  type Peer, type Perm, type PlayerIntent, type RelayToClient, type Roster, type TransformPatch,
} from '@ftt/shared';
import { RelayClient } from '../net/client';
import { GmImages, processImage } from '../images/images';
import { inviteUrl, roomSocketUrl } from '../config';
import { PATHS, readBoard, readCampaign, readRecentLog, Saver, todayKey, type CampaignFile } from '../storage/campaign';
import type { CampaignStore } from '../storage/store';
import { TableSession } from './table.svelte';

/** Campos que só o mestre muda (além dos que o jogador pode editar). */
export type GmPatch = EditPatch & Partial<Pick<BoardItem, 'back' | 'revealed' | 'text' | 'title' | 'front' | 'color'>>;

const NOTE_COLORS = ['#f5e6a8', '#f7c6c7', '#c9e4c5', '#c6dbf0', '#e2d1f0'];

export class GmSession extends TableSession {
  readonly role = 'gm' as const;
  readonly myPid = 'gm';
  readonly images: GmImages;

  invite = $state('');
  saving = $state<'idle' | 'saving' | 'error'>('idle');
  readonly roomId: string;

  private net: RelayClient;
  private saver = new Saver();
  private wf: WordFilter;
  private logByDay = new Map<string, LogEntry[]>();
  private knownPeers = new Set<string>();

  static async open(store: CampaignStore): Promise<GmSession | null> {
    const campaign = await readCampaign(store);
    if (!campaign) return null;
    const items = await readBoard(store);
    const { recent, today } = await readRecentLog(store);
    return new GmSession(store, campaign, items, recent, today);
  }

  private constructor(
    readonly store: CampaignStore,
    private campaign: CampaignFile,
    items: BoardItem[],
    recentLog: LogEntry[],
    todayLog: LogEntry[],
  ) {
    super();
    this.roomId = campaign.roomId;
    this.campaignName = campaign.name;
    this.invite = campaign.invite;
    this.roster = campaign.roster;
    this.filter = campaign.filter;
    this.wf = new WordFilter(campaign.filter.words);
    for (const i of items) this.items.set(i.id, i);
    this.log = recentLog;
    this.logByDay.set(todayKey(), todayLog);
    this.images = new GmImages(store);
    this.saver.onChange = (busy, err) => {
      this.saving = err ? 'error' : busy ? 'saving' : 'idle';
      if (err) this.toast(err, 'error');
    };

    this.net = new RelayClient(
      roomSocketUrl(campaign.roomId),
      () => ({ t: 'auth', role: 'gm', key: this.campaign.gmKey, invite: this.invite, v: PROTOCOL_VERSION }),
      {
        onMessage: (m) => this.onRelay(m),
        onStatus: (s, err) => {
          this.status = s;
          this.statusError = err ?? '';
          if (s !== 'online') this.gmOnline = false;
        },
      },
    );
    this.net.connect();
    this.bump();
  }

  get inviteLink() {
    return inviteUrl(this.roomId, this.invite);
  }

  // ---------- rede ----------

  private onRelay(m: RelayToClient) {
    switch (m.t) {
      case 'welcome':
      case 'presence':
        this.onPresence(m.gmOnline, m.peers);
        this.updateRoster(m.peers);
        break;
      case 'from': {
        const d = parsePlayerIntent(m.d);
        if (d) this.handleIntent(m.pid, d);
        break;
      }
      case 'cursor':
        this.onCursor(m.pid, m.x, m.y);
        break;
      case 'error':
        this.toast(m.message, 'error');
        break;
    }
  }

  private sendTo(pid: string, d: GmMessage) {
    this.net.send({ t: 'send', to: pid, d });
  }

  private broadcast(d: GmMessage) {
    this.net.send({ t: 'send', to: '*', d });
  }

  private updateRoster(peers: Peer[]) {
    let changed = false;
    const now = new Set<string>();
    for (const p of peers) {
      now.add(p.pid);
      const r = this.roster[p.pid];
      if (!r) {
        this.roster[p.pid] = { name: p.name };
        changed = true;
      } else if (r.name !== p.name) {
        r.name = p.name;
        changed = true;
      }
      if (!this.knownPeers.has(p.pid)) this.toast(`${p.name} entrou na mesa`);
    }
    for (const pid of this.knownPeers) if (!now.has(pid)) this.toast(`${this.nameOf(pid)} saiu da mesa`);
    this.knownPeers = now;
    if (changed) {
      this.saveCampaign();
      this.broadcast({ k: 'roster', roster: this.publicRoster() });
    }
  }

  private publicRoster(): Roster {
    const out: Roster = {};
    for (const [pid, r] of Object.entries(this.roster)) if (!r.banned) out[pid] = { name: r.name, muted: r.muted };
    return out;
  }

  private notify(actor: Actor, text: string) {
    if (actor.role === 'gm') this.toast(text);
    else this.sendTo(actor.pid, { k: 'notice', text });
  }

  private handleIntent(pid: string, d: PlayerIntent) {
    const actor: Actor = { role: 'player', pid };
    const r = this.roster[pid];
    if (r?.banned) return;
    switch (d.k) {
      case 'sync':
        return this.sendSnapshot(pid);
      case 'chat':
        if (r?.muted) return this.notify(actor, 'O mestre silenciou você.');
        return void this.processChat(actor, d.text);
      case 'roll':
        if (r?.muted) return this.notify(actor, 'O mestre silenciou você.');
        return this.doRoll(actor, d.expr, d.priv);
      case 'transform':
        return this.applyTransform(actor, d.id, d.patch, d.final);
      case 'edit':
        return this.applyEdit(actor, d.id, d.patch);
      case 'z':
        return this.applyZ(actor, d.id, d.dir);
      case 'img':
        return void this.sendImage(actor, d.hash);
    }
  }

  private sendSnapshot(pid: string) {
    const actor: Actor = { role: 'player', pid };
    const items = [...this.items.values()].map((i) => itemForPlayer(i, actor)).filter((i): i is BoardItem => !!i);
    let log = $state.snapshot(this.log).filter((e) => logVisibleTo(e, pid)).slice(-150);
    const msg = (): GmMessage => ({
      k: 'snapshot', campaign: this.campaignName, items, log, roster: this.publicRoster(), filter: $state.snapshot(this.filter),
    });
    // Garante que o snapshot cabe numa mensagem do relay.
    while (log.length > 10 && JSON.stringify(msg()).length > 500_000) log = log.slice(Math.floor(log.length / 2));
    this.sendTo(pid, msg());
  }

  /** Envia o item a cada jogador conectado, já filtrado (ou manda remover, se ele não pode mais ver). */
  private broadcastItem(item: BoardItem) {
    for (const p of this.peers) {
      const v = itemForPlayer(item, { role: 'player', pid: p.pid });
      this.sendTo(p.pid, v ? { k: 'item', item: v } : { k: 'remove', id: item.id });
    }
  }

  private async sendImage(actor: Actor, hash: string) {
    const allowed = [...this.items.values()].some((i) => i.img === hash && itemForPlayer(i, actor));
    if (!allowed) return this.sendTo(actor.pid, { k: 'imgMissing', hash });
    const chunks = await this.images.chunks(hash);
    if (!chunks) return this.sendTo(actor.pid, { k: 'imgMissing', hash });
    for (const c of chunks) this.sendTo(actor.pid, c);
  }

  // ---------- chat e dados ----------

  private processChat(actor: Actor, raw: string): boolean {
    const text = raw.trim();
    if (!text) return false;
    const cmd = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
    if (cmd) {
      const c = cmd[1].toLowerCase();
      const rest = cmd[2].trim();
      if (['r', 'roll', 'rolar'].includes(c)) return this.doRoll(actor, rest, false), true;
      if (['gr', 'pr', 'rp', 'privado'].includes(c)) return this.doRoll(actor, rest, true), true;
      if (['w', 'sussurro', 'whisper', 'cochichar'].includes(c)) return this.whisper(actor, rest);
      this.notify(actor, 'Comando desconhecido. Use /r 1d20, /gr 1d20 (privado) ou /w nome mensagem.');
      return false;
    }
    const f = applyFilter(this.filter, text, this.wf);
    if (!f.ok) return this.notify(actor, f.reason), false;
    this.addLog({ from: actor.pid, kind: 'chat', text: f.text, censored: f.censored || undefined });
    return true;
  }

  private whisper(actor: Actor, rest: string): boolean {
    const lower = rest.toLowerCase();
    let target: string | null = null;
    let msg = '';
    for (const alias of ['mestre', 'gm']) {
      if (lower.startsWith(alias + ' ')) {
        target = 'gm';
        msg = rest.slice(alias.length);
      }
    }
    if (!target) {
      // Nome mais longo que bate com o começo do texto (nomes podem ter espaço).
      const names = Object.entries(this.roster)
        .filter(([, r]) => !r.banned)
        .sort((a, b) => b[1].name.length - a[1].name.length);
      for (const [pid, r] of names) {
        if (lower.startsWith(r.name.toLowerCase() + ' ')) {
          target = pid;
          msg = rest.slice(r.name.length);
          break;
        }
      }
    }
    msg = msg.trim();
    if (!target || !msg) return this.notify(actor, 'Use: /w mestre mensagem  ou  /w NomeDoJogador mensagem'), false;
    if (target === actor.pid) return false;
    const f = applyFilter(this.filter, msg, this.wf);
    if (!f.ok) return this.notify(actor, f.reason), false;
    this.addLog({ from: actor.pid, kind: 'chat', text: f.text, to: target === 'gm' ? [] : [target], censored: f.censored || undefined });
    return true;
  }

  private doRoll(actor: Actor, expr: string, priv: boolean) {
    try {
      const roll = rollDice(expr || '1d20');
      this.addLog({ from: actor.pid, kind: 'roll', roll, to: priv ? [] : undefined });
    } catch (e) {
      this.notify(actor, e instanceof DiceError ? `Rolagem inválida: ${e.message}` : 'Rolagem inválida');
    }
  }

  private addLog(partial: Omit<LogEntry, 'id' | 'ts' | 'name'>) {
    const entry: LogEntry = { id: newItemId(), ts: Date.now(), name: this.nameOf(partial.from), ...partial };
    this.pushLog(entry);
    const day = todayKey();
    const list = this.logByDay.get(day) ?? [];
    list.push(entry);
    this.logByDay.set(day, list);
    this.saver.schedule(`log/${day}`, () =>
      this.store.writeText(`${PATHS.logDir}/${day}.jsonl`, list.map((e) => JSON.stringify(e)).join('\n') + '\n'),
    );
    if (!entry.to) this.broadcast({ k: 'log', entry });
    else for (const p of this.peers) if (logVisibleTo(entry, p.pid)) this.sendTo(p.pid, { k: 'log', entry });
  }

  // ---------- quadro (autoridade) ----------

  private refuse(actor: Actor, item: BoardItem | undefined) {
    if (actor.role !== 'player') return;
    // Desfaz a mudança otimista do jogador mandando o estado verdadeiro.
    const v = item && itemForPlayer(item, actor);
    if (v) this.sendTo(actor.pid, { k: 'item', item: v });
    this.notify(actor, 'Você não tem permissão para isso.');
  }

  private applyTransform(actor: Actor, id: string, patch: TransformPatch, final: boolean) {
    const item = this.items.get(id);
    if (!item || !this.canAct(actor, 'move', item)) return this.refuse(actor, item);
    for (const k of TRANSFORM_FIELDS) {
      const v = patch[k];
      if (typeof v === 'number' && Number.isFinite(v)) item[k] = v;
    }
    this.bump();
    this.broadcastItem(item);
    if (final) this.saveBoard();
  }

  private applyEdit(actor: Actor, id: string, patch: GmPatch) {
    const item = this.items.get(id);
    if (!item || !this.canAct(actor, 'edit', item)) return this.refuse(actor, item);
    const clean: GmPatch = { ...patch };
    if (actor.role === 'player') {
      for (const f of ['text', 'title', 'front'] as const) {
        const v = clean[f];
        if (v === undefined) continue;
        const r = applyFilter(this.filter, v, this.wf);
        if (!r.ok) return this.notify(actor, r.reason), this.refuse(actor, item);
        clean[f] = r.text;
      }
    }
    Object.assign(item, clean);
    this.bump();
    this.broadcastItem(item);
    this.saveBoard();
  }

  private applyZ(actor: Actor, id: string, dir: 'front' | 'back') {
    const item = this.items.get(id);
    if (!item || !this.canAct(actor, 'move', item)) return this.refuse(actor, item);
    if (dir === 'front') item.z = this.maxZ() + 1;
    else item.z = Math.min(...[...this.items.values()].map((i) => i.z)) - 1;
    this.bump();
    this.broadcastItem(item);
    this.saveBoard();
  }

  private canAct(actor: Actor, action: 'move' | 'edit', item: BoardItem): boolean {
    if (actor.role === 'gm') return true;
    const r = this.roster[actor.pid];
    return !!r && !r.banned && can(actor, action, item);
  }

  // ---------- ações do mestre (interface) ----------

  chat(text: string) {
    return this.processChat(this.actor, text);
  }

  roll(expr: string, priv: boolean) {
    this.doRoll(this.actor, expr, priv);
  }

  transform(id: string, patch: TransformPatch, final: boolean) {
    this.applyTransform(this.actor, id, patch, final);
  }

  edit(id: string, patch: GmPatch) {
    this.applyEdit(this.actor, id, patch);
  }

  zorder(id: string, dir: 'front' | 'back') {
    this.applyZ(this.actor, id, dir);
  }

  private addItem(partial: Omit<BoardItem, 'id' | 'z' | 'rotation' | 'perm'> & Partial<BoardItem>): BoardItem {
    const item: BoardItem = { id: newItemId(), z: this.maxZ() + 1, rotation: 0, perm: structuredClone(DEFAULT_ITEM_PERM), ...partial };
    this.items.set(item.id, item);
    this.bump();
    this.broadcastItem(item);
    this.saveBoard();
    return item;
  }

  addNote(x: number, y: number) {
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];
    return this.addItem({ type: 'note', x: x - 110, y: y - 90, w: 220, h: 180, text: 'Nova nota', color });
  }

  addCard(x: number, y: number) {
    return this.addItem({
      type: 'card', x: x - 130, y: y - 170, w: 260, h: 340,
      title: 'Pista', front: 'O que os jogadores veem.', back: 'O que só aparece quando você revelar.', revealed: false,
    });
  }

  async addImage(file: Blob, x: number, y: number) {
    try {
      const img = await processImage(file);
      await this.images.save(img);
      const scale = Math.min(1, 480 / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      return this.addItem({ type: 'image', x: x - w / 2, y: y - h / 2, w, h, img: img.hash });
    } catch (e) {
      this.toast(`Não consegui adicionar a imagem: ${(e as Error).message}`, 'error');
      return null;
    }
  }

  duplicate(id: string) {
    const src = this.items.get(id);
    if (!src) return;
    const { id: _id, z: _z, ...rest } = structuredClone(src);
    this.addItem({ ...rest, x: src.x + 30, y: src.y + 30 });
  }

  deleteItem(id: string) {
    if (!this.items.delete(id)) return;
    this.bump();
    this.broadcast({ k: 'remove', id });
    this.saveBoard();
  }

  setPerm(id: string, perm: Perm) {
    const item = this.items.get(id);
    if (!item) return;
    item.perm = perm;
    this.bump();
    this.broadcastItem(item);
    this.saveBoard();
  }

  focusAll(x: number, y: number, scale: number) {
    this.broadcast({ k: 'focus', x, y, scale });
    this.toast('Visão dos jogadores centralizada aqui.');
  }

  setMuted(pid: string, muted: boolean) {
    const r = this.roster[pid];
    if (!r) return;
    r.muted = muted || undefined;
    this.saveCampaign();
    this.broadcast({ k: 'roster', roster: this.publicRoster() });
    this.sendTo(pid, { k: 'notice', text: muted ? 'O mestre silenciou você.' : 'O mestre liberou seu chat.' });
  }

  kick(pid: string) {
    const r = this.roster[pid];
    if (!r) return;
    r.banned = true;
    this.net.send({ t: 'kick', pid });
    this.saveCampaign();
    this.broadcast({ k: 'roster', roster: this.publicRoster() });
    this.toast(`${r.name} foi removido. Para garantir que não volte, gere um novo convite.`);
  }

  unban(pid: string) {
    const r = this.roster[pid];
    if (!r) return;
    delete r.banned;
    this.net.send({ t: 'unban', pid });
    this.saveCampaign();
  }

  forget(pid: string) {
    delete this.roster[pid];
    this.saveCampaign();
  }

  regenerateInvite() {
    this.invite = newInvite();
    this.net.send({ t: 'setInvite', invite: this.invite });
    this.saveCampaign();
    this.toast('Novo convite gerado. O link antigo não funciona mais.');
  }

  setFilter(cfg: FilterConfig) {
    this.filter = cfg;
    this.wf = new WordFilter(cfg.words);
    this.saveCampaign();
    this.broadcast({ k: 'filter', filter: $state.snapshot(this.filter) });
  }

  rename(name: string) {
    this.campaignName = name.trim() || this.campaignName;
    this.saveCampaign();
  }

  // ---------- persistência ----------

  private saveBoard() {
    this.saver.schedule('quadro', () =>
      this.store.writeText(PATHS.board, JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 1)),
    );
  }

  private saveCampaign() {
    this.saver.schedule('campanha', () => {
      const c: CampaignFile = {
        ...this.campaign,
        name: this.campaignName,
        invite: this.invite,
        filter: $state.snapshot(this.filter),
        roster: $state.snapshot(this.roster),
      };
      this.campaign = c;
      return this.store.writeText(PATHS.campaign, JSON.stringify(c, null, 2));
    });
  }

  flush() {
    return this.saver.flush();
  }

  destroy() {
    void this.saver.flush();
    this.net.close();
    this.images.dispose();
  }
}
