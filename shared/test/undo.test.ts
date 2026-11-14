import { describe, expect, it } from 'vitest';
import { diffBoard, UndoHistory } from '../src/undo';

describe('desfazer', () => {
  it('acha itens criados, mudados e apagados', () => {
    const a = new Map([['1', 'a'], ['2', 'b']]);
    const b = new Map([['2', 'B'], ['3', 'c']]);
    expect(diffBoard(a, b)).toEqual([
      { id: '2', before: 'b', after: 'B' },
      { id: '3', before: null, after: 'c' },
      { id: '1', before: 'a', after: null },
    ]);
    expect(diffBoard(a, new Map(a))).toEqual([]);
  });

  it('pilha de desfazer e refazer', () => {
    const h = new UndoHistory(2);
    const c = (id: string) => ({ items: [{ id, before: null, after: id }] });
    h.push(c('1'));
    h.push(c('2'));
    h.push(c('3'));
    expect(h.undo()?.items[0].id).toBe('3');
    expect(h.canRedo).toBe(true);
    expect(h.redo()?.items[0].id).toBe('3');
    h.undo();
    h.push(c('4'));
    expect(h.canRedo).toBe(false);
    expect(h.undo()?.items[0].id).toBe('4');
    expect(h.undo()?.items[0].id).toBe('2');
    expect(h.undo()).toBeUndefined();
  });
});
