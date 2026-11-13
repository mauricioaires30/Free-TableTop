// Formato dos arquivos da campanha na pasta do mestre.
import {
  DEFAULT_FILTER, newGmKey, newInvite, newRoomId,
  type BoardItem, type FilterConfig, type LogEntry, type Roster,
} from '@ftt/shared';
import type { CampaignStore } from './store';

export interface CampaignFile {
  app: 'free-tabletop';
  version: 1;
  name: string;
  roomId: string;
  /** Segredo que prova ao relay que este é o mestre da sala. Não compartilhe este arquivo. */
  gmKey: string;
  invite: string;
  filter: FilterConfig;
  roster: Roster;
  createdAt: number;
}

export interface BoardFile {
  version: 1;
  items: BoardItem[];
}

export const PATHS = {
  campaign: 'campanha.json',
  board: 'quadro.json',
  logDir: 'log',
  imageDir: 'imagens',
};

export function newCampaign(name: string): CampaignFile {
  return {
    app: 'free-tabletop',
    version: 1,
    name: name.trim() || 'Nova campanha',
    roomId: newRoomId(),
    gmKey: newGmKey(),
    invite: newInvite(),
    filter: structuredClone(DEFAULT_FILTER),
    roster: {},
    createdAt: Date.now(),
  };
}

export async function readCampaign(store: CampaignStore): Promise<CampaignFile | null> {
  const txt = await store.readText(PATHS.campaign);
  if (!txt) return null;
  const c = JSON.parse(txt) as CampaignFile;
  if (c.app !== 'free-tabletop' || !c.roomId || !c.gmKey) throw new Error('campanha.json inválido');
  c.filter ??= structuredClone(DEFAULT_FILTER);
  c.roster ??= {};
  return c;
}

export async function readBoard(store: CampaignStore): Promise<BoardItem[]> {
  const txt = await store.readText(PATHS.board);
  if (!txt) return [];
  const DEF = { note: [220, 180], card: [260, 340], image: [300, 300] } as const;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return ((JSON.parse(txt) as BoardFile).items ?? [])
    .filter((i) => i && typeof i.id === 'string' && i.type in DEF && i.perm)
    .map((i) => ({
      ...i,
      x: num(i.x, 0),
      y: num(i.y, 0),
      w: Math.max(30, num(i.w, DEF[i.type][0])),
      h: Math.max(30, num(i.h, DEF[i.type][1])),
      rotation: num(i.rotation, 0),
      z: num(i.z, 0),
    }));
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Lê os logs mais recentes até `limit` entradas. Retorna também as entradas de hoje (que serão regravadas). */
export async function readRecentLog(store: CampaignStore, limit = 300): Promise<{ recent: LogEntry[]; today: LogEntry[] }> {
  const files = (await store.list(PATHS.logDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse();
  const recent: LogEntry[] = [];
  let today: LogEntry[] = [];
  for (const f of files) {
    const txt = (await store.readText(`${PATHS.logDir}/${f}`)) ?? '';
    const entries = txt
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as LogEntry];
        } catch {
          return [];
        }
      });
    if (f === `${todayKey()}.jsonl`) today = entries;
    recent.unshift(...entries);
    if (recent.length >= limit) break;
  }
  return { recent: recent.slice(-limit), today };
}

/** Agrupa gravações: cada chave é salva no máximo uma vez a cada `delay` ms. */
export class Saver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, () => Promise<void>>();
  pendingCount = 0;
  onChange?: (saving: boolean, error?: string) => void;

  constructor(private delay = 700) {}

  schedule(key: string, fn: () => Promise<void>) {
    this.pending.set(key, fn);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.run(key), this.delay));
    this.onChange?.(true);
  }

  private async run(key: string) {
    const fn = this.pending.get(key);
    this.pending.delete(key);
    this.timers.delete(key);
    if (!fn) return;
    try {
      await fn();
      this.onChange?.(this.pending.size > 0);
    } catch (e) {
      console.error('Falha ao salvar', key, e);
      this.onChange?.(this.pending.size > 0, `Falha ao salvar ${key}: ${(e as Error).message}`);
    }
  }

  async flush() {
    await Promise.all([...this.pending.keys()].map((k) => {
      clearTimeout(this.timers.get(k));
      return this.run(k);
    }));
  }
}
