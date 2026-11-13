// Avaliador de contas simples e seguro (sem eval): números, + - * /, parênteses
// e as funções floor, ceil, round, min, max, abs. Usado no modificador de atributo
// que o mestre define, ex.: "floor((v-10)/2)", "v*5", "floor(v/2)".

export class CalcError extends Error {}

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'id'; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = parseFloat(src.slice(i, j).replace(',', '.'));
      if (!Number.isFinite(v)) throw new CalcError(`Número inválido em "${src}"`);
      out.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new CalcError(`Caractere "${c}" não é permitido na conta`);
  }
  return out;
}

/** Calcula a expressão; `vars` dá valor a nomes como v. */
export function calc(src: string, vars: Record<string, number> = {}): number {
  if (src.length > 120) throw new CalcError('Conta longa demais');
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v?: string) => {
    const t = toks[pos];
    if (!t || (v !== undefined && t.v !== v)) throw new CalcError(`Conta incompleta: "${src}"`);
    pos++;
    return t;
  };

  function expr(): number {
    let v = term();
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = eat().v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = unary();
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = eat().v;
      const r = unary();
      if (op === '/' && r === 0) throw new CalcError('Divisão por zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function unary(): number {
    if (peek()?.t === 'op' && peek()!.v === '-') {
      eat();
      return -unary();
    }
    if (peek()?.t === 'op' && peek()!.v === '+') {
      eat();
      return unary();
    }
    return atom();
  }
  function atom(): number {
    const t = peek();
    if (!t) throw new CalcError(`Conta incompleta: "${src}"`);
    if (t.t === 'num') {
      eat();
      return t.v;
    }
    if (t.t === 'op' && t.v === '(') {
      eat('(');
      const v = expr();
      eat(')');
      return v;
    }
    if (t.t === 'id') {
      eat();
      const fn = FUNCS[t.v];
      if (fn) {
        eat('(');
        const args = [expr()];
        while (peek()?.t === 'op' && peek()!.v === ',') {
          eat(',');
          args.push(expr());
        }
        eat(')');
        return fn(...args);
      }
      if (t.v in vars) return vars[t.v];
      throw new CalcError(`Não conheço "${t.v}" (use v para o valor do atributo)`);
    }
    throw new CalcError(`Não entendi "${src}"`);
  }

  const v = expr();
  if (pos !== toks.length) throw new CalcError(`Sobrou algo na conta: "${src}"`);
  if (!Number.isFinite(v)) throw new CalcError('Resultado inválido');
  return v;
}
