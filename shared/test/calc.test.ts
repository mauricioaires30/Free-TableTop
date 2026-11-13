import { describe, expect, it } from 'vitest';
import { calc, CalcError } from '../src/calc';
import { attrModifier, attrStart } from '../src/sheets';

describe('conta do modificador', () => {
  it('faz contas com v e funções', () => {
    expect(calc('floor((v-10)/2)', { v: 15 })).toBe(2);
    expect(calc('v*5', { v: 12 })).toBe(60);
    expect(calc('max(0, v-3)', { v: 2 })).toBe(0);
    expect(calc('-v + 2*(3+1)', { v: 1 })).toBe(7);
  });

  it('recusa o que não é conta', () => {
    for (const bad of ['alert(1)', 'v;', '1/0', '(1+2', 'x+1', 'v'.repeat(200)]) {
      expect(() => calc(bad, { v: 1 }), bad).toThrow(CalcError);
    }
  });

  it('modificador do modelo', () => {
    expect(attrModifier({ attrMod: 'custom', attrModFormula: 'floor(v/2)' }, 7)).toBe(3);
    expect(attrModifier({ attrMod: 'custom', attrModFormula: 'quebrado(' }, 7)).toBe(7);
    expect(attrModifier({ attrMod: 'd20' }, 8)).toBe(-1);
    expect(attrModifier({ attrMod: 'none' }, 4)).toBe(4);
    expect(attrStart({ attrMod: 'none', attrDefault: 50 })).toBe(50);
    expect(attrStart({ attrMod: 'd20' })).toBe(10);
  });
});
