// Onde a campanha é salva: numa pasta do PC do mestre (Chrome/Edge)
// ou, como alternativa, dentro do próprio navegador (IndexedDB).
import { createStore, del, entries, get, keys, set, type UseStore } from 'idb-keyval';

export interface CampaignStore {
  kind: 'fs' | 'idb';
  /** Nome exibido (nome da pasta ou "navegador"). */
  label: string;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBlob(path: string): Promise<Blob | null>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  /** Nomes de arquivos dentro de uma pasta. */
  list(dir: string): Promise<string[]>;
}

export const hasFolderAccess = (): boolean => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

// ---------- Pasta no PC (File System Access API) ----------

export class FsStore implements CampaignStore {
  kind = 'fs' as const;
  constructor(public handle: FileSystemDirectoryHandle) {}

  get label() {
    return this.handle.name;
  }

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = this.handle;
    for (const p of parts) {
      try {
        d = await d.getDirectoryHandle(p, { create });
      } catch {
        return null;
      }
    }
    return d;
  }

  private async file(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = path.split('/');
    const name = parts.pop()!;
    const d = await this.dir(parts, create);
    if (!d) return null;
    try {
      return await d.getFileHandle(name, { create });
    } catch {
      return null;
    }
  }

  async readBlob(path: string) {
    const f = await this.file(path, false);
    return f ? f.getFile() : null;
  }

  async readText(path: string) {
    const b = await this.readBlob(path);
    return b ? b.text() : null;
  }

  async writeBlob(path: string, blob: Blob) {
    const f = await this.file(path, true);
    if (!f) throw new Error(`Não consegui criar ${path}`);
    const w = await f.createWritable();
    await w.write(blob);
    await w.close();
  }

  async writeText(path: string, text: string) {
    await this.writeBlob(path, new Blob([text], { type: 'text/plain' }));
  }

  async list(dir: string) {
    const d = await this.dir(dir.split('/').filter(Boolean), false);
    if (!d) return [];
    const out: string[] = [];
    for await (const h of d.values()) if (h.kind === 'file') out.push(h.name);
    return out;
  }
}

/** Garante permissão de leitura/escrita (precisa de clique do usuário se ainda não foi dada). */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

// ---------- Navegador (IndexedDB) ----------

let campaignsDb: UseStore | null = null;
const cdb = () => (campaignsDb ??= createStore('ftt-campaigns', 'files'));

export class IdbStore implements CampaignStore {
  kind = 'idb' as const;
  label = 'neste navegador';
  constructor(private id: string) {}

  private k(path: string) {
    return `${this.id}/${path}`;
  }

  async readText(path: string) {
    const v = await get(this.k(path), cdb());
    return typeof v === 'string' ? v : v instanceof Blob ? v.text() : null;
  }

  async writeText(path: string, text: string) {
    await set(this.k(path), text, cdb());
  }

  async readBlob(path: string) {
    const v = await get(this.k(path), cdb());
    return v instanceof Blob ? v : typeof v === 'string' ? new Blob([v]) : null;
  }

  async writeBlob(path: string, blob: Blob) {
    await set(this.k(path), blob, cdb());
  }

  async list(dir: string) {
    const prefix = this.k(dir.replace(/\/?$/, '/'));
    return (await keys(cdb()))
      .map(String)
      .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map((k) => k.slice(prefix.length));
  }

  /** Exporta todos os arquivos (para backup). */
  async dump(): Promise<Array<[string, unknown]>> {
    const prefix = this.id + '/';
    return (await entries(cdb()))
      .filter(([k]) => String(k).startsWith(prefix))
      .map(([k, v]) => [String(k).slice(prefix.length), v]);
  }
}

// ---------- Campanhas recentes ----------

export interface RecentCampaign {
  roomId: string;
  name: string;
  kind: 'fs' | 'idb';
  handle?: FileSystemDirectoryHandle;
  lastOpened: number;
}

let recentDb: UseStore | null = null;
const rdb = () => (recentDb ??= createStore('ftt-recent', 'campaigns'));

export async function listRecent(): Promise<RecentCampaign[]> {
  try {
    const all = (await entries(rdb())).map(([, v]) => v as RecentCampaign);
    return all.sort((a, b) => b.lastOpened - a.lastOpened);
  } catch {
    return [];
  }
}

export async function rememberCampaign(r: RecentCampaign) {
  try {
    await set(r.roomId, r, rdb());
  } catch {
    /* navegador sem IndexedDB: só não lembra */
  }
}

export async function forgetCampaign(roomId: string) {
  await del(roomId, rdb());
}

export async function getRecent(roomId: string): Promise<RecentCampaign | undefined> {
  try {
    return await get(roomId, rdb());
  } catch {
    return undefined;
  }
}
