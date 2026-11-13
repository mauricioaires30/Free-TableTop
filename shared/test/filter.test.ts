import { describe, expect, it } from 'vitest';
import { applyFilter, DEFAULT_BAD_WORDS, DEFAULT_FILTER, WordFilter } from '../src/filter';

const f = new WordFilter(DEFAULT_BAD_WORDS);

describe('filtro de palavras', () => {
  it.each([
    'porra', 'PORRA', 'pôrra', 'porrrraaa', 'p0rr4', 'p.o.r.r.a', 'p o r r a', 'caralhos',
    'que merda!', 'vai se foder', 'foda-se', 'filho da puta', 'f d p', 'putinha', 'arrombad0',
  ])('pega "%s"', (t) => {
    expect(f.check(t)).toBe(true);
  });

  it.each([
    'computador', 'disputa', 'rola o dado', 'cuidado com o cubo', 'curar o ferido', 'escuta',
    'reputação', 'passou a perna', 'o pinto da fazenda', 'acumula', 'sucumbir', 'role 1d20+5',
    'pica-pau', 'a e i o u', 'bom dia, mestre!',
  ])('não pega "%s"', (t) => {
    expect(f.check(t)).toBe(false);
  });

  it('censura mantendo o resto da frase', () => {
    expect(f.censor('que porra é essa')).toBe('que ***** é essa');
    expect(f.censor('p.o.r.r.a!')).toBe('*********!');
  });

  it('modo bloquear e desligado', () => {
    expect(applyFilter({ ...DEFAULT_FILTER, mode: 'block' }, 'merda').ok).toBe(false);
    expect(applyFilter({ ...DEFAULT_FILTER, enabled: false }, 'merda')).toEqual({ ok: true, text: 'merda', censored: false });
    const r = applyFilter(DEFAULT_FILTER, 'merda');
    expect(r.ok && r.censored && r.text).toBe('*****');
  });

  it('lista customizada do mestre', () => {
    const custom = new WordFilter(['batata']);
    expect(custom.check('BATATAS')).toBe(true);
    expect(custom.check('porra')).toBe(false);
  });
});
