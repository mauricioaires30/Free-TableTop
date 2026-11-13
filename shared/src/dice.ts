// Parser e rolador de dados.
// Suporta: 2d6+3, d20, 4d6kh3, 2d20kl1, 4d6k3, 1d6! (explode), d% (d100), adv, dis, 3+2, 1d8-1.

export interface DieRoll {
  value: number;
  kept: boolean;
  exploded?: boolean;
}

export interface DicePart {
  type: 'dice';
  sign: 1 | -1;
  notation: string;
  count: number;
  sides: number;
  rolls: DieRoll[];
  subtotal: number;
}

export interface NumberPart {
  type: 'num';
  sign: 1 | -1;
  value: number;
}

export type RollPart = DicePart | NumberPart;

export interface RollResult {
  expr: string;
  parts: RollPart[];
  total: number;
}

export class DiceError extends Error {}

export const DICE_LIMITS = { maxCount: 100, maxSides: 1000, maxExplodes: 50, maxTerms: 20, maxLength: 100 };

/** Inteiro uniforme em [1, sides] usando crypto (sem viés de módulo). */
export function cryptoRng(sides: number): number {
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % sides) + 1;
  }
}

interface DiceTerm {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: 'h' | 'l'; n: number };
  explode: boolean;
  notation: string;
}
interface NumTerm {
  kind: 'num';
  sign: 1 | -1;
  value: number;
}
type Term = DiceTerm | NumTerm;

const TERM_RE = /^(?:(adv|dis|vant|desv)|(\d*)d(\d+|%)(?:(kh|kl|k)(\d+))?(!)?|(\d+))$/;

export function parseDice(input: string): Term[] {
  const expr = input.toLowerCase().replace(/\s+/g, '');
  if (!expr) throw new DiceError('Expressão vazia');
  if (expr.length > DICE_LIMITS.maxLength) throw new DiceError('Expressão longa demais');

  const tokens = expr.split(/(?=[+-])/);
  if (tokens.length > DICE_LIMITS.maxTerms) throw new DiceError('Termos demais');

  const terms: Term[] = [];
  for (let raw of tokens) {
    let sign: 1 | -1 = 1;
    if (raw.startsWith('+')) raw = raw.slice(1);
    else if (raw.startsWith('-')) {
      sign = -1;
      raw = raw.slice(1);
    }
    const m = TERM_RE.exec(raw);
    if (!m) throw new DiceError(`Não entendi "${raw || input}"`);

    if (m[1]) {
      const adv = m[1] === 'adv' || m[1] === 'vant';
      terms.push({
        kind: 'dice', sign, count: 2, sides: 20, explode: false,
        keep: { mode: adv ? 'h' : 'l', n: 1 },
        notation: adv ? '2d20kh1' : '2d20kl1',
      });
      continue;
    }
    if (m[7] !== undefined) {
      terms.push({ kind: 'num', sign, value: parseInt(m[7], 10) });
      continue;
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const sides = m[3] === '%' ? 100 : parseInt(m[3], 10);
    if (count < 1) throw new DiceError('Precisa rolar pelo menos 1 dado');
    if (count > DICE_LIMITS.maxCount) throw new DiceError(`Máximo de ${DICE_LIMITS.maxCount} dados`);
    if (sides < 2) throw new DiceError('O dado precisa ter pelo menos 2 lados');
    if (sides > DICE_LIMITS.maxSides) throw new DiceError(`Máximo de ${DICE_LIMITS.maxSides} lados`);
    let keep: DiceTerm['keep'];
    if (m[4]) {
      const n = parseInt(m[5], 10);
      if (n < 1 || n > count) throw new DiceError(`Não dá para manter ${n} de ${count} dados`);
      keep = { mode: m[4] === 'kl' ? 'l' : 'h', n };
    }
    const explode = !!m[6];
    terms.push({ kind: 'dice', sign, count, sides, keep, explode, notation: raw });
  }
  return terms;
}

export function rollDice(input: string, rng: (sides: number) => number = cryptoRng): RollResult {
  const terms = parseDice(input);
  const parts: RollPart[] = [];
  let total = 0;
  for (const t of terms) {
    if (t.kind === 'num') {
      parts.push({ type: 'num', sign: t.sign, value: t.value });
      total += t.sign * t.value;
      continue;
    }
    const rolls: DieRoll[] = [];
    let explodes = 0;
    for (let i = 0; i < t.count; i++) {
      let v = rng(t.sides);
      rolls.push({ value: v, kept: true });
      while (t.explode && v === t.sides && explodes < DICE_LIMITS.maxExplodes) {
        explodes++;
        v = rng(t.sides);
        rolls.push({ value: v, kept: true, exploded: true });
      }
    }
    if (t.keep) {
      const order = rolls
        .map((r, i) => ({ v: r.value, i }))
        .sort((a, b) => (t.keep!.mode === 'h' ? b.v - a.v : a.v - b.v) || a.i - b.i);
      const keepIdx = new Set(order.slice(0, t.keep.n).map((o) => o.i));
      rolls.forEach((r, i) => (r.kept = keepIdx.has(i)));
    }
    const subtotal = rolls.reduce((s, r) => s + (r.kept ? r.value : 0), 0);
    parts.push({ type: 'dice', sign: t.sign, notation: t.notation, count: t.count, sides: t.sides, rolls, subtotal });
    total += t.sign * subtotal;
  }
  return { expr: input.trim(), parts, total };
}

/** Texto curto do resultado, ex.: "2d6+3 → [4, 2] + 3 = 9". */
export function formatRoll(r: RollResult): string {
  const body = r.parts
    .map((p, i) => {
      const s = p.sign < 0 ? '- ' : i > 0 ? '+ ' : '';
      if (p.type === 'num') return s + p.value;
      return s + '[' + p.rolls.map((d) => (d.kept ? String(d.value) : `~${d.value}~`)).join(', ') + ']';
    })
    .join(' ');
  return `${r.expr} → ${body} = ${r.total}`;
}
