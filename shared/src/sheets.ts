// Modelos de ficha (o mestre define o sistema) e fichas de personagem.
import type { Perm } from './permissions';
import { calc } from './calc';

export type FieldType = 'section' | 'text' | 'number' | 'attr' | 'attrs' | 'resource' | 'textarea' | 'check' | 'list';

/** Atributo da campanha: o mestre define a lista uma vez e os modelos escolhem quais usar. */
export interface AttributeDef {
  id: string;
  label: string;
}

/** Lista inicial (cobre os modelos prontos). O mestre edita na aba Mesa. */
export const DEFAULT_ATTRIBUTES: AttributeDef[] = [
  { id: 'for', label: 'Força' },
  { id: 'des', label: 'Destreza' },
  { id: 'con', label: 'Constituição' },
  { id: 'int', label: 'Inteligência' },
  { id: 'sab', label: 'Sabedoria' },
  { id: 'car', label: 'Carisma' },
  { id: 'agi', label: 'Agilidade' },
  { id: 'itl', label: 'Intelecto' },
  { id: 'pre', label: 'Presença' },
  { id: 'vig', label: 'Vigor' },
];

/** Uma linha de um campo "list": item do inventário, equipamento ou poder/magia. */
export interface ListRow {
  id: string;
  name: string;
  qty?: number;
  equipped?: boolean;
  note?: string;
  /** Fórmula rolada ao clicar nesta linha (dano de uma arma, efeito de um poder...). */
  roll?: string;
}

export interface TemplateField {
  /** Identificador curto usado nas fórmulas: {for}, {pv.max}. */
  id: string;
  label: string;
  type: FieldType;
  /** Fórmula rolada ao clicar no campo, ex.: "1d20+{mod}" ou "{v}d20kh1". */
  roll?: string;
  /** Valor máximo inicial (barras de recurso). */
  max?: number;
  /** Cor da barra de recurso. */
  color?: string;
  /** Ocupa a linha inteira. */
  wide?: boolean;
  /** list: quais colunas mostrar (o mestre escolhe por campo: inventário, equipamento, poderes...). */
  showQty?: boolean;
  showEquipped?: boolean;
  showNote?: boolean;
  showRoll?: boolean;
  /** attrs: quais atributos da campanha este modelo usa (vazio/ausente = todos). */
  attrs?: string[];
}

export interface SheetTemplate {
  id: string;
  perm: Perm;
  updatedAt: number;
  name: string;
  /** Modificador de atributo: nenhum (usa o valor), estilo d20 (valor-10)/2 ou uma conta própria. */
  attrMod: 'none' | 'd20' | 'custom';
  /** Conta própria do modificador, com v = valor do atributo. Ex.: "floor(v/2)", "v*5". */
  attrModFormula?: string;
  /** Valor inicial dos atributos (padrão: 10 no estilo d20, 1 nos outros). */
  attrDefault?: number;
  fields: TemplateField[];
  /** Fórmula de iniciativa, ex.: "1d20+{des.mod}". */
  initiative?: string;
  /** Campo de recurso que representa a vida (aparece no combate e nos tokens). */
  hpField?: string;
}

export interface ResourceValue {
  cur: number;
  max: number;
}

export type FieldValue = string | number | boolean | ResourceValue | ListRow[];

export interface Sheet {
  id: string;
  perm: Perm;
  updatedAt: number;
  templateId: string;
  name: string;
  kind: 'pc' | 'npc';
  values: Record<string, FieldValue>;
  color?: string;
  /** Imagem do personagem (hash em imagens/), usada na ficha e no token. */
  avatar?: string;
}

/** Ficha de um jogador (tem dono): quem mexe nela é o dono. */
export function isPlayerSheet(s: Pick<Sheet, 'kind' | 'perm'>): boolean {
  return s.kind === 'pc' && !!s.perm.owner;
}

/** Lado máximo da imagem do personagem. */
export const AVATAR_SIDE = 512;
/** Tamanho máximo aceito pelo mestre para a imagem enviada por um jogador. */
export const MAX_AVATAR_BYTES = 600 * 1024;

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  section: 'Título de seção',
  text: 'Texto curto',
  number: 'Número',
  attr: 'Atributo',
  resource: 'Barra (atual/máx.)',
  textarea: 'Texto longo',
  check: 'Marcador',
  list: 'Lista (inventário, equipamento, poderes...)',
  attrs: 'Atributos da campanha',
};

export const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,23}$/;

/** Gera um id de campo a partir do rótulo: "Força" → "forca". */
export function fieldIdFromLabel(label: string, taken: Set<string>): string {
  let base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, 20);
  if (!base) base = 'campo';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
}

export function isResource(v: unknown): v is ResourceValue {
  return typeof v === 'object' && v !== null && typeof (v as ResourceValue).cur === 'number' && typeof (v as ResourceValue).max === 'number';
}

export function numericValue(v: FieldValue | undefined): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (isResource(v)) return v.cur;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Valor de um atributo; se ainda não foi preenchido (atributo novo na campanha), usa o padrão do modelo. */
export function attrValue(t: Pick<SheetTemplate, 'attrMod' | 'attrDefault'>, v: FieldValue | undefined): number {
  return v === undefined ? attrStart(t) : numericValue(v);
}

/** Valor com que um atributo começa numa ficha nova. */
export function attrStart(t: Pick<SheetTemplate, 'attrMod' | 'attrDefault'>): number {
  return t.attrDefault ?? (t.attrMod === 'd20' ? 10 : 1);
}

export function attrModifier(t: Pick<SheetTemplate, 'attrMod' | 'attrModFormula'>, value: number): number {
  if (t.attrMod === 'd20') return Math.floor((value - 10) / 2);
  if (t.attrMod === 'custom' && t.attrModFormula?.trim()) {
    try {
      return Math.trunc(calc(t.attrModFormula, { v: value }));
    } catch {
      return value;
    }
  }
  return value;
}

export function defaultValue(f: TemplateField, t?: Pick<SheetTemplate, 'attrMod' | 'attrDefault'>): FieldValue | undefined {
  switch (f.type) {
    case 'section':
      return undefined;
    case 'text':
    case 'textarea':
      return '';
    case 'number':
      return 0;
    case 'attr':
      return t ? attrStart(t) : 1;
    case 'resource':
      return { cur: f.max ?? 10, max: f.max ?? 10 };
    case 'check':
      return false;
    case 'list':
      return [];
  }
}

/** Id curto para uma linha de lista (item, equipamento, poder). */
export function newRowId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const MAX_LIST_ROWS = 80;

export function defaultValues(t: SheetTemplate, attrs: AttributeDef[] = []): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of t.fields) {
    const v = defaultValue(f, t);
    if (v !== undefined) out[f.id] = v;
  }
  for (const { def } of templateAttrs(t, attrs)) out[def.id] = attrStart(t);
  return out;
}

/** Atributos da campanha que aparecem neste modelo, com o bloco que define a rolagem deles. */
export function templateAttrs(t: SheetTemplate, attrs: AttributeDef[]): Array<{ def: AttributeDef; block: TemplateField }> {
  const out: Array<{ def: AttributeDef; block: TemplateField }> = [];
  const seen = new Set<string>();
  for (const f of t.fields) {
    if (f.type !== 'attrs') continue;
    for (const def of attrs) {
      if (seen.has(def.id)) continue;
      if (f.attrs && f.attrs.length && !f.attrs.includes(def.id)) continue;
      seen.add(def.id);
      out.push({ def, block: f });
    }
  }
  return out;
}

export class FormulaError extends Error {}

/**
 * Troca as referências de uma fórmula pelos valores da ficha.
 * {v} e {mod} = campo clicado; {id}, {id.mod}, {id.max} = qualquer campo.
 */
export function resolveFormula(
  formula: string,
  sheet: Sheet,
  t: SheetTemplate,
  fieldId?: string,
  attrs: AttributeDef[] = [],
): string {
  const fieldById = new Map<string, Pick<TemplateField, 'id' | 'type'>>(t.fields.map((f) => [f.id, f]));
  for (const { def } of templateAttrs(t, attrs)) if (!fieldById.has(def.id)) fieldById.set(def.id, { id: def.id, type: 'attr' });
  const out = formula.replace(/\{([a-z0-9_]+)(?:\.(mod|max))?\}/gi, (_m, ref: string, suffix?: string) => {
    let id = ref.toLowerCase();
    let suf = suffix?.toLowerCase();
    if (id === 'v' || id === 'mod') {
      if (!fieldId) throw new FormulaError(`{${id}} só funciona ao clicar num campo`);
      if (id === 'mod') suf = 'mod';
      id = fieldId;
    }
    const f = fieldById.get(id);
    if (!f) throw new FormulaError(`Campo {${ref}} não existe neste modelo`);
    const v = sheet.values[id];
    const base = f.type === 'attr' ? attrValue(t, v) : numericValue(v);
    let n: number;
    if (suf === 'max') n = isResource(v) ? v.max : base;
    else if (suf === 'mod') n = attrModifier(t, base);
    else n = base;
    return String(Math.trunc(n));
  });
  // "1d20+-2" → "1d20-2", "1d20--2" → "1d20+2"
  return out.replace(/\+\s*-/g, '-').replace(/-\s*-/g, '+').replace(/\s+/g, '');
}

/** Valida o que um jogador quer gravar na ficha: só campos do modelo, com o tipo certo. */
export function sanitizeValues(t: SheetTemplate, raw: unknown, attrs: AttributeDef[] = []): Record<string, FieldValue> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, FieldValue> = {};
  const fields = new Map<string, Pick<TemplateField, 'id' | 'type'>>(t.fields.map((f) => [f.id, f]));
  for (const { def } of templateAttrs(t, attrs)) if (!fields.has(def.id)) fields.set(def.id, { id: def.id, type: 'attr' });
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = fields.get(k);
    if (!f || f.type === 'section' || f.type === 'attrs') continue;
    const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e6;
    switch (f.type) {
      case 'text':
        if (typeof v === 'string' && v.length <= 200) out[k] = v;
        break;
      case 'textarea':
        if (typeof v === 'string' && v.length <= 8000) out[k] = v;
        break;
      case 'number':
      case 'attr':
        if (num(v)) out[k] = v as number;
        break;
      case 'resource':
        if (isResource(v) && num(v.cur) && num(v.max)) out[k] = { cur: v.cur, max: v.max };
        break;
      case 'check':
        if (typeof v === 'boolean') out[k] = v;
        break;
      case 'list': {
        const rows = sanitizeListRows(v);
        if (rows) out[k] = rows;
        break;
      }
    }
  }
  return out;
}

const ROW_ID_RE = /^[a-f0-9]{8,32}$/;

/** Valida uma lista de linhas (inventário, equipamento, poderes) vinda do jogador. */
export function sanitizeListRows(raw: unknown): ListRow[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LIST_ROWS) return null;
  const out: ListRow[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) return null;
    const row = r as Record<string, unknown>;
    if (typeof row.id !== 'string' || !ROW_ID_RE.test(row.id)) return null;
    if (typeof row.name !== 'string' || row.name.length > 80) return null;
    const clean: ListRow = { id: row.id, name: row.name };
    if (row.qty !== undefined) {
      if (typeof row.qty !== 'number' || !Number.isFinite(row.qty) || row.qty < 0 || row.qty > 9999) return null;
      clean.qty = row.qty;
    }
    if (row.equipped !== undefined) {
      if (typeof row.equipped !== 'boolean') return null;
      clean.equipped = row.equipped;
    }
    if (row.note !== undefined) {
      if (typeof row.note !== 'string' || row.note.length > 500) return null;
      clean.note = row.note;
    }
    if (row.roll !== undefined) {
      if (typeof row.roll !== 'string' || row.roll.length > 100) return null;
      clean.roll = row.roll;
    }
    out.push(clean);
  }
  return out;
}

export function hpOf(sheet: Sheet, t: SheetTemplate | undefined): ResourceValue | null {
  if (!t?.hpField) return null;
  const v = sheet.values[t.hpField];
  return isResource(v) ? v : null;
}

type Preset = Omit<SheetTemplate, 'id' | 'perm' | 'updatedAt'>;

const attrs = (roll: string, ids: string[], label = 'Atributos'): TemplateField => ({ id: 'atributos', label, type: 'attrs', roll, attrs: ids, wide: true });
const res = (id: string, label: string, max: number, color: string): TemplateField => ({ id, label, type: 'resource', max, color });
const section = (id: string, label: string): TemplateField => ({ id, label, type: 'section' });
const long = (id: string, label: string): TemplateField => ({ id, label, type: 'textarea', wide: true });
const list = (
  id: string,
  label: string,
  cfg: Partial<Pick<TemplateField, 'showQty' | 'showEquipped' | 'showRoll'>> = {},
): TemplateField => ({ id, label, type: 'list', wide: true, showNote: true, ...cfg });

/** Modelos prontos para o mestre começar (todos editáveis). */
export const TEMPLATE_PRESETS: Preset[] = [
  {
    name: 'Genérico',
    attrMod: 'none',
    initiative: '1d20',
    hpField: 'pv',
    fields: [
      { id: 'conceito', label: 'Conceito', type: 'text', wide: true },
      res('pv', 'Vida', 10, '#c0392b'),
      res('energia', 'Energia', 10, '#2e86de'),
      long('habilidades', 'Habilidades'),
      list('inventario', 'Inventário', { showQty: true }),
      long('notas', 'Anotações'),
    ],
  },
  {
    name: 'Fantasia d20',
    attrMod: 'd20',
    initiative: '1d20+{des.mod}',
    hpField: 'pv',
    fields: [
      { id: 'classe', label: 'Classe', type: 'text' },
      { id: 'origem', label: 'Origem', type: 'text' },
      { id: 'nivel', label: 'Nível', type: 'number' },
      { id: 'ca', label: 'Defesa (CA)', type: 'number' },
      res('pv', 'Pontos de vida', 10, '#c0392b'),
      attrs('1d20+{mod}', ['for', 'des', 'con', 'int', 'sab', 'car']),
      section('detalhes', 'Detalhes'),
      long('pericias', 'Perícias e proficiências'),
      list('magias', 'Magias e habilidades', { showRoll: true }),
      list('equipamento', 'Equipamento', { showQty: true, showEquipped: true }),
    ],
  },
  {
    name: 'Investigação paranormal',
    attrMod: 'none',
    initiative: '{agi}d20kh1',
    hpField: 'pv',
    fields: [
      { id: 'origem', label: 'Origem', type: 'text' },
      { id: 'classe', label: 'Classe', type: 'text' },
      { id: 'exposicao', label: 'Exposição (%)', type: 'number' },
      { id: 'defesa', label: 'Defesa', type: 'number' },
      attrs('{v}d20kh1', ['agi', 'for', 'itl', 'pre', 'vig']),
      section('status', 'Status'),
      res('pv', 'Vida', 20, '#c0392b'),
      res('san', 'Sanidade', 12, '#8e44ad'),
      res('esf', 'Esforço', 3, '#d9a75b'),
      long('pericias', 'Perícias'),
      list('rituais', 'Rituais e poderes', { showRoll: true }),
      list('inventario', 'Inventário', { showQty: true, showEquipped: true }),
    ],
  },
  {
    // Parada de d10 contando sucessos (8 ou mais), estilo horror pessoal / urbano.
    name: 'Parada de dados (sucessos)',
    attrMod: 'none',
    attrDefault: 2,
    initiative: '1d10+{des}',
    hpField: 'vida',
    fields: [
      { id: 'conceito', label: 'Conceito', type: 'text', wide: true },
      attrs('{v}d10>=8', ['for', 'des', 'vig', 'int', 'pre']),
      res('vida', 'Vitalidade', 7, '#c0392b'),
      res('vontade', 'Força de vontade', 5, '#2e86de'),
      list('pericias', 'Perícias', { showRoll: true }),
      list('inventario', 'Inventário', { showQty: true }),
      long('notas', 'Anotações'),
    ],
  },
  {
    // Rolar abaixo do valor no d100, estilo investigação clássica.
    name: 'Percentual (rolar abaixo)',
    attrMod: 'none',
    attrDefault: 50,
    initiative: '{des}',
    hpField: 'pv',
    fields: [
      { id: 'ocupacao', label: 'Ocupação', type: 'text', wide: true },
      attrs('1d100<={v}', ['for', 'des', 'con', 'int', 'pre']),
      res('pv', 'Pontos de vida', 10, '#c0392b'),
      res('san', 'Sanidade', 50, '#8e44ad'),
      list('pericias', 'Perícias', { showRoll: true }),
      list('inventario', 'Inventário', { showQty: true }),
      long('notas', 'Anotações'),
    ],
  },
  {
    // Narrativo com dados Fate: aspectos, façanhas e estresse.
    name: 'Narrativo (dados Fate)',
    attrMod: 'none',
    attrDefault: 0,
    initiative: '4dF+{agi}',
    hpField: 'estresse',
    fields: [
      { id: 'conceito', label: 'Conceito', type: 'text', wide: true },
      { id: 'dificuldade', label: 'Dificuldade', type: 'text', wide: true },
      attrs('4dF+{v}', ['agi', 'for', 'itl', 'pre', 'vig'], 'Perícias'),
      list('aspectos', 'Aspectos'),
      list('facanhas', 'Façanhas'),
      res('estresse', 'Estresse', 3, '#c0392b'),
      list('consequencias', 'Consequências'),
    ],
  },
  {
    name: 'Em branco',
    attrMod: 'none',
    fields: [long('notas', 'Anotações')],
  },
];
