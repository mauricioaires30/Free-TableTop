// Modelos de ficha (o mestre define o sistema) e fichas de personagem.
import type { Perm } from './permissions';

export type FieldType = 'section' | 'text' | 'number' | 'attr' | 'resource' | 'textarea' | 'check';

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
}

export interface SheetTemplate {
  id: string;
  perm: Perm;
  updatedAt: number;
  name: string;
  /** Como calcular o modificador de atributos: nenhum ou estilo d20 (valor-10)/2. */
  attrMod: 'none' | 'd20';
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

export type FieldValue = string | number | boolean | ResourceValue;

export interface Sheet {
  id: string;
  perm: Perm;
  updatedAt: number;
  templateId: string;
  name: string;
  kind: 'pc' | 'npc';
  values: Record<string, FieldValue>;
  color?: string;
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  section: 'Título de seção',
  text: 'Texto curto',
  number: 'Número',
  attr: 'Atributo',
  resource: 'Barra (atual/máx.)',
  textarea: 'Texto longo',
  check: 'Marcador',
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
  if (isResource(v)) return v.cur;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function attrModifier(t: Pick<SheetTemplate, 'attrMod'>, value: number): number {
  return t.attrMod === 'd20' ? Math.floor((value - 10) / 2) : value;
}

export function defaultValue(f: TemplateField, t?: Pick<SheetTemplate, 'attrMod'>): FieldValue | undefined {
  switch (f.type) {
    case 'section':
      return undefined;
    case 'text':
    case 'textarea':
      return '';
    case 'number':
      return 0;
    case 'attr':
      return t?.attrMod === 'd20' ? 10 : 1;
    case 'resource':
      return { cur: f.max ?? 10, max: f.max ?? 10 };
    case 'check':
      return false;
  }
}

export function defaultValues(t: SheetTemplate): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of t.fields) {
    const v = defaultValue(f, t);
    if (v !== undefined) out[f.id] = v;
  }
  return out;
}

export class FormulaError extends Error {}

/**
 * Troca as referências de uma fórmula pelos valores da ficha.
 * {v} e {mod} = campo clicado; {id}, {id.mod}, {id.max} = qualquer campo.
 */
export function resolveFormula(formula: string, sheet: Sheet, t: SheetTemplate, fieldId?: string): string {
  const fieldById = new Map(t.fields.map((f) => [f.id, f]));
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
    let n: number;
    if (suf === 'max') n = isResource(v) ? v.max : numericValue(v);
    else if (suf === 'mod') n = attrModifier(t, numericValue(v));
    else n = numericValue(v);
    return String(Math.trunc(n));
  });
  // "1d20+-2" → "1d20-2", "1d20--2" → "1d20+2"
  return out.replace(/\+\s*-/g, '-').replace(/-\s*-/g, '+').replace(/\s+/g, '');
}

/** Valida o que um jogador quer gravar na ficha: só campos do modelo, com o tipo certo. */
export function sanitizeValues(t: SheetTemplate, raw: unknown): Record<string, FieldValue> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, FieldValue> = {};
  const fields = new Map(t.fields.map((f) => [f.id, f]));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = fields.get(k);
    if (!f || f.type === 'section') continue;
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
    }
  }
  return out;
}

export function hpOf(sheet: Sheet, t: SheetTemplate | undefined): ResourceValue | null {
  if (!t?.hpField) return null;
  const v = sheet.values[t.hpField];
  return isResource(v) ? v : null;
}

type Preset = Omit<SheetTemplate, 'id' | 'perm' | 'updatedAt'>;

const attr = (id: string, label: string, roll: string): TemplateField => ({ id, label, type: 'attr', roll });
const res = (id: string, label: string, max: number, color: string): TemplateField => ({ id, label, type: 'resource', max, color });
const section = (id: string, label: string): TemplateField => ({ id, label, type: 'section' });
const long = (id: string, label: string): TemplateField => ({ id, label, type: 'textarea', wide: true });

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
      long('inventario', 'Inventário'),
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
      section('atributos', 'Atributos'),
      attr('for', 'Força', '1d20+{mod}'),
      attr('des', 'Destreza', '1d20+{mod}'),
      attr('con', 'Constituição', '1d20+{mod}'),
      attr('int', 'Inteligência', '1d20+{mod}'),
      attr('sab', 'Sabedoria', '1d20+{mod}'),
      attr('car', 'Carisma', '1d20+{mod}'),
      section('detalhes', 'Detalhes'),
      long('pericias', 'Perícias e proficiências'),
      long('magias', 'Magias e habilidades'),
      long('equipamento', 'Equipamento'),
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
      section('atributos', 'Atributos'),
      attr('agi', 'Agilidade', '{v}d20kh1'),
      attr('for', 'Força', '{v}d20kh1'),
      attr('int', 'Intelecto', '{v}d20kh1'),
      attr('pre', 'Presença', '{v}d20kh1'),
      attr('vig', 'Vigor', '{v}d20kh1'),
      section('status', 'Status'),
      res('pv', 'Vida', 20, '#c0392b'),
      res('san', 'Sanidade', 12, '#8e44ad'),
      res('esf', 'Esforço', 3, '#d9a75b'),
      long('pericias', 'Perícias'),
      long('rituais', 'Rituais e poderes'),
      long('inventario', 'Inventário'),
    ],
  },
  {
    name: 'Em branco',
    attrMod: 'none',
    fields: [long('notas', 'Anotações')],
  },
];
