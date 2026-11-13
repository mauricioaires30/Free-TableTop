// Parser e rolador de dados, pensado para servir a qualquer sistema.
// Soma:        2d6+3, d20, 1d8-1, d% (d100), 3+2
// Manter:      4d6kh3, 2d20kl1, 4d6k3, adv / dis (vant / desv)
// Explodir:    1d6!  (rola de novo quando tira o máximo)
// Rerrolar:    2d6r1 (rerrola uma vez os dados que tiram 1 ou menos)
// Sucessos:    5d10>=8 (conta dados que tiram 8+), 1d100<=65 (rolar abaixo), 6d6=6
// Fate/Fudge:  4dF (cada dado vale -1, 0 ou +1)

export interface DieRoll {
  value: number;
  kept: boolean;
  exploded?: boolean;
  /** Valor antes de rerrolar (r). */
  rerolled?: number;
  /** Conta como sucesso (quando há alvo, ex.: >=8). */
  hit?: boolean;
}

export type Comparator = '>=' | '<=' | '>' | '<' | '=';

export interface DicePart {
  type: 'dice';
  sign: 1 | -1;
  notation: string;
  count: number;
  sides: number;
  rolls: DieRoll[];
  /** Soma dos dados mantidos, ou número de sucessos quando há alvo. */
  subtotal: number;
  fate?: boolean;
  target?: { op: Comparator; n: number };
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
  /** Lados; dados Fate usam 3 internamente (-1, 0, +1). */
  sides: number;
  fate: boolean;
  keep?: { mode: 'h' | 'l'; n: number };
  explode: boolean;
  reroll?: number;
  target?: { op: Comparator; n: number };
  notation: string;
}
interface NumTerm {
  kind: 'num';
  sign: 1 | -1;
  value: number;
}
type Term = DiceTerm | NumTerm;

const TERM_RE =
  /^(?:(adv|dis|vant|desv)|(\d*)d(\d+|%|f)(?:r(\d+))?(?:(kh|kl|k)(\d+))?(!)?(?:(>=|<=|>|<|=)(\d+))?|(\d+))$/;

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
        kind: 'dice', sign, count: 2, sides: 20, fate: false, explode: false,
        keep: { mode: adv ? 'h' : 'l', n: 1 },
        notation: adv ? '2d20kh1' : '2d20kl1',
      });
      continue;
    }
    if (m[10] !== undefined) {
      terms.push({ kind: 'num', sign, value: parseInt(m[10], 10) });
      continue;
    }
    const count = m[2] ? parseInt(m[2], 10) : 1;
    const fate = m[3] === 'f';
    const sides = fate ? 3 : m[3] === '%' ? 100 : parseInt(m[3], 10);
    if (count < 1) throw new DiceError('Precisa rolar pelo menos 1 dado');
    if (count > DICE_LIMITS.maxCount) throw new DiceError(`Máximo de ${DICE_LIMITS.maxCount} dados`);
    if (sides < 2) throw new DiceError('O dado precisa ter pelo menos 2 lados');
    if (sides > DICE_LIMITS.maxSides) throw new DiceError(`Máximo de ${DICE_LIMITS.maxSides} lados`);
    let keep: DiceTerm['keep'];
    if (m[5]) {
      const n = parseInt(m[6], 10);
      if (n < 1 || n > count) throw new DiceError(`Não dá para manter ${n} de ${count} dados`);
      keep = { mode: m[5] === 'kl' ? 'l' : 'h', n };
    }
    const explode = !!m[7];
    if (fate && explode) throw new DiceError('Dado Fate não explode');
    let reroll: number | undefined;
    if (m[4] !== undefined) {
      reroll = parseInt(m[4], 10);
      if (fate || reroll < 1 || reroll >= sides) throw new DiceError(`Não dá para rerrolar ${reroll} em d${m[3]}`);
    }
    const target = m[8] ? { op: m[8] as Comparator, n: parseInt(m[9], 10) } : undefined;
    terms.push({ kind: 'dice', sign, count, sides, fate, keep, explode, reroll, target, notation: raw });
  }
  return terms;
}

function meets(v: number, t: { op: Comparator; n: number }): boolean {
  switch (t.op) {
    case '>=':
      return v >= t.n;
    case '<=':
      return v <= t.n;
    case '>':
      return v > t.n;
    case '<':
      return v < t.n;
    case '=':
      return v === t.n;
  }
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
    const face = () => (t.fate ? rng(3) - 2 : rng(t.sides));
    const rolls: DieRoll[] = [];
    let explodes = 0;
    for (let i = 0; i < t.count; i++) {
      let v = face();
      const roll: DieRoll = { value: v, kept: true };
      if (t.reroll !== undefined && v <= t.reroll) {
        roll.rerolled = v;
        v = face();
        roll.value = v;
      }
      rolls.push(roll);
      while (t.explode && v === t.sides && explodes < DICE_LIMITS.maxExplodes) {
        explodes++;
        v = face();
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
    let subtotal: number;
    if (t.target) {
      for (const r of rolls) if (r.kept) r.hit = meets(r.value, t.target);
      subtotal = rolls.filter((r) => r.hit).length;
    } else {
      subtotal = rolls.reduce((s, r) => s + (r.kept ? r.value : 0), 0);
    }
    const part: DicePart = { type: 'dice', sign: t.sign, notation: t.notation, count: t.count, sides: t.sides, rolls, subtotal };
    if (t.fate) part.fate = true;
    if (t.target) part.target = t.target;
    parts.push(part);
    total += t.sign * subtotal;
  }
  return { expr: input.trim(), parts, total };
}

/** Rótulo de um dado para mostrar: Fate vira +, − ou em branco. */
export function dieLabel(p: Pick<DicePart, 'fate'>, v: number): string {
  if (!p.fate) return String(v);
  return v > 0 ? '+' : v < 0 ? '−' : '0';
}

/** A rolagem conta sucessos (tem alvo em algum grupo de dados)? */
export function isSuccessRoll(r: RollResult): boolean {
  return r.parts.some((p) => p.type === 'dice' && !!p.target);
}

/** Texto curto do resultado, ex.: "2d6+3 → [4, 2] + 3 = 9" ou "5d10>=8 → [9, 3, 8, 1, 10] = 3 sucessos". */
export function formatRoll(r: RollResult): string {
  const body = r.parts
    .map((p, i) => {
      const s = p.sign < 0 ? '- ' : i > 0 ? '+ ' : '';
      if (p.type === 'num') return s + p.value;
      return s + '[' + p.rolls.map((d) => (d.kept ? dieLabel(p, d.value) : `~${dieLabel(p, d.value)}~`)).join(', ') + ']';
    })
    .join(' ');
  const suffix = isSuccessRoll(r) ? (r.total === 1 ? ' sucesso' : ' sucessos') : '';
  return `${r.expr} → ${body} = ${r.total}${suffix}`;
}
