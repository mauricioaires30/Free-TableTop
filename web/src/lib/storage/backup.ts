// Backup da campanha inteira num .zip (para trocar de PC ou guardar uma cópia),
// e exportação de modelos de ficha para trocar com outros mestres.
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import {
  COLLECTION_DIRS, FIELD_ID_RE,
  type FieldType, type SheetTemplate, type TemplateField,
} from '@ftt/shared';
import { PATHS } from './campaign';
import type { CampaignStore } from './store';

const DIRS = [PATHS.logDir, PATHS.imageDir, ...Object.values(COLLECTION_DIRS)];
const ROOT_FILES = [PATHS.campaign, PATHS.board, PATHS.combat];
const SAFE_PATH = /^[a-z0-9_-]+(\/[A-Za-z0-9_.-]+)?$|^[a-z0-9_-]+\.json$/;

export async function exportZip(store: CampaignStore): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  for (const f of ROOT_FILES) {
    const b = await store.readBlob(f);
    if (b) files[f] = new Uint8Array(await b.arrayBuffer());
  }
  for (const dir of DIRS) {
    for (const name of await store.list(dir)) {
      const b = await store.readBlob(`${dir}/${name}`);
      if (b) files[`${dir}/${name}`] = new Uint8Array(await b.arrayBuffer());
    }
  }
  // Imagens já são comprimidas; o resto é texto.
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

/** Lê um .zip de backup e devolve os arquivos (só caminhos conhecidos, sem "..", com limite de tamanho). */
export async function readZip(file: Blob): Promise<Map<string, Uint8Array>> {
  if (file.size > 300 * 1024 * 1024) throw new Error('Backup grande demais (máx. 300 MB).');
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const out = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/') || path.includes('..')) continue;
    const top = path.split('/')[0];
    const ok = ROOT_FILES.includes(path) || (DIRS.includes(top) && SAFE_PATH.test(path));
    if (ok) out.set(path, data);
  }
  if (!out.has(PATHS.campaign)) throw new Error('Este arquivo não é um backup do Free TableTop (falta campanha.json).');
  return out;
}

export async function writeFiles(store: CampaignStore, files: Map<string, Uint8Array>) {
  for (const [path, data] of files) {
    const isText = path.endsWith('.json') || path.endsWith('.jsonl');
    if (isText) await store.writeText(path, strFromU8(data));
    else await store.writeBlob(path, new Blob([data as Uint8Array<ArrayBuffer>]));
  }
}

export function campaignNameFromZip(files: Map<string, Uint8Array>): string {
  try {
    return JSON.parse(strFromU8(files.get(PATHS.campaign)!)).name ?? 'Campanha';
  } catch {
    return 'Campanha';
  }
}

export function roomIdFromZip(files: Map<string, Uint8Array>): string {
  return JSON.parse(strFromU8(files.get(PATHS.campaign)!)).roomId;
}

/** Baixa um arquivo no navegador do usuário. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const safeFileName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'campanha';

// ---------- modelos de ficha ----------

type TemplateData = Omit<SheetTemplate, 'id' | 'perm' | 'updatedAt'>;
const FIELD_TYPES: FieldType[] = ['section', 'text', 'number', 'attr', 'resource', 'textarea', 'check'];

export function templateToJson(t: SheetTemplate): string {
  const { name, attrMod, fields, initiative, hpField } = t;
  return JSON.stringify({ app: 'free-tabletop', kind: 'sheet-template', version: 1, template: { name, attrMod, fields, initiative, hpField } }, null, 2);
}

/** Valida um modelo vindo de arquivo de outra pessoa. */
export function templateFromJson(text: string): TemplateData {
  const raw = JSON.parse(text);
  const t = raw?.template;
  if (raw?.app !== 'free-tabletop' || raw?.kind !== 'sheet-template' || typeof t !== 'object') {
    throw new Error('Este arquivo não é um modelo de ficha do Free TableTop.');
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const ids = new Set<string>();
  const fields: TemplateField[] = [];
  for (const f of Array.isArray(t.fields) ? t.fields.slice(0, 200) : []) {
    const id = str(f?.id, 24);
    if (!id || !FIELD_ID_RE.test(id) || ids.has(id) || !FIELD_TYPES.includes(f.type)) continue;
    ids.add(id);
    const field: TemplateField = { id, label: str(f.label, 40) ?? id, type: f.type };
    if (str(f.roll, 100)) field.roll = str(f.roll, 100);
    if (typeof f.max === 'number' && Number.isFinite(f.max)) field.max = f.max;
    if (str(f.color, 20) && /^#[0-9a-f]{6}$/i.test(f.color)) field.color = f.color;
    if (f.wide === true) field.wide = true;
    fields.push(field);
  }
  if (!fields.length) throw new Error('O modelo não tem campos válidos.');
  return {
    name: str(t.name, 60) || 'Modelo importado',
    attrMod: t.attrMod === 'd20' ? 'd20' : 'none',
    fields,
    initiative: str(t.initiative, 100) || undefined,
    hpField: ids.has(t.hpField) ? t.hpField : undefined,
  };
}
