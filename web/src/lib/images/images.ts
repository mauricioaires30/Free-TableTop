// Imagens enviadas pelo mestre: compressão, hash, envio em pedaços e cache no jogador.
import { createStore, get, set, type UseStore } from 'idb-keyval';
import { IMAGE_CHUNK_BYTES, type GmMessage } from '@ftt/shared';
import type { CampaignStore } from '../storage/store';
import { PATHS } from '../storage/campaign';

export const MAX_IMAGE_SIDE = 2048;
const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

export interface ProcessedImage {
  hash: string;
  blob: Blob;
  width: number;
  height: number;
}

async function sha(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Redimensiona (máx. 2048px) e converte para WebP (ou PNG se o navegador não gerar WebP). */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.85));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Não consegui processar a imagem');
  return { hash: await sha(blob), blob, width, height };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ImageSource {
  /** URL (blob:) pronta para desenhar, ou null se a imagem não estiver disponível. */
  url(hash: string): Promise<string | null>;
}

// ---------- Lado do mestre: lê da pasta ----------

export class GmImages implements ImageSource {
  private urls = new Map<string, string>();
  private blobs = new Map<string, Blob>();

  constructor(private store: CampaignStore) {}

  async save(img: ProcessedImage) {
    const ext = EXT[img.blob.type] ?? 'webp';
    await this.store.writeBlob(`${PATHS.imageDir}/${img.hash}.${ext}`, img.blob);
    this.blobs.set(img.hash, img.blob);
  }

  async blob(hash: string): Promise<Blob | null> {
    const cached = this.blobs.get(hash);
    if (cached) return cached;
    for (const ext of ['webp', 'png', 'jpg']) {
      const b = await this.store.readBlob(`${PATHS.imageDir}/${hash}.${ext}`);
      if (b) {
        const typed = b.type ? b : new Blob([b], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
        this.blobs.set(hash, typed);
        return typed;
      }
    }
    return null;
  }

  async url(hash: string) {
    const u = this.urls.get(hash);
    if (u) return u;
    const b = await this.blob(hash);
    if (!b) return null;
    const url = URL.createObjectURL(b);
    this.urls.set(hash, url);
    return url;
  }

  /** Divide a imagem em pedaços para mandar pelo relay. */
  async chunks(hash: string): Promise<GmMessage[] | null> {
    const b = await this.blob(hash);
    if (!b) return null;
    const bytes = new Uint8Array(await b.arrayBuffer());
    const n = Math.max(1, Math.ceil(bytes.length / IMAGE_CHUNK_BYTES));
    const out: GmMessage[] = [];
    for (let i = 0; i < n; i++) {
      const data = toBase64(bytes.subarray(i * IMAGE_CHUNK_BYTES, (i + 1) * IMAGE_CHUNK_BYTES));
      out.push({ k: 'imgChunk', hash, i, n, mime: b.type || 'image/webp', data });
    }
    return out;
  }

  dispose() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
  }
}

// ---------- Lado do jogador: cache local + download do mestre ----------

let cacheDb: UseStore | null = null;
const idb = () => (cacheDb ??= createStore('ftt-image-cache', 'images'));

export class PlayerImages implements ImageSource {
  private urls = new Map<string, string>();
  private waiting = new Map<string, Array<(u: string | null) => void>>();
  private parts = new Map<string, { n: number; mime: string; got: Uint8Array<ArrayBuffer>[]; count: number }>();
  private requested = new Map<string, number>();

  /** `request` pede a imagem ao mestre. Retorna false se estiver offline. */
  constructor(private request: (hash: string) => boolean) {}

  async url(hash: string): Promise<string | null> {
    const u = this.urls.get(hash);
    if (u) return u;
    try {
      const cached = await get<Blob>(hash, idb());
      if (cached) return this.publish(hash, cached);
    } catch {
      /* sem cache */
    }
    return new Promise((resolve) => {
      const list = this.waiting.get(hash) ?? [];
      list.push(resolve);
      this.waiting.set(hash, list);
      this.ask(hash);
    });
  }

  private ask(hash: string) {
    const last = this.requested.get(hash) ?? 0;
    if (Date.now() - last < 15000) return;
    if (this.request(hash)) this.requested.set(hash, Date.now());
  }

  /** Chamado quando o mestre volta: pede de novo o que ficou faltando. */
  retryPending() {
    for (const hash of this.waiting.keys()) {
      this.requested.delete(hash);
      this.ask(hash);
    }
  }

  receive(m: Extract<GmMessage, { k: 'imgChunk' }>) {
    if (m.n > 200 || m.i < 0 || m.i >= m.n) return;
    let p = this.parts.get(m.hash);
    if (!p || p.n !== m.n) {
      p = { n: m.n, mime: m.mime, got: new Array(m.n), count: 0 };
      this.parts.set(m.hash, p);
    }
    if (!p.got[m.i]) {
      p.got[m.i] = fromBase64(m.data);
      p.count++;
    }
    if (p.count === p.n) {
      this.parts.delete(m.hash);
      const blob = new Blob(p.got, { type: p.mime.startsWith('image/') ? p.mime : 'image/webp' });
      set(m.hash, blob, idb()).catch(() => {});
      this.publish(m.hash, blob);
    }
  }

  missing(hash: string) {
    const list = this.waiting.get(hash) ?? [];
    this.waiting.delete(hash);
    list.forEach((r) => r(null));
  }

  private publish(hash: string, blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.urls.set(hash, url);
    const list = this.waiting.get(hash) ?? [];
    this.waiting.delete(hash);
    list.forEach((r) => r(url));
    return url;
  }

  dispose() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
  }
}
