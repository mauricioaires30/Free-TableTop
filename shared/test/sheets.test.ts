import { describe, expect, it } from 'vitest';
import {
  defaultValues, fieldIdFromLabel, FormulaError, resolveFormula, sanitizeValues, TEMPLATE_PRESETS,
  type Sheet, type SheetTemplate,
} from '../src/sheets';
import { combatForPlayer, sortEntries, stepTurn, type Combat } from '../src/combat';
import { parseDice } from '../src/dice';
import { parsePlayerIntent } from '../src/protocol';

const tpl = (i: number): SheetTemplate => ({ ...TEMPLATE_PRESETS[i], id: 'tpl1', perm: { view: 'all', move: 'gm', edit: 'gm' }, updatedAt: 0 });
const sheetOf = (t: SheetTemplate, values: Sheet['values'] = {}): Sheet => ({
  id: 'sheet1', perm: { view: 'owner', move: 'gm', edit: 'owner', owner: 'ana00000' }, updatedAt: 0,
  templateId: t.id, name: 'Ana', kind: 'pc', values: { ...defaultValues(t), ...values },
});

describe('fichas', () => {
  it('modelos prontos têm fórmulas válidas', () => {
    for (let i = 0; i < TEMPLATE_PRESETS.length; i++) {
      const t = tpl(i);
      const s = sheetOf(t);
      for (const f of t.fields) {
        if (f.type === 'attr') s.values[f.id] = 2;
      }
      for (const f of t.fields) {
        if (f.roll) expect(() => parseDice(resolveFormula(f.roll!, s, t, f.id)), f.roll).not.toThrow();
      }
      if (t.initiative) expect(() => parseDice(resolveFormula(t.initiative!, s, t))).not.toThrow();
      const ids = t.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('modificador estilo d20', () => {
    const t = tpl(1);
    const s = sheetOf(t, { des: 14, for: 8 });
    expect(resolveFormula('1d20+{mod}', s, t, 'des')).toBe('1d20+2');
    expect(resolveFormula('1d20+{mod}', s, t, 'for')).toBe('1d20-1');
    expect(resolveFormula(t.initiative!, s, t)).toBe('1d20+2');
    expect(resolveFormula('{pv.max}', s, t)).toBe('10');
  });

  it('atributo como quantidade de dados', () => {
    const t = tpl(2);
    const s = sheetOf(t, { agi: 3 });
    expect(resolveFormula('{v}d20kh1', s, t, 'agi')).toBe('3d20kh1');
    expect(resolveFormula(t.initiative!, s, t)).toBe('3d20kh1');
  });

  it('referência inexistente dá erro claro', () => {
    const t = tpl(0);
    expect(() => resolveFormula('1d20+{xyz}', sheetOf(t), t)).toThrow(FormulaError);
    expect(() => resolveFormula('{v}d6', sheetOf(t), t)).toThrow(FormulaError);
  });

  it('valida valores enviados pelo jogador', () => {
    const t = tpl(1);
    expect(
      sanitizeValues(t, { for: 15, pv: { cur: 3, max: 12 }, classe: 'Ladino', hack: 1, atributos: 'x', des: 'muito', ca: Infinity }),
    ).toEqual({ for: 15, pv: { cur: 3, max: 12 }, classe: 'Ladino' });
    expect(sanitizeValues(t, null)).toBeNull();
  });

  it('id de campo a partir do rótulo', () => {
    expect(fieldIdFromLabel('Força', new Set())).toBe('forca');
    expect(fieldIdFromLabel('Força', new Set(['forca']))).toBe('forca2');
    expect(fieldIdFromLabel('123', new Set())).toBe('campo');
  });

  it('intenções de ficha', () => {
    expect(parsePlayerIntent({ k: 'sheetNew', templateId: 'abcd1234', name: '  Zé ' })).toEqual({ k: 'sheetNew', templateId: 'abcd1234', name: 'Zé' });
    expect(parsePlayerIntent({ k: 'sheetSet', id: 'abcd1234', values: [] })).toBeNull();
    expect(parsePlayerIntent({ k: 'roll', expr: '1d20', priv: false, label: 'Força' })).toEqual({ k: 'roll', expr: '1d20', priv: false, label: 'Força' });
  });
});

describe('combate', () => {
  const c: Combat = {
    active: true, round: 1, current: 'a',
    entries: sortEntries([
      { id: 'a', name: 'Ana', init: 15, sheetId: 'sheet1' },
      { id: 'b', name: 'Lobo', init: 18, hidden: true },
      { id: 'c', name: 'Bia', init: 15 },
    ]),
  };

  it('ordena por iniciativa mantendo empates', () => {
    expect(c.entries.map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('turnos e rodadas', () => {
    const s1 = stepTurn(c, 1);
    expect(s1.current).toBe('c');
    const s2 = stepTurn(s1, 1);
    expect([s2.current, s2.round]).toEqual(['b', 2]);
    expect(stepTurn(s2, -1)).toMatchObject({ current: 'c', round: 1 });
  });

  it('jogador não vê entradas ocultas nem ids de fichas alheias', () => {
    const bia = { role: 'player' as const, pid: 'bia00000' };
    const sheets = { sheet1: sheetOf(tpl(0)) };
    const v = combatForPlayer({ ...c, current: 'b' }, bia, sheets);
    expect(v.entries.map((e) => e.id)).toEqual(['a', 'c']);
    expect(v.current).toBeUndefined();
    expect(v.entries[0].sheetId).toBeUndefined();
    expect(combatForPlayer(c, { role: 'player', pid: 'ana00000' }, sheets).entries[0].sheetId).toBe('sheet1');
  });
});
