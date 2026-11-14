// Sessão do mestre: é a autoridade da mesa. Valida tudo o que os jogadores pedem,
// rola os dados, salva na pasta e envia a cada jogador só o que ele pode ver.
import {
  applyFilter, can, COLLECTIONS, compactFog, DEFAULT_MAP, simplifyStroke, combatForPlayer, defaultValues, DEFAULT_ITEM_PERM, DiceError, docForPlayer,
  FormulaError, itemForPlayer, logVisibleTo, newInvite, newItemId, parsePlayerIntent, PROTOCOL_VERSION,
  resolveFormula, rollDice, sanitizeValues, SHEET_PERM, sortEntries, stepTurn, TEMPLATE_PERM, TEMPLATE_PRESETS,
  TRANSFORM_FIELDS, WordFilter, DEFAULT_TABLES, TABLE_PERM, NOTE_PERM, rollTable as rollRandomTable, logToJournal,
  MAX_NOTE_TEXT, AVATAR_SIDE, MAX_AVATAR_BYTES, playerOwnsItem, templateAttrs, creaturePreset, presetTemplate, migrateTemplate,
  attributesUsedBy, fieldIdFromLabel, type Preset, hpOf, isPlayerSheet, upgradeFilter,
  type Actor, type AnyDoc, type BoardItem, type Collection, type Combat, type CombatEntry, type DocMap,
  type EditPatch, type FieldValue, type FilterConfig, type GmMessage, type LogEntry, type Peer, type Perm,
  type PlayerIntent, type RelayToClient, type Roster, type Sheet, type SheetTemplate, type TableSettings,
  type JournalEntry, type WikiPage, type RandomTable, type FogShape, type GridSettings, type Layer, type MapSettings, type TransformPatch,
  type ListRow, type AttributeDef, UndoHistory, diffBoard, type BoardChange,
} from '@ftt/shared';
import { RelayClient } from '../net/client';
import { fromBase64, GmImages, processImage } from '../images/images';
import { snapToGrid } from '@ftt/shared';
import { inviteUrl, roomSocketUrl } from '../config';
import {
  docPath, PATHS, readBoard, readCampaign, readMap, readCombat, readDocs, readRecentLog, Saver, todayKey, type CampaignFile,
} from '../storage/campaign';
import type { CampaignStore } from '../storage/store';
import { emptyDocs, TableSession, type Docs } from './table.svelte';

/** Campos que só o mestre muda (além dos que o jogador pode editar). */
export type GmPatch = EditPatch & Partial<Pick<BoardItem, 'back' | 'revealed' | 'text' | 'title' | 'front' | 'color' | 'segments'>>;

/** Máximo de fichas que um jogador pode criar sozinho. */
const MAX_PLAYER_SHEETS = 10;

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
  /** Imagens de personagem chegando em pedaços, por jogador e ficha. */
  private avatarParts = new Map<string, { n: number; got: Uint8Array<ArrayBuffer>[]; count: number; bytes: number }>();
  /** Desfazer: retrato do quadro na última mudança salva (id -> JSON). */
  private history = new UndoHistory(100);
  private shadow = new Map<string, string>();
  private shadowMap = '';
  /** Mudança feita por um jogador (não entra no desfazer do mestre). */
  private byPlayer = false;
  private restoring = false;

  static async open(store: CampaignStore): Promise<GmSession | null> {
    const campaign = await readCampaign(store);
    if (!campaign) return null;
    const items = await readBoard(store);
    const { recent, today } = await readRecentLog(store);
    const docs = emptyDocs();
    for (const col of COLLECTIONS) {
      for (const d of await readDocs(store, col)) (docs[col] as Record<string, AnyDoc>)[d.id] = d;
    }
    const combat = await readCombat(store);
    const map = await readMap(store);
    const s = new GmSession(store, campaign, items, recent, today, docs, combat, map);
    const f = upgradeFilter(campaign.filter);
    if (f) s.setFilter(f);
    if (!campaign.seeded) s.seedTemplates(campaign.system);
    else s.migrate();
    if (!campaign.seededTables) s.seedTables();
    return s;
  }

  private constructor(
    readonly store: CampaignStore,
    private campaign: CampaignFile,
    items: BoardItem[],
    recentLog: LogEntry[],
    todayLog: LogEntry[],
    docs: Docs,
    combat: Combat,
    map: MapSettings,
  ) {
    super();
    this.docs = docs;
    this.map = map;
    this.combat = combat;
    this.settings = campaign.settings!;
    this.roomId = campaign.roomId;
    this.campaignName = campaign.name;
    this.invite = campaign.invite;
    this.roster = campaign.roster;
    this.filter = campaign.filter;
    this.wf = new WordFilter(campaign.filter.words);
    for (const i of items) this.items.set(i.id, i);
    this.takeShadow();
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
    this.byPlayer = true;
    try {
      this.handlePlayer(pid, d);
    } finally {
      this.byPlayer = false;
    }
  }

  private handlePlayer(pid: string, d: PlayerIntent) {
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
        return void this.doRoll(actor, d.expr, d.priv, d.label);
      case 'transform':
        return this.applyTransform(actor, d.id, d.patch, d.final);
      case 'edit':
        return this.applyEdit(actor, d.id, d.patch);
      case 'z':
        return this.applyZ(actor, d.id, d.dir);
      case 'img':
        return void this.sendImage(actor, d.hash);
      case 'sheetNew':
        return this.playerNewSheet(actor, d.templateId, d.name);
      case 'sheetSet':
        return this.applySheetSet(actor, d.id, d.values, d.name);
      case 'sheetRoll':
        if (r?.muted) return this.notify(actor, 'O mestre silenciou você.');
        return this.doSheetRoll(actor, d.id, d.field, d.priv, d.row);
      case 'initRoll':
        return this.doInitRoll(actor, d.sheetId);
      case 'ruler':
        this.onRuler(pid, d.pts);
        return this.broadcast({ k: 'ruler', pid, pts: d.pts });
      case 'ping':
        return this.ping2(pid, d.x, d.y);
      case 'docEdit':
        return this.applyNoteEdit(actor, d.col, d.id, d.patch);
      case 'avatar':
        return this.receiveAvatar(actor, d.sheetId, d.i, d.n, d.data);
      case 'tableRoll':
        if (r?.muted) return this.notify(actor, 'O mestre silenciou você.');
        return this.doTableRoll(actor, d.id, d.priv);
    }
  }

  private sendSnapshot(pid: string) {
    const actor: Actor = { role: 'player', pid };
    const items = [...this.items.values()].map((i) => this.itemFor(i, actor)).filter((i): i is BoardItem => !!i);
    let log = $state.snapshot(this.log).filter((e) => logVisibleTo(e, pid)).slice(-150);
    const msg = (): GmMessage => ({
      k: 'snapshot', campaign: this.campaignName, items, log, roster: this.publicRoster(), filter: $state.snapshot(this.filter),
      combat: this.combatFor(pid), settings: $state.snapshot(this.settings), map: $state.snapshot(this.map),
    });
    // Garante que o snapshot cabe numa mensagem do relay.
    while (log.length > 10 && JSON.stringify(msg()).length > 500_000) log = log.slice(Math.floor(log.length / 2));
    this.sendTo(pid, msg());
    // Documentos vão um por mensagem (podem ser grandes).
    for (const col of COLLECTIONS) {
      for (const d of Object.values(this.docs[col])) {
        const v = docForPlayer(d, actor);
        if (v) this.sendTo(pid, { k: 'doc', col, doc: $state.snapshot(v) as AnyDoc });
      }
    }
  }

  private combatFor(pid: string): Combat {
    return combatForPlayer($state.snapshot(this.combat), { role: 'player', pid }, $state.snapshot(this.docs.sheets));
  }

  private broadcastCombat() {
    for (const p of this.peers) this.sendTo(p.pid, { k: 'combat', combat: this.combatFor(p.pid) });
    this.saver.schedule('combate', () => this.store.writeText(PATHS.combat, JSON.stringify($state.snapshot(this.combat), null, 1)));
  }

  /** Envia o item a cada jogador conectado, já filtrado (ou manda remover, se ele não pode mais ver). */
  private broadcastItem(item: BoardItem) {
    for (const p of this.peers) {
      const v = this.itemFor(item, { role: 'player', pid: p.pid });
      this.sendTo(p.pid, v ? { k: 'item', item: v } : { k: 'remove', id: item.id });
    }
  }

  /**
   * Item como o jogador recebe. Tokens levam a vida para mostrar em cima deles:
   * sempre a dos personagens de jogador; a de NPCs e inimigos só se o mestre liberar.
   * Também levam a imagem da ficha ligada, mesmo que o jogador não veja a ficha.
   */
  private itemFor(item: BoardItem, actor: Actor): BoardItem | null {
    const v = itemForPlayer(item, actor);
    if (!v || actor.role === 'gm' || v.type !== 'token') return v;
    const copy: BoardItem = { ...v };
    delete copy.hp;
    const sheet = v.sheetId ? this.docs.sheets[v.sheetId] : undefined;
    const show = !!this.settings.showNpcHp;
    if (!sheet || sheet.kind === 'monster') {
      if (show && item.hp) copy.hp = { ...item.hp };
    } else if (isPlayerSheet(sheet) || show) {
      const hp = hpOf(sheet, this.templateOf(sheet));
      if (hp) copy.hp = { cur: hp.cur, max: hp.max };
    }
    if (sheet && !copy.img && sheet.avatar && !can(actor, 'view', sheet)) copy.img = sheet.avatar;
    return copy;
  }

  /** Reenvia os tokens ligados a uma ficha (a vida dela mudou). */
  private lastHp = new Map<string, string>();
  private refreshTokens(sheetId: string) {
    const sheet = this.docs.sheets[sheetId];
    const hp = sheet ? JSON.stringify(hpOf(sheet, this.templateOf(sheet))) + (sheet.avatar ?? '') : '';
    if (this.lastHp.get(sheetId) === hp) return;
    this.lastHp.set(sheetId, hp);
    for (const i of this.items.values()) if (i.type === 'token' && i.sheetId === sheetId) this.broadcastItem(i);
  }

  private async sendImage(actor: Actor, hash: string) {
    const allowed =
      [...this.items.values()].some((i) => this.itemFor(i, actor)?.img === hash) ||
      Object.values(this.docs.sheets).some((s) => s.avatar === hash && can(actor, 'view', s));
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
      if (['r', 'roll', 'rolar'].includes(c)) return !!this.doRoll(actor, rest, false);
      if (['gr', 'pr', 'rp', 'privado'].includes(c)) return !!this.doRoll(actor, rest, true);
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

  private doRoll(actor: Actor, expr: string, priv: boolean, label?: string) {
    try {
      const roll = rollDice(expr || '1d20');
      this.addLog({ from: actor.pid, kind: 'roll', roll, label, to: priv ? [] : undefined });
      return roll;
    } catch (e) {
      this.notify(actor, e instanceof DiceError ? `Rolagem inválida: ${e.message}` : 'Rolagem inválida');
      return null;
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
      for (const f of ['text', 'title', 'front', 'name'] as const) {
        const v = clean[f];
        if (v === undefined) continue;
        const r = applyFilter(this.filter, v, this.wf);
        if (!r.ok) return this.notify(actor, r.reason), this.refuse(actor, item);
        clean[f] = r.text;
      }
    }
    if (clean.filled !== undefined) clean.filled = Math.max(0, Math.min(item.segments ?? 6, clean.filled));
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

  private canAct(actor: Actor, _action: 'move' | 'edit', item: BoardItem): boolean {
    if (actor.role === 'gm') return true;
    const r = this.roster[actor.pid];
    // Só o mestre mexe nos objetos do quadro; cada jogador mexe só no próprio token.
    return !!r && !r.banned && playerOwnsItem(actor.pid, item);
  }

  // ---------- ações do mestre (interface) ----------

  chat(text: string) {
    return this.processChat(this.actor, text);
  }

  roll(expr: string, priv: boolean, label?: string) {
    this.doRoll(this.actor, expr, priv, label);
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
    // Nota do mestre é privada por padrão; ele pode compartilhar depois (botão direito → Mostrar aos jogadores).
    return this.addItem({
      type: 'note', x: x - 110, y: y - 90, w: 220, h: 180, text: 'Nova nota', color,
      perm: structuredClone(NOTE_PERM),
    });
  }

  addCard(x: number, y: number) {
    // Pista nasce totalmente privada (só o mestre vê que ela existe). Ele decide quando
    // mostrar a frente aos jogadores; o verso continua secreto até "Revelar verso".
    return this.addItem({
      type: 'card', x: x - 130, y: y - 170, w: 260, h: 340,
      title: 'Pista', front: 'O que os jogadores veem.', back: 'O que só aparece quando você revelar.', revealed: false,
      perm: structuredClone(NOTE_PERM),
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

  // ---------- documentos: modelos e fichas ----------

  private saveDoc(col: Collection, id: string) {
    if (col === 'sheets') {
      this.bump();
      this.refreshTokens(id);
    }
    this.saver.schedule(`${col}/${id}`, async () => {
      const d = this.docs[col][id];
      if (d) await this.store.writeText(docPath(col, id), JSON.stringify($state.snapshot(d), null, 1));
    });
  }

  private broadcastDoc(col: Collection, id: string) {
    const d = this.docs[col][id];
    if (!d) return;
    const snap = $state.snapshot(d) as AnyDoc;
    for (const p of this.peers) {
      const v = docForPlayer(snap, { role: 'player', pid: p.pid });
      this.sendTo(p.pid, v ? { k: 'doc', col, doc: v } : { k: 'docRemove', col, id });
    }
  }

  putDoc<C extends Collection>(col: C, doc: DocMap[C]) {
    doc.updatedAt = Date.now();
    (this.docs[col] as Record<string, DocMap[C]>)[doc.id] = doc;
    this.saveDoc(col, doc.id);
    this.broadcastDoc(col, doc.id);
  }

  removeDoc(col: Collection, id: string) {
    if (!this.docs[col][id]) return;
    delete this.docs[col][id];
    // Substitui qualquer gravação pendente deste documento pela remoção do arquivo.
    this.saver.schedule(`${col}/${id}`, () => this.store.remove(docPath(col, id)));
    this.broadcast({ k: 'docRemove', col, id });
  }

  setDocPerm(col: Collection, id: string, perm: Perm) {
    const d = this.docs[col][id];
    if (!d) return;
    d.perm = perm;
    d.updatedAt = Date.now();
    this.saveDoc(col, id);
    this.broadcastDoc(col, id);
    if (col === 'sheets') this.broadcastCombat();
  }

  private canEditDoc(actor: Actor, doc: { perm: Perm }) {
    if (actor.role === 'gm') return true;
    const r = this.roster[actor.pid];
    return !!r && !r.banned && can(actor, 'edit', doc);
  }

  /** Cria só o modelo do sistema escolhido (e um de criatura do mesmo sistema), com os atributos dele. */
  seedTemplates(system?: string) {
    const p = TEMPLATE_PRESETS.find((x) => x.name === system) ?? TEMPLATE_PRESETS[0];
    const main = this.createTemplate(p);
    this.createTemplate(creaturePreset(p));
    this.campaign.seeded = true;
    delete this.campaign.noAttrList;
    this.setSettings({ ...($state.snapshot(this.settings) as TableSettings), attributes: structuredClone(p.attributes ?? []), playerTemplateId: main.id });
  }

  /** Atualiza campanhas de versões antigas (atributos soltos, lista de atributos, modelo dos jogadores). */
  migrate() {
    const extra: AttributeDef[] = [];
    for (const t of Object.values(this.docs.templates)) {
      const m = migrateTemplate($state.snapshot(t) as SheetTemplate);
      if (!m) continue;
      extra.push(...m.defs);
      this.putDoc('templates', { ...m.template, updatedAt: Date.now() });
    }
    const settings = $state.snapshot(this.settings) as TableSettings;
    let changed = false;
    if (this.campaign.noAttrList) {
      settings.attributes = attributesUsedBy(Object.values($state.snapshot(this.docs.templates) as Record<string, SheetTemplate>), extra);
      delete this.campaign.noAttrList;
      changed = true;
    } else {
      for (const d of extra) {
        if (!settings.attributes.some((a) => a.id === d.id)) {
          settings.attributes.push(d);
          changed = true;
        }
      }
    }
    if (!settings.playerTemplateId || !this.docs.templates[settings.playerTemplateId]) {
      // O modelo mais usado pelas fichas dos jogadores (ou o primeiro que não é de criatura).
      const count = new Map<string, number>();
      for (const s of Object.values(this.docs.sheets)) if (s.kind === 'pc') count.set(s.templateId, (count.get(s.templateId) ?? 0) + 1);
      const ts = Object.values(this.docs.templates);
      const best = [...count].filter(([id]) => this.docs.templates[id]).sort((a, b) => b[1] - a[1])[0]?.[0];
      const pick = best ?? (ts.find((t) => t.name === 'Genérico') ?? ts.find((t) => !/criatura/i.test(t.name)) ?? ts[0])?.id;
      if (pick) {
        settings.playerTemplateId = pick;
        changed = true;
      }
    }
    if (changed) this.setSettings(settings);
  }

  /** Atributo novo na campanha: entra também nos modelos que escolhem atributos um a um. */
  addAttribute(label: string) {
    const l = label.trim().slice(0, 30);
    if (!l) return;
    const attrs = this.attrs;
    const taken = new Set([...attrs.map((a) => a.id), ...Object.values(this.docs.templates).flatMap((t) => t.fields.map((f) => f.id))]);
    const def = { id: fieldIdFromLabel(l, taken), label: l };
    for (const t of Object.values(this.docs.templates)) {
      if (!t.fields.some((f) => f.type === 'attrs' && f.attrs?.length)) continue;
      const copy = structuredClone($state.snapshot(t)) as SheetTemplate;
      for (const f of copy.fields) if (f.type === 'attrs' && f.attrs?.length) f.attrs.push(def.id);
      this.putDoc('templates', { ...copy, updatedAt: Date.now() });
    }
    this.setSettings({ ...($state.snapshot(this.settings) as TableSettings), attributes: [...attrs, def] });
  }

  createTemplate(base: Preset = TEMPLATE_PRESETS[0]): SheetTemplate {
    // Modelo pronto traz os atributos do sistema dele para a campanha (os que faltarem).
    const missing = (base.attributes ?? []).filter((d) => !this.attrs.some((a) => a.id === d.id));
    if (missing.length && this.campaign.seeded) {
      this.setSettings({ ...($state.snapshot(this.settings) as TableSettings), attributes: [...this.attrs, ...structuredClone(missing)] });
    }
    const plain = presetTemplate($state.snapshot(base) as Preset);
    const t: SheetTemplate = { ...plain, id: newItemId(), perm: structuredClone(TEMPLATE_PERM), updatedAt: Date.now() };
    this.putDoc('templates', t);
    return t;
  }

  saveTemplate(t: SheetTemplate) {
    this.putDoc('templates', structuredClone($state.snapshot(t)) as SheetTemplate);
  }

  deleteTemplate(id: string): boolean {
    const used = Object.values(this.docs.sheets).filter((s) => s.templateId === id).length;
    if (used) {
      this.toast(`Este modelo é usado por ${used} ficha(s). Apague ou troque essas fichas antes.`, 'error');
      return false;
    }
    this.removeDoc('templates', id);
    return true;
  }

  createSheet(o: { templateId: string; name: string; kind: Sheet['kind']; owner?: string }): Sheet | null {
    const t = this.docs.templates[o.templateId];
    if (!t) return null;
    const sheet: Sheet = {
      id: newItemId(),
      perm: SHEET_PERM(o.kind === 'pc' ? o.owner : undefined),
      updatedAt: Date.now(),
      templateId: t.id,
      name: o.name.trim() || 'Sem nome',
      kind: o.kind,
      values: defaultValues($state.snapshot(t) as SheetTemplate, this.attrs),
    };
    this.putDoc('sheets', sheet);
    return sheet;
  }

  duplicateSheet(id: string) {
    const src = this.docs.sheets[id];
    if (!src) return;
    const copy = structuredClone($state.snapshot(src)) as Sheet;
    this.putDoc('sheets', { ...copy, id: newItemId(), name: `${copy.name} (cópia)` });
  }

  deleteSheet(id: string) {
    this.removeDoc('sheets', id);
    this.closeSheet(id);
    if (this.combat.entries.some((e) => e.sheetId === id)) {
      this.combat.entries = this.combat.entries.map((e) => (e.sheetId === id ? { ...e, sheetId: undefined } : e));
      this.broadcastCombat();
    }
  }

  private playerNewSheet(actor: Actor, _templateId: string, name: string) {
    if (!this.settings.allowPlayerSheets) return this.notify(actor, 'O mestre não permite criar fichas nesta mesa.');
    // O jogador não escolhe o modelo: usa o que o mestre definiu na aba Mesa.
    const t = this.docs.templates[this.settings.playerTemplateId ?? ''];
    if (!t) return this.notify(actor, 'O mestre ainda não escolheu o modelo das fichas.');
    const owned = Object.values(this.docs.sheets).filter((s) => s.perm.owner === actor.pid).length;
    if (owned >= MAX_PLAYER_SHEETS) return this.notify(actor, `Limite de ${MAX_PLAYER_SHEETS} fichas por jogador.`);
    const f = applyFilter(this.filter, name, this.wf);
    if (!f.ok) return this.notify(actor, f.reason);
    const s = this.createSheet({ templateId: t.id, name: f.text, kind: 'pc', owner: actor.pid });
    if (s) this.toast(`${this.nameOf(actor.pid)} criou a ficha "${s.name}".`);
  }

  private applySheetSet(actor: Actor, id: string, values: Record<string, FieldValue>, name?: string) {
    const sheet = this.docs.sheets[id];
    if (!sheet) return;
    if (!this.canEditDoc(actor, sheet)) {
      this.notify(actor, 'Você não tem permissão para editar esta ficha.');
      if (actor.role === 'player' && can(actor, 'view', sheet)) {
        this.sendTo(actor.pid, { k: 'doc', col: 'sheets', doc: $state.snapshot(sheet) as Sheet });
      }
      return;
    }
    const t = this.templateOf(sheet);
    if (!t) return;
    const clean = sanitizeValues($state.snapshot(t) as SheetTemplate, values, this.attrs);
    if (!clean) return;
    if (actor.role === 'player') {
      for (const [k, v] of Object.entries(clean)) {
        if (typeof v !== 'string' || !v) continue;
        const f = applyFilter(this.filter, v, this.wf);
        if (!f.ok) return this.notify(actor, f.reason);
        clean[k] = f.text;
      }
      if (name) {
        const f = applyFilter(this.filter, name, this.wf);
        if (!f.ok) return this.notify(actor, f.reason);
        name = f.text;
      }
    }
    Object.assign(sheet.values, clean);
    if (name) sheet.name = name.slice(0, 60);
    sheet.updatedAt = Date.now();
    this.saveDoc('sheets', id);
    this.broadcastDoc('sheets', id);
    if (name && this.combat.entries.some((e) => e.sheetId === id)) {
      this.combat.entries = this.combat.entries.map((e) => (e.sheetId === id ? { ...e, name: sheet.name } : e));
      this.broadcastCombat();
    }
  }

  /** Atributos que existem nesta campanha (definidos pelo mestre na aba Mesa). */
  private get attrs(): AttributeDef[] {
    return $state.snapshot(this.settings.attributes ?? []) as AttributeDef[];
  }

  private formula(actor: Actor, sheet: Sheet, formula: string, fieldId?: string): string | null {
    try {
      const t = $state.snapshot(this.templateOf(sheet)!) as SheetTemplate;
      return resolveFormula(formula, $state.snapshot(sheet) as Sheet, t, fieldId, this.attrs);
    } catch (e) {
      this.notify(actor, e instanceof FormulaError ? `Fórmula inválida: ${e.message}` : 'Fórmula inválida');
      return null;
    }
  }

  private doSheetRoll(actor: Actor, id: string, field: string, priv: boolean, rowId?: string) {
    const sheet = this.docs.sheets[id];
    if (!sheet || !can(actor, 'view', sheet)) return;
    const t = this.templateOf(sheet);
    const f = t?.fields.find((x) => x.id === field);
    if (!f) {
      // Atributo da campanha: rola com a fórmula do bloco de atributos do modelo.
      const a = t && templateAttrs($state.snapshot(t) as SheetTemplate, this.attrs).find((x) => x.def.id === field);
      if (!a?.block.roll) return;
      const expr = this.formula(actor, sheet, a.block.roll, a.def.id);
      if (expr) this.doRoll(actor, expr, priv, `${sheet.name}: ${a.def.label}`);
      return;
    }
    if (rowId) {
      // Rolagem de uma linha da lista (item, poder...), não do campo inteiro.
      if (f.type !== 'list') return;
      const rows = sheet.values[field];
      const row = Array.isArray(rows) ? (rows as ListRow[]).find((r) => r.id === rowId) : undefined;
      if (!row?.roll) return;
      const expr = this.formula(actor, sheet, row.roll);
      if (expr) this.doRoll(actor, expr, priv, `${sheet.name}: ${row.name}`);
      return;
    }
    if (!f.roll) return;
    const expr = this.formula(actor, sheet, f.roll, f.id);
    if (expr) this.doRoll(actor, expr, priv, `${sheet.name}: ${f.label}`);
  }

  private doInitRoll(actor: Actor, sheetId: string) {
    const sheet = this.docs.sheets[sheetId];
    if (!sheet || !this.canEditDoc(actor, sheet)) return this.notify(actor, 'Você só pode rolar iniciativa das suas fichas.');
    const t = this.templateOf(sheet);
    if (!t?.initiative) return this.notify(actor, 'O modelo desta ficha não tem fórmula de iniciativa.');
    const expr = this.formula(actor, sheet, t.initiative);
    if (!expr) return;
    const secret = actor.role === 'gm' && sheet.kind !== 'pc';
    const roll = this.doRoll(actor, expr, secret, `${sheet.name}: Iniciativa`);
    if (roll) this.upsertCombatant(sheet, roll.total);
  }

  private upsertCombatant(sheet: Sheet, init: number) {
    const entries = $state.snapshot(this.combat.entries) as CombatEntry[];
    const e = entries.find((x) => x.sheetId === sheet.id && !x.tokenId);
    if (e) e.init = init;
    else entries.push({ id: newItemId(), name: sheet.name, init, sheetId: sheet.id });
    this.combat.entries = sortEntries(entries, this.settings.initiativeOrder);
    this.broadcastCombat();
  }

  // ---------- combate (só o mestre) ----------

  private setCombat(c: Combat) {
    this.combat = c;
    this.broadcastCombat();
  }

  private combatCopy(): Combat {
    return $state.snapshot(this.combat) as Combat;
  }

  combatStart() {
    const c = this.combatCopy();
    this.setCombat({ ...c, active: true, round: 1, current: c.entries[0]?.id });
  }

  combatEnd() {
    this.setCombat({ ...this.combatCopy(), active: false, round: 1, current: undefined });
  }

  combatClear() {
    this.setCombat({ active: false, round: 1, entries: [] });
  }

  combatStep(dir: 1 | -1) {
    this.setCombat(stepTurn(this.combatCopy(), dir));
  }

  combatAddSheets(ids: string[]) {
    const c = this.combatCopy();
    for (const id of ids) {
      const s = this.docs.sheets[id];
      if (s && !c.entries.some((e) => e.sheetId === id && !e.tokenId)) c.entries.push({ id: newItemId(), name: s.name, init: 0, sheetId: id });
    }
    this.setCombat({ ...c, entries: sortEntries(c.entries, this.settings.initiativeOrder) });
  }

  /** Tokens de inimigo entram no combate com o próprio nome e a própria vida. */
  combatAddTokens(ids: string[]) {
    const c = this.combatCopy();
    for (const id of ids) {
      const t = this.items.get(id);
      if (!t || t.type !== 'token' || c.entries.some((e) => e.tokenId === id)) continue;
      c.entries.push({ id: newItemId(), name: t.name ?? 'Inimigo', init: 0, tokenId: id, ...(t.sheetId ? { sheetId: t.sheetId } : {}) });
    }
    this.setCombat({ ...c, entries: sortEntries(c.entries, this.settings.initiativeOrder) });
  }

  /** Menu do token: entra no combate e rola a iniciativa da ficha (em segredo). */
  tokenToCombat(tokenId: string) {
    const t = this.items.get(tokenId);
    if (!t) return;
    const sheet = t.sheetId ? this.docs.sheets[t.sheetId] : undefined;
    // PJ e NPC entram pela ficha (um token só); inimigos entram por token.
    if (sheet && sheet.kind !== 'monster') {
      if (this.templateOf(sheet)?.initiative) this.doInitRoll(this.actor, sheet.id);
      else this.combatAddSheets([sheet.id]);
      return;
    }
    this.combatAddTokens([tokenId]);
    const e = this.combat.entries.find((x) => x.tokenId === tokenId);
    if (e) this.rollTokenInit(tokenId, e.id);
  }

  private rollTokenInit(tokenId: string, entryId: string) {
    const t = this.items.get(tokenId);
    const sheet = t?.sheetId ? this.docs.sheets[t.sheetId] : undefined;
    const tpl = sheet && this.templateOf(sheet);
    const expr = sheet && tpl?.initiative ? this.formula(this.actor, sheet, tpl.initiative) : '1d20';
    if (!expr) return;
    const roll = this.doRoll(this.actor, expr, true, `${t?.name ?? 'Inimigo'}: Iniciativa`);
    if (roll) this.combatUpdate(entryId, { init: roll.total });
  }

  /** Vida própria de um token de inimigo. */
  setTokenHp(id: string, cur: number, max: number) {
    const t = this.items.get(id);
    if (!t) return;
    const m = Math.max(0, Math.round(max));
    this.updateItem(id, { hp: { cur: Math.max(-999, Math.min(m, Math.round(cur))), max: m } });
  }

  combatAddManual(name: string, init: number, hidden: boolean) {
    const c = this.combatCopy();
    c.entries.push({ id: newItemId(), name: name.trim() || 'Criatura', init, ...(hidden ? { hidden: true } : {}) });
    this.setCombat({ ...c, entries: sortEntries(c.entries, this.settings.initiativeOrder) });
  }

  combatUpdate(id: string, patch: Partial<Pick<CombatEntry, 'name' | 'init' | 'hidden'>>) {
    const c = this.combatCopy();
    const e = c.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    if (!e.hidden) delete e.hidden;
    this.setCombat({ ...c, entries: patch.init !== undefined ? sortEntries(c.entries, this.settings.initiativeOrder) : c.entries });
  }

  combatRemove(id: string) {
    const c = this.combatCopy();
    const idx = c.entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    let current = c.current;
    if (current === id) current = c.entries[(idx + 1) % c.entries.length]?.id;
    c.entries.splice(idx, 1);
    this.setCombat({ ...c, current: c.entries.length && current !== id ? current : undefined });
  }

  /** Rola iniciativa (em segredo) para todas as entradas que não são de jogadores. */
  combatRollNpcs() {
    for (const e of this.combatCopy().entries) {
      const s = e.sheetId ? this.docs.sheets[e.sheetId] : undefined;
      if (s && s.kind === 'pc') continue;
      if (e.tokenId && s && this.templateOf(s)?.initiative) {
        this.rollTokenInit(e.tokenId, e.id);
      } else if (s && s.kind !== 'pc' && this.templateOf(s)?.initiative) {
        this.doInitRoll(this.actor, s.id);
      } else {
        const roll = this.doRoll(this.actor, '1d20', true, `${e.name}: Iniciativa`);
        if (roll) this.combatUpdate(e.id, { init: roll.total });
      }
    }
  }

  setSettings(settings: TableSettings) {
    const reorder = settings.initiativeOrder !== this.settings.initiativeOrder;
    const hpChanged = !!settings.showNpcHp !== !!this.settings.showNpcHp;
    this.settings = settings;
    this.saveCampaign();
    this.broadcast({ k: 'settings', settings: $state.snapshot(this.settings) });
    if (hpChanged) for (const i of this.items.values()) if (i.type === 'token') this.broadcastItem(i);
    if (reorder) {
      const c = this.combatCopy();
      this.setCombat({ ...c, entries: sortEntries(c.entries, settings.initiativeOrder) });
    }
  }

  // métodos da interface comum
  newSheet(templateId: string, name: string) {
    this.createSheet({ templateId, name, kind: 'npc' });
  }

  setSheet(id: string, values: Record<string, FieldValue>, name?: string) {
    this.applySheetSet(this.actor, id, values, name);
  }

  rollSheet(id: string, field: string, priv: boolean, row?: string) {
    this.doSheetRoll(this.actor, id, field, priv, row);
  }

  rollInitiative(sheetId: string) {
    this.doInitRoll(this.actor, sheetId);
  }

  // ---------- mapa: tokens, camadas, grid, névoa, régua e ping ----------

  private cellSize() {
    return this.map.grid.size || 70;
  }

  addToken(x: number, y: number, o: { name?: string; sheetId?: string; img?: string; cells?: number } = {}) {
    const sheet = o.sheetId ? this.docs.sheets[o.sheetId] : undefined;
    const size = (o.cells ?? 1) * this.cellSize();
    const owner = sheet?.perm.owner;
    const perm: Perm = owner
      ? { view: 'all', move: 'owner', edit: 'owner', owner }
      : { view: 'all', move: 'gm', edit: 'gm' };
    let pos = { x: x - size / 2, y: y - size / 2 };
    if (this.map.grid.enabled && this.map.grid.snap) pos = snapToGrid(pos.x, pos.y, size, size, this.map.grid);
    return this.addItem({
      type: 'token', ...pos, w: size, h: size, perm,
      name: o.name ?? sheet?.name ?? 'Token', sheetId: sheet?.id, img: o.img, conditions: [],
    });
  }

  /**
   * Põe a ficha no mapa. PJ e NPC têm um token só (se já existe, devolve ele);
   * cada clique num inimigo cria um token novo, numerado e com a vida cheia.
   */
  placeSheet(sheetId: string, x: number, y: number): { item: BoardItem; existing: boolean } | null {
    const sheet = this.docs.sheets[sheetId];
    if (!sheet) return null;
    const tokens = [...this.items.values()].filter((i) => i.type === 'token' && i.sheetId === sheetId);
    if (sheet.kind !== 'monster') {
      if (tokens[0]) return { item: tokens[0], existing: true };
      return { item: this.addToken(x, y, { sheetId }), existing: false };
    }
    const names = new Set(tokens.map((t) => t.name));
    let n = tokens.length + 1;
    while (names.has(`${sheet.name} ${n}`)) n++;
    const hp = hpOf(sheet, this.templateOf(sheet));
    const item = this.addToken(x, y, { sheetId, name: `${sheet.name} ${n}` });
    if (hp) this.updateItem(item.id, { hp: { cur: hp.max, max: hp.max } });
    return { item, existing: false };
  }

  async setTokenImage(id: string, file: Blob) {
    const item = this.items.get(id);
    if (!item) return;
    try {
      const img = await processImage(file);
      await this.images.save(img);
      item.img = img.hash;
      this.bump();
      this.broadcastItem(item);
      this.saveBoard();
    } catch (e) {
      this.toast(`Não consegui usar a imagem: ${(e as Error).message}`, 'error');
    }
  }

  /** Mudanças do mestre em qualquer campo do item (camada, trava, ficha ligada...). */
  updateItem(id: string, patch: Partial<BoardItem>) {
    const item = this.items.get(id);
    if (!item) return;
    Object.assign(item, patch);
    for (const k of Object.keys(patch) as (keyof BoardItem)[]) if (patch[k] === undefined) delete item[k];
    this.bump();
    this.broadcastItem(item);
    this.saveBoard();
  }

  setLayer(id: string, layer: Layer) {
    this.updateItem(id, { layer, z: this.maxZ() + 1 });
  }

  private broadcastMap() {
    this.broadcast({ k: 'map', map: $state.snapshot(this.map) });
    this.saveBoard();
  }

  setGrid(grid: GridSettings) {
    this.map.grid = grid;
    this.bump();
    this.broadcastMap();
  }

  setFogEnabled(enabled: boolean) {
    this.map.fog.enabled = enabled;
    this.broadcastMap();
  }

  addFog(shape: FogShape) {
    const s: FogShape = shape.kind === 'brush' ? { ...shape, pts: simplifyStroke(shape.pts, (shape.r ?? 40) / 3) } : shape;
    if (s.kind === 'all') {
      this.map.fog.shapes = [s];
      this.broadcastMap();
      return;
    }
    this.map.fog.shapes.push(s);
    this.broadcast({ k: 'fogAdd', shape: s });
    this.saveBoard();
  }

  sendRuler(pts: number[] | null) {
    this.broadcast({ k: 'ruler', pid: 'gm', pts });
  }

  private ping2(pid: string, x: number, y: number) {
    this.onPing(pid, x, y);
    this.broadcast({ k: 'ping', pid, x, y });
  }

  ping(x: number, y: number) {
    this.ping2('gm', x, y);
  }

  // ---------- imagem do personagem ----------

  private receiveAvatar(actor: Actor, sheetId: string, i: number, n: number, data: string) {
    // Só o mestre põe imagens (inclusive nas fichas dos jogadores).
    if (actor.role !== 'gm') return this.notify(actor, 'Só o mestre muda a imagem do personagem.');
    const sheet = this.docs.sheets[sheetId];
    if (!sheet) return;
    const key = `${actor.pid}:${sheetId}`;
    let p = this.avatarParts.get(key);
    if (!p || p.n !== n) {
      p = { n, got: new Array(n), count: 0, bytes: 0 };
      this.avatarParts.set(key, p);
    }
    if (p.got[i]) return;
    const chunk = fromBase64(data);
    p.bytes += chunk.length;
    if (p.bytes > MAX_AVATAR_BYTES) {
      this.avatarParts.delete(key);
      return this.notify(actor, 'Imagem grande demais.');
    }
    p.got[i] = chunk;
    p.count++;
    if (p.count < p.n) return;
    this.avatarParts.delete(key);
    void this.applyAvatar(actor, sheetId, new Blob(p.got));
  }

  /** Recodifica a imagem (descarta o que não for imagem), salva e liga à ficha. */
  private async applyAvatar(actor: Actor, sheetId: string, blob: Blob) {
    try {
      const img = await processImage(blob, AVATAR_SIDE);
      await this.images.save(img);
      const sheet = this.docs.sheets[sheetId];
      if (!sheet) return;
      sheet.avatar = img.hash;
      this.putDoc('sheets', sheet);
      this.notify(actor, 'Imagem do personagem atualizada.');
    } catch {
      this.notify(actor, 'Essa imagem não pôde ser usada.');
    }
  }

  async setAvatar(sheetId: string, file: Blob) {
    await this.applyAvatar(this.actor, sheetId, file);
  }

  // ---------- ferramentas do mestre: relógios, diário, wiki, tabelas ----------

  addClock(x: number, y: number) {
    return this.addItem({ type: 'clock', x: x - 80, y: y - 80, w: 160, h: 160, title: 'Relógio', segments: 6, filled: 0 });
  }

  /** Avança (+1) ou volta (-1) um relógio. */
  tickClock(id: string, delta: number) {
    const item = this.items.get(id);
    if (!item || item.type !== 'clock') return;
    this.edit(id, { filled: Math.max(0, Math.min(item.segments ?? 6, (item.filled ?? 0) + delta)) });
  }

  seedTables() {
    for (const t of DEFAULT_TABLES) this.createTable(t);
    this.campaign.seededTables = true;
    this.saveCampaign();
  }

  createTable(base: Omit<RandomTable, 'id' | 'perm' | 'updatedAt'> = { name: 'Nova tabela', rows: [{ w: 1, text: 'Resultado' }] }) {
    const t: RandomTable = { ...structuredClone(base), id: newItemId(), perm: structuredClone(TABLE_PERM), updatedAt: Date.now() };
    this.putDoc('tables', t);
    return t;
  }

  saveTable(t: RandomTable) {
    this.putDoc('tables', structuredClone($state.snapshot(t)) as RandomTable);
  }

  private doTableRoll(actor: Actor, id: string, priv: boolean) {
    const t = this.docs.tables[id];
    if (!t || !can(actor, 'view', t)) return;
    const all = Object.values($state.snapshot(this.docs.tables) as Record<string, RandomTable>);
    const byName = (n: string) => all.find((x) => x.name.trim().toLowerCase() === n.toLowerCase());
    const text = rollRandomTable($state.snapshot(t) as RandomTable, byName);
    this.addLog({ from: actor.pid, kind: 'table', label: t.name, text, to: priv ? [] : undefined });
  }

  rollTable(id: string, priv: boolean) {
    this.doTableRoll(this.actor, id, priv);
  }

  createJournal(): JournalEntry {
    const date = todayKey();
    const n = Object.values(this.docs.journal).length + 1;
    const e: JournalEntry = {
      id: newItemId(), perm: structuredClone(NOTE_PERM), updatedAt: Date.now(),
      title: `Sessão ${n}`, date, text: '',
    };
    this.putDoc('journal', e);
    return e;
  }

  /** Texto do chat (só o público) do dia da sessão, para começar o resumo. */
  journalDraft(date: string): string {
    return logToJournal($state.snapshot(this.log).filter((e) => todayKey(new Date(e.ts)) === date));
  }

  createWiki(title = 'Nova página'): WikiPage {
    const p: WikiPage = { id: newItemId(), perm: structuredClone(NOTE_PERM), updatedAt: Date.now(), title: title.slice(0, 120), text: '', tags: [] };
    this.putDoc('wiki', p);
    return p;
  }

  setNoteDate(id: string, date: string) {
    const e = this.docs.journal[id];
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    e.date = date;
    this.saveDoc('journal', id);
    this.broadcastDoc('journal', id);
  }

  setWikiTags(id: string, tags: string[]) {
    const p = this.docs.wiki[id];
    if (!p) return;
    p.tags = tags.map((t) => t.trim().slice(0, 30)).filter(Boolean).slice(0, 12);
    this.saveDoc('wiki', id);
    this.broadcastDoc('wiki', id);
  }

  private applyNoteEdit(actor: Actor, col: 'journal' | 'wiki', id: string, patch: { title?: string; text?: string }) {
    const d = this.docs[col][id];
    if (!d) return;
    if (!this.canEditDoc(actor, d)) {
      this.notify(actor, 'Você não tem permissão para editar esta página.');
      if (actor.role === 'player' && can(actor, 'view', d)) this.sendTo(actor.pid, { k: 'doc', col, doc: $state.snapshot(d) as AnyDoc });
      return;
    }
    const clean: { title?: string; text?: string } = {};
    if (patch.title !== undefined) clean.title = patch.title.slice(0, 120);
    if (patch.text !== undefined) clean.text = patch.text.slice(0, MAX_NOTE_TEXT);
    if (actor.role === 'player') {
      for (const k of ['title', 'text'] as const) {
        const v = clean[k];
        if (!v) continue;
        const f = applyFilter(this.filter, v, this.wf);
        if (!f.ok) return this.notify(actor, f.reason);
        clean[k] = f.text;
      }
    }
    Object.assign(d, clean);
    d.updatedAt = Date.now();
    this.saveDoc(col, id);
    this.broadcastDoc(col, id);
  }

  editNote(col: 'journal' | 'wiki', id: string, patch: { title?: string; text?: string }) {
    this.applyNoteEdit(this.actor, col, id, patch);
  }

  // ---------- persistência ----------

  // ---------- desfazer / refazer ----------

  private boardShadow(): Map<string, string> {
    return new Map([...this.items.values()].map((i) => [i.id, JSON.stringify(i)]));
  }

  private takeShadow() {
    this.shadow = this.boardShadow();
    this.shadowMap = JSON.stringify($state.snapshot(this.map));
  }

  /** Compara com o último retrato; se a mudança foi do mestre, vira um passo do desfazer. */
  private recordHistory() {
    const next = this.boardShadow();
    const nextMap = JSON.stringify($state.snapshot(this.map));
    if (!this.byPlayer && !this.restoring) {
      const change: BoardChange = { items: diffBoard(this.shadow, next) };
      if (nextMap !== this.shadowMap) change.map = { before: this.shadowMap, after: nextMap };
      this.history.push(change);
    }
    this.shadow = next;
    this.shadowMap = nextMap;
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
  }

  private applyChange(c: BoardChange, side: 'before' | 'after') {
    for (const e of c.items) {
      const v = e[side];
      if (v === null) {
        if (this.items.delete(e.id)) this.broadcast({ k: 'remove', id: e.id });
      } else {
        const item = JSON.parse(v) as BoardItem;
        this.items.set(item.id, item);
        this.broadcastItem(item);
      }
    }
    if (c.map) {
      this.map = JSON.parse(c.map[side]) as MapSettings;
      this.broadcast({ k: 'map', map: $state.snapshot(this.map) });
    }
    this.bump();
    this.restoring = true;
    try {
      this.saveBoard();
    } finally {
      this.restoring = false;
    }
  }

  undo() {
    const c = this.history.undo();
    if (c) this.applyChange(c, 'before');
    else this.toast('Nada para desfazer.');
  }

  redo() {
    const c = this.history.redo();
    if (c) this.applyChange(c, 'after');
    else this.toast('Nada para refazer.');
  }

  private saveBoard() {
    this.recordHistory();
    this.saver.schedule('quadro', () =>
      this.store.writeText(
        PATHS.board,
        JSON.stringify(
          { version: 1, items: [...this.items.values()], map: { ...$state.snapshot(this.map), fog: { ...this.map.fog, shapes: compactFog($state.snapshot(this.map.fog.shapes)) } } },
          null,
          1,
        ),
      ),
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
        settings: $state.snapshot(this.settings),
      };
      delete c.noAttrList;
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
