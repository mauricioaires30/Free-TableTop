// Estado comum da mesa (mestre e jogador) usado pela interface.
import {
  can, COLLECTIONS, DEFAULT_FILTER, WordFilter, DEFAULT_MAP, DEFAULT_SETTINGS, EMPTY_COMBAT, playerOwnsItem,
  type Action, type Actor, type BoardItem, type Collection, type Combat, type DocMap, type EditPatch, type FieldValue,
  type FilterConfig, type LogEntry, type Peer, type Roster, type Sheet, type SheetTemplate, type TableSettings,
  type MapSettings, type TransformPatch,
} from '@ftt/shared';
import type { NetStatus } from '../net/client';
import type { ImageSource } from '../images/images';

export interface CursorState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  last: number;
}

export interface Ruler {
  pts: number[];
  last: number;
}

export interface Ping {
  pid: string;
  x: number;
  y: number;
  start: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export const MAX_LOG = 500;

const HIDE_KEY = 'ftt-esconder-palavroes';
function readHidePref(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) !== '0';
  } catch {
    return true;
  }
}

export type Docs = { [C in Collection]: Record<string, DocMap[C]> };
export const emptyDocs = (): Docs => Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as Docs;
let toastSeq = 0;

export abstract class TableSession {
  abstract readonly role: 'gm' | 'player';
  abstract readonly myPid: string;
  abstract readonly images: ImageSource;

  status = $state<NetStatus>('connecting');
  statusError = $state('');
  gmOnline = $state(false);
  peers = $state<Peer[]>([]);
  log = $state<LogEntry[]>([]);
  roster = $state<Roster>({});
  campaignName = $state('');
  filter = $state<FilterConfig>(structuredClone(DEFAULT_FILTER));
  /** Incrementado a cada mudança no quadro (o quadro em si fica fora do estado reativo, por desempenho). */
  itemsVersion = $state(0);
  toasts = $state<Toast[]>([]);
  docs = $state<Docs>(emptyDocs());
  combat = $state<Combat>(structuredClone(EMPTY_COMBAT));
  settings = $state<TableSettings>({ ...DEFAULT_SETTINGS });
  map = $state<MapSettings>(structuredClone(DEFAULT_MAP));
  /** Réguas e pings dos outros (desenhados pelo quadro, fora do estado reativo). */
  rulers = new Map<string, Ruler>();
  pings: Ping[] = [];
  /** Desfazer/refazer do quadro. */
  canUndo = $state(false);
  canRedo = $state(false);
  /** Fichas abertas como janelas sobre o quadro (só interface). */
  openSheets = $state<string[]>([]);
  /** Páginas do diário/wiki abertas como janelas. */
  openNotes = $state<Array<{ col: 'journal' | 'wiki'; id: string }>>([]);

  items = new Map<string, BoardItem>();
  cursors = new Map<string, CursorState>();
  /** O quadro registra aqui como centralizar a visão ("trazer todos para cá"). */
  focusHandler: ((x: number, y: number, scale: number) => void) | null = null;
  /** O quadro registra aqui como recarregar uma imagem que mudou. */
  imageHandler: ((hash: string) => void) | null = null;
  /** Sobe quando alguma imagem muda (retratos se atualizam). */
  imagesVersion = $state(0);

  protected imageChanged(hash: string) {
    this.imageHandler?.(hash);
    this.imagesVersion++;
  }

  get actor(): Actor {
    return { role: this.role, pid: this.myPid };
  }

  can(action: Action, item: BoardItem): boolean {
    if (action === 'view') return can(this.actor, 'view', item);
    // Só o mestre mexe nos objetos do quadro; cada jogador mexe só no próprio token.
    return this.role === 'gm' || playerOwnsItem(this.myPid, item);
  }

  nameOf(pid: string): string {
    if (pid === 'gm') return 'Mestre';
    return this.roster[pid]?.name ?? this.peers.find((p) => p.pid === pid)?.name ?? 'Jogador';
  }

  /** Preferência desta pessoa (fica neste navegador): esconder palavrões com ****. */
  hideBadWords = $state(readHidePref());
  private cleanCache: { key: string; wf: WordFilter } | null = null;

  setHideBadWords(v: boolean) {
    this.hideBadWords = v;
    try {
      localStorage.setItem(HIDE_KEY, v ? '1' : '0');
    } catch {
      /* sem armazenamento: vale só nesta aba */
    }
  }

  /** Texto como esta pessoa quer ver (palavrões escondidos ou não). */
  clean(text: string): string {
    if (!this.hideBadWords || !text) return text;
    const words = this.filter.words;
    const key = words.join('|');
    if (this.cleanCache?.key !== key) this.cleanCache = { key, wf: new WordFilter(words) };
    return this.cleanCache.wf.censor(text);
  }

  isOnline(pid: string): boolean {
    return this.peers.some((p) => p.pid === pid);
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = ++toastSeq;
    this.toasts.push({ id, text, kind });
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }

  protected bump() {
    this.itemsVersion++;
  }

  protected pushLog(entry: LogEntry) {
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  protected onCursor(pid: string, x: number, y: number) {
    const c = this.cursors.get(pid);
    if (c) {
      c.tx = x;
      c.ty = y;
      c.last = performance.now();
    } else {
      this.cursors.set(pid, { x, y, tx: x, ty: y, last: performance.now() });
    }
  }

  protected onPresence(gmOnline: boolean, peers: Peer[]) {
    this.gmOnline = gmOnline;
    this.peers = peers;
    const online = new Set(peers.map((p) => p.pid));
    for (const pid of this.cursors.keys()) if (!online.has(pid)) this.cursors.delete(pid);
  }

  templateOf(sheet: Sheet): SheetTemplate | undefined {
    return this.docs.templates[sheet.templateId];
  }

  /** Fichas que eu posso editar (as "minhas"). */
  mySheets(): Sheet[] {
    return Object.values(this.docs.sheets).filter((s) => this.role !== 'gm' && can(this.actor, 'edit', s));
  }

  openSheet(id: string) {
    this.openSheets = [...this.openSheets.filter((x) => x !== id), id];
  }

  closeSheet(id: string) {
    this.openSheets = this.openSheets.filter((x) => x !== id);
  }

  openNote(col: 'journal' | 'wiki', id: string) {
    this.openNotes = [...this.openNotes.filter((n) => n.id !== id), { col, id }];
  }

  closeNote(id: string) {
    this.openNotes = this.openNotes.filter((n) => n.id !== id);
  }

  /** Página da wiki pelo título (sem diferenciar maiúsculas). */
  wikiByTitle(title: string) {
    const t = title.trim().toLowerCase();
    return Object.values(this.docs.wiki).find((p) => p.title.trim().toLowerCase() === t);
  }

  maxZ(): number {
    let z = 0;
    for (const i of this.items.values()) z = Math.max(z, i.z);
    return z;
  }

  abstract chat(text: string): boolean;
  abstract roll(expr: string, priv: boolean, label?: string): void;
  abstract transform(id: string, patch: TransformPatch, final: boolean): void;
  abstract undo(): void;
  abstract redo(): void;
  abstract edit(id: string, patch: EditPatch): void;
  abstract zorder(id: string, dir: 'front' | 'back'): void;
  abstract newSheet(templateId: string, name: string): void;
  abstract setSheet(id: string, values: Record<string, FieldValue>, name?: string): void;
  abstract rollSheet(id: string, field: string, priv: boolean, row?: string): void;
  abstract rollInitiative(sheetId: string): void;
  abstract editNote(col: 'journal' | 'wiki', id: string, patch: { title?: string; text?: string }): void;
  abstract rollTable(id: string, priv: boolean): void;
  /** Troca a imagem do personagem da ficha. */
  abstract setAvatar(sheetId: string, file: Blob): Promise<void>;
  abstract sendRuler(pts: number[] | null): void;
  abstract ping(x: number, y: number): void;
  sendCursor(_x: number, _y: number): void {}

  protected onRuler(pid: string, pts: number[] | null) {
    if (pid === this.myPid) return;
    if (pts) this.rulers.set(pid, { pts, last: performance.now() });
    else this.rulers.delete(pid);
  }

  protected onPing(pid: string, x: number, y: number) {
    this.pings.push({ pid, x, y, start: performance.now() });
    if (this.pings.length > 20) this.pings.shift();
  }
  abstract destroy(): void;
}
