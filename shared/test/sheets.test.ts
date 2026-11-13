import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTRIBUTES as A, defaultValues, fieldIdFromLabel, FormulaError, resolveFormula, sanitizeValues, templateAttrs,
  TEMPLATE_PRESETS, type Sheet, type SheetTemplate,
} from '../src/sheets';
import { combatForPlayer, sortEntries, stepTurn, type Combat } from '../src/combat';
import { parseDice } from '../src/dice';
import { parsePlayerIntent } from '../src/protocol';

const tpl = (i: number): SheetTemplate => ({ ...TEMPLATE_PRESETS[i], id: 'tpl1', perm: { view: 'all', move: 'gm', edit: 'gm' }, updatedAt: 0 });
const sheetOf = (t: SheetTemplate, values: Sheet['values'] = {}): Sheet => ({
  id: 'sheet1', perm: { view: 'owner', move: 'gm', edit: 'owner', owner: 'ana00000' }, updatedAt: 0,
  templateId: t.id, name: 'Ana', kind: 'pc', values: { ...defaultValues(t, A), ...values },
});

describe('fichas', () => {
  it('modelos prontos têm fórmulas válidas', () => {
    for (let i = 0; i < TEMPLATE_PRESETS.length; i++) {
      const t = tpl(i);
      const s = sheetOf(t);
      const ta = templateAttrs(t, A);
      for (const { def } of ta) s.values[def.id] = 2;
      for (const f of t.fields) {
        if (f.roll && f.type !== 'attrs') expect(() => parseDice(resolveFormula(f.roll!, s, t, f.id, A)), f.roll).not.toThrow();
      }
      for (const { def, block } of ta) expect(() => parseDice(resolveFormula(block.roll!, s, t, def.id, A)), block.roll).not.toThrow();
      if (t.initiative) expect(() => parseDice(resolveFormula(t.initiative!, s, t, undefined, A))).not.toThrow();
      const ids = t.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('modificador estilo d20', () => {
    const t = tpl(1);
    const s = sheetOf(t, { des: 14, for: 8 });
    expect(resolveFormula('1d20+{mod}', s, t, 'des', A)).toBe('1d20+2');
    expect(resolveFormula('1d20+{mod}', s, t, 'for', A)).toBe('1d20-1');
    expect(resolveFormula(t.initiative!, s, t, undefined, A)).toBe('1d20+2');
    expect(resolveFormula('{pv.max}', s, t, undefined, A)).toBe('10');
    // Atributo que o modelo não usa não vale na fórmula.
    expect(() => resolveFormula('{agi}', s, t, undefined, A)).toThrow(FormulaError);
  });

  it('atributo como quantidade de dados', () => {
    const t = tpl(2);
    const s = sheetOf(t, { agi: 3 });
    expect(resolveFormula('{v}d20kh1', s, t, 'agi', A)).toBe('3d20kh1');
    expect(resolveFormula(t.initiative!, s, t, undefined, A)).toBe('3d20kh1');
  });

  it('referência inexistente dá erro claro', () => {
    const t = tpl(0);
    expect(() => resolveFormula('1d20+{xyz}', sheetOf(t), t)).toThrow(FormulaError);
    expect(() => resolveFormula('{v}d6', sheetOf(t), t)).toThrow(FormulaError);
  });

  it('valida valores enviados pelo jogador', () => {
    const t = tpl(1);
    expect(
      sanitizeValues(t, { for: 15, pv: { cur: 3, max: 12 }, classe: 'Ladino', hack: 1, atributos: 'x', des: 'muito', ca: Infinity, agi: 3 }, A),
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

describe('v0.7.0', () => {
  it('ficha de jogador é a que tem dono', async () => {
    const { isPlayerSheet } = await import('../src/sheets');
    expect(isPlayerSheet({ kind: 'pc', perm: { view: 'owner', move: 'gm', edit: 'owner', owner: 'ana00000' } })).toBe(true);
    expect(isPlayerSheet({ kind: 'pc', perm: { view: 'gm', move: 'gm', edit: 'gm' } })).toBe(false);
    expect(isPlayerSheet({ kind: 'npc', perm: { view: 'gm', move: 'gm', edit: 'gm', owner: 'x' } })).toBe(false);
  });

  it('girar mantém o centro no lugar', async () => {
    const { rotateAroundCenter } = await import('../src/board');
    let it = { x: 10, y: 20, w: 100, h: 60, rotation: 0 };
    const center = (i: typeof it) => {
      const r = (i.rotation * Math.PI) / 180;
      return [i.x + 50 * Math.cos(r) - 30 * Math.sin(r), i.y + 50 * Math.sin(r) + 30 * Math.cos(r)];
    };
    const c0 = center(it);
    for (let k = 0; k < 4; k++) {
      it = { ...it, ...rotateAroundCenter(it, 90) };
      const c = center(it);
      expect(c[0]).toBeCloseTo(c0[0]);
      expect(c[1]).toBeCloseTo(c0[1]);
    }
    expect(it.rotation).toBe(0);
    expect(it.x).toBeCloseTo(10);
    expect(rotateAroundCenter({ ...it, rotation: 10 }, -15).rotation).toBe(355);
  });

  it('pedaços da imagem do personagem', () => {
    const ok = { k: 'avatar', sheetId: 'abcd1234', i: 0, n: 2, data: 'QUJD' };
    expect(parsePlayerIntent(ok)).toEqual(ok);
    expect(parsePlayerIntent({ ...ok, n: 9 })).toBeNull();
    expect(parsePlayerIntent({ ...ok, i: 2 })).toBeNull();
    expect(parsePlayerIntent({ ...ok, data: '<script>' })).toBeNull();
    expect(parsePlayerIntent({ ...ok, data: 'A'.repeat(300_000) })).toBeNull();
  });
});

describe('v0.8.0', () => {
  it('jogador só mexe no próprio token', async () => {
    const { playerOwnsItem } = await import('../src/board');
    const tok = (owner?: string) => ({ type: 'token' as const, perm: { view: 'all', move: 'owner', edit: 'owner', owner } });
    expect(playerOwnsItem('ana00000', tok('ana00000'))).toBe(true);
    expect(playerOwnsItem('ana00000', tok('bia00000'))).toBe(false);
    expect(playerOwnsItem('ana00000', { type: 'note', perm: { view: 'all', move: 'all', edit: 'all' } })).toBe(false);
  });
});

describe('atributos da campanha', () => {
  it('atributo novo, ainda sem valor, usa o padrão do modelo', async () => {
    const { resolveFormula, TEMPLATE_PRESETS, DEFAULT_ATTRIBUTES } = await import('../src/sheets');
    const t = { ...TEMPLATE_PRESETS[1], id: 't', perm: { view: 'all', move: 'gm', edit: 'gm' }, updatedAt: 0 } as const;
    const tt = JSON.parse(JSON.stringify(t));
    tt.fields.find((f: { type: string }) => f.type === 'attrs').attrs.push('sorte');
    const attrs = [...DEFAULT_ATTRIBUTES, { id: 'sorte', label: 'Sorte' }];
    const s = { id: 's', perm: tt.perm, updatedAt: 0, templateId: 't', name: 'X', kind: 'npc' as const, values: {} };
    expect(resolveFormula('1d20+{mod}', s, tt, 'sorte', attrs)).toBe('1d20+0');
  });
});
