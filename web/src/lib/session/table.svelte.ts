// Estado comum da mesa (mestre e jogador) usado pela interface.
import {
  can, COLLECTIONS, DEFAULT_FILTER, DEFAULT_SETTINGS, EMPTY_COMBAT,
  type Action, type Actor, type BoardItem, type Collection, type Combat, type DocMap, type EditPatch, type FieldValue,
  type FilterConfig, type LogEntry, type Peer, type Roster, type Sheet, type SheetTemplate, type TableSettings,
  type TransformPatch,
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

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export const MAX_LOG = 500;

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
  /** Fichas abertas como janelas sobre o quadro (só interface). */
  openSheets = $state<string[]>([]);

  items = new Map<string, BoardItem>();
  cursors = new Map<string, CursorState>();
  /** O quadro registra aqui como centralizar a visão ("trazer todos para cá"). */
  focusHandler: ((x: number, y: number, scale: number) => void) | null = null;

  get actor(): Actor {
    return { role: this.role, pid: this.myPid };
  }

  can(action: Action, item: BoardItem): boolean {
    return can(this.actor, action, item);
  }

  nameOf(pid: string): string {
    if (pid === 'gm') return 'Mestre';
    return this.roster[pid]?.name ?? this.peers.find((p) => p.pid === pid)?.name ?? 'Jogador';
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

  maxZ(): number {
    let z = 0;
    for (const i of this.items.values()) z = Math.max(z, i.z);
    return z;
  }

  abstract chat(text: string): boolean;
  abstract roll(expr: string, priv: boolean, label?: string): void;
  abstract transform(id: string, patch: TransformPatch, final: boolean): void;
  abstract edit(id: string, patch: EditPatch): void;
  abstract zorder(id: string, dir: 'front' | 'back'): void;
  abstract newSheet(templateId: string, name: string): void;
  abstract setSheet(id: string, values: Record<string, FieldValue>, name?: string): void;
  abstract rollSheet(id: string, field: string, priv: boolean): void;
  abstract rollInitiative(sheetId: string): void;
  sendCursor(_x: number, _y: number): void {}
  abstract destroy(): void;
}
