// Formato dos arquivos da campanha na pasta do mestre.
import {
  COLLECTION_DIRS, DEFAULT_FILTER, DEFAULT_MAP, DEFAULT_SETTINGS, EMPTY_COMBAT, isFogShape, newGmKey, newInvite, newRoomId,
  type AnyDoc, type BoardItem, type Collection, type Combat, type FilterConfig, type LogEntry, type Roster,
  type MapSettings, type TableSettings,
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
  settings?: TableSettings;
  /** Já criou os modelos de ficha prontos (não recria se o mestre apagar todos). */
  seeded?: boolean;
  /** Já criou as tabelas aleatórias prontas. */
  seededTables?: boolean;
  /** Sistema (modelo pronto) escolhido ao criar a mesa. */
  system?: string;
  /** Só na leitura: o arquivo é de uma versão sem a lista de atributos salva. */
  noAttrList?: boolean;
}

export interface BoardFile {
  version: 1;
  items: BoardItem[];
  map?: MapSettings;
}

export const PATHS = {
  campaign: 'campanha.json',
  board: 'quadro.json',
  combat: 'combate.json',
  logDir: 'log',
  imageDir: 'imagens',
};

export function newCampaign(name: string, system?: string): CampaignFile {
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
    ...(system ? { system } : {}),
    settings: { ...DEFAULT_SETTINGS },
  };
}

export async function readCampaign(store: CampaignStore): Promise<CampaignFile | null> {
  const txt = await store.readText(PATHS.campaign);
  if (!txt) return null;
  const c = JSON.parse(txt) as CampaignFile;
  if (c.app !== 'free-tabletop' || !c.roomId || !c.gmKey) throw new Error('campanha.json inválido');
  c.filter ??= structuredClone(DEFAULT_FILTER);
  c.roster ??= {};
  if (!Array.isArray(c.settings?.attributes)) c.noAttrList = true;
  c.settings = { ...DEFAULT_SETTINGS, ...c.settings };
  return c;
}

export async function readBoard(store: CampaignStore): Promise<BoardItem[]> {
  const txt = await store.readText(PATHS.board);
  if (!txt) return [];
  const DEF = { note: [220, 180], card: [260, 340], image: [300, 300], token: [70, 70], clock: [160, 160] } as const;
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

export const docPath = (col: Collection, id: string) => `${COLLECTION_DIRS[col]}/${id}.json`;

/** Lê todos os documentos de uma coleção (ignora arquivos corrompidos). */
export async function readDocs<T extends AnyDoc>(store: CampaignStore, col: Collection): Promise<T[]> {
  const files = (await store.list(COLLECTION_DIRS[col])).filter((f) => f.endsWith('.json'));
  const out: T[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse((await store.readText(`${COLLECTION_DIRS[col]}/${f}`)) ?? '') as T;
      if (d && typeof d.id === 'string' && d.perm) out.push(d);
    } catch {
      console.warn('Arquivo ignorado:', col, f);
    }
  }
  return out;
}

export async function readCombat(store: CampaignStore): Promise<Combat> {
  try {
    const txt = await store.readText(PATHS.combat);
    if (txt) return { ...EMPTY_COMBAT, ...(JSON.parse(txt) as Combat) };
  } catch {
    /* arquivo inválido: começa vazio */
  }
  return structuredClone(EMPTY_COMBAT);
}

export async function readMap(store: CampaignStore): Promise<MapSettings> {
  const map = structuredClone(DEFAULT_MAP);
  try {
    const txt = await store.readText(PATHS.board);
    const m = txt ? (JSON.parse(txt) as BoardFile).map : undefined;
    if (m) {
      Object.assign(map.grid, m.grid ?? {});
      map.fog.enabled = !!m.fog?.enabled;
      map.fog.shapes = (m.fog?.shapes ?? []).filter(isFogShape);
    }
  } catch {
    /* quadro sem mapa */
  }
  return map;
}
