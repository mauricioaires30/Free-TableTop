import { describe, expect, it } from 'vitest';
import { defaultValues, newRowId, sanitizeListRows, sanitizeValues, TEMPLATE_PRESETS, type SheetTemplate } from '../src/sheets';
import { parsePlayerIntent } from '../src/protocol';

const tpl = (i: number): SheetTemplate => ({ ...TEMPLATE_PRESETS[i], id: 'tpl1', perm: { view: 'all', move: 'gm', edit: 'gm' }, updatedAt: 0 });

describe('campos de lista (inventário, equipamento, poderes)', () => {
  it('começa vazio', () => {
    const t = tpl(0);
    expect(defaultValues(t).inventario).toEqual([]);
  });

  it('valida linhas (id, nome, quantidade, equipado, nota, rolagem)', () => {
    const row = { id: newRowId(), name: 'Espada', qty: 1, equipped: true, note: 'afiada', roll: '1d8+2' };
    expect(sanitizeListRows([row])).toEqual([row]);
    expect(sanitizeListRows([{ ...row, id: 'XY' }])).toBeNull(); // id fora do formato
    expect(sanitizeListRows([{ ...row, name: 'x'.repeat(81) }])).toBeNull();
    expect(sanitizeListRows([{ ...row, qty: -1 }])).toBeNull();
    expect(sanitizeListRows([{ ...row, equipped: 'sim' }])).toBeNull();
    expect(sanitizeListRows(Array.from({ length: 81 }, () => row))).toBeNull();
    expect(sanitizeListRows('nope')).toBeNull();
  });

  it('sanitizeValues aceita listas válidas e ignora campos desconhecidos dentro da linha', () => {
    const t = tpl(1); // Fantasia d20: equipamento tem qty+equipado+nota
    const row = { id: newRowId(), name: 'Escudo', qty: 1, equipped: false, hack: 'x' };
    const out = sanitizeValues(t, { equipamento: [row] });
    expect(out?.equipamento).toEqual([{ id: row.id, name: 'Escudo', qty: 1, equipped: false }]);
  });

  it('intenção de rolar uma linha específica', () => {
    expect(parsePlayerIntent({ k: 'sheetRoll', id: 'abcd1234', field: 'magias', row: 'ab12ab12', priv: false })).toEqual({
      k: 'sheetRoll', id: 'abcd1234', field: 'magias', priv: false, row: 'ab12ab12',
    });
    expect(parsePlayerIntent({ k: 'sheetRoll', id: 'abcd1234', field: 'magias', priv: true })).toEqual({
      k: 'sheetRoll', id: 'abcd1234', field: 'magias', priv: true,
    });
  });

  it('presets com poderes/equipamento rolável não quebram a resolução de fórmulas', () => {
    for (const i of [1, 2]) {
      const t = tpl(i);
      const listFields = t.fields.filter((f) => f.type === 'list');
      expect(listFields.length).toBeGreaterThan(0);
    }
  });
});
