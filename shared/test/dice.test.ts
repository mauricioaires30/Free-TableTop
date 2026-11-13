import { describe, expect, it } from 'vitest';
import { DiceError, formatRoll, parseDice, rollDice } from '../src/dice';

/** RNG determinístico que devolve a sequência dada. */
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('dados', () => {
  it('soma dados e modificador', () => {
    const r = rollDice('2d6+3', seq(4, 2));
    expect(r.total).toBe(9);
    expect(formatRoll(r)).toBe('2d6+3 → [4, 2] + 3 = 9');
  });

  it('d20 sem quantidade e subtração', () => {
    expect(rollDice('d20-2', seq(15)).total).toBe(13);
    expect(rollDice('1d8 - 1d4', seq(5, 3)).total).toBe(2);
  });

  it('mantém maiores e menores', () => {
    const r = rollDice('4d6kh3', seq(1, 6, 3, 5));
    expect(r.total).toBe(14);
    const p = r.parts[0];
    expect(p.type === 'dice' && p.rolls.map((d) => d.kept)).toEqual([false, true, true, true]);
    expect(rollDice('2d20kl1', seq(17, 4)).total).toBe(4);
    expect(rollDice('4d6k3', seq(2, 2, 2, 1)).total).toBe(6);
  });

  it('vantagem e desvantagem', () => {
    expect(rollDice('adv', seq(3, 18)).total).toBe(18);
    expect(rollDice('dis+5', seq(3, 18)).total).toBe(8);
  });

  it('dados explosivos', () => {
    const r = rollDice('1d6!', seq(6, 6, 2));
    expect(r.total).toBe(14);
    const p = r.parts[0];
    expect(p.type === 'dice' && p.rolls.length).toBe(3);
  });

  it('d% é d100', () => {
    const p = rollDice('d%', seq(42)).parts[0];
    expect(p.type === 'dice' && p.sides).toBe(100);
  });

  it('explosão tem limite', () => {
    const r = rollDice('1d2!', () => 2);
    const p = r.parts[0];
    expect(p.type === 'dice' && p.rolls.length).toBe(51);
  });

  it('rejeita entradas inválidas', () => {
    for (const bad of ['', 'abc', '1d1', '0d6', '1000d6', '1d100000', '3d6kh4', '1d6++2', '2d', 'd']) {
      expect(() => parseDice(bad), bad).toThrow(DiceError);
    }
  });

  it('rng real fica no intervalo', () => {
    for (let i = 0; i < 500; i++) {
      const t = rollDice('1d6').total;
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(6);
    }
  });
});
