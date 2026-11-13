import { describe, expect, it } from 'vitest';
import { can, type Perm } from '../src/permissions';
import { itemForPlayer, type BoardItem } from '../src/board';
import { logVisibleTo, parsePlayerIntent, type LogEntry } from '../src/protocol';

const gm = { role: 'gm' as const, pid: 'gm' };
const ana = { role: 'player' as const, pid: 'ana00000' };
const bia = { role: 'player' as const, pid: 'bia00000' };

const item = (perm: Perm, extra: Partial<BoardItem> = {}): BoardItem => ({
  id: 'item1', type: 'note', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 0, perm, ...extra,
});

describe('permissões', () => {
  it('mestre pode tudo', () => {
    expect(can(gm, 'edit', item({ view: 'gm', move: 'gm', edit: 'gm' }))).toBe(true);
  });

  it('padrão: todos veem, só o mestre mexe', () => {
    const i = item({ view: 'all', move: 'gm', edit: 'gm' });
    expect(can(ana, 'view', i)).toBe(true);
    expect(can(ana, 'move', i)).toBe(false);
  });

  it('dono e listas', () => {
    const i = item({ view: 'all', move: 'owner', edit: [bia.pid], owner: ana.pid });
    expect(can(ana, 'move', i)).toBe(true);
    expect(can(bia, 'move', i)).toBe(false);
    expect(can(bia, 'edit', i)).toBe(true);
    expect(can(ana, 'edit', i)).toBe(false);
  });

  it('não pode mexer no que não vê', () => {
    const i = item({ view: [bia.pid], move: 'all', edit: 'all' });
    expect(can(ana, 'move', i)).toBe(false);
    expect(itemForPlayer(i, ana)).toBeNull();
    expect(itemForPlayer(i, bia)).not.toBeNull();
  });

  it('verso da carta só depois de revelado', () => {
    const card = item({ view: 'all', move: 'gm', edit: 'gm' }, { type: 'card', back: 'segredo' });
    expect(itemForPlayer(card, ana)?.back).toBeUndefined();
    expect(itemForPlayer(card, gm)?.back).toBe('segredo');
    expect(itemForPlayer({ ...card, revealed: true }, ana)?.back).toBe('segredo');
  });

  it('visibilidade do log', () => {
    const e: LogEntry = { id: 'x', ts: 0, from: ana.pid, name: 'Ana', kind: 'roll', to: [] };
    expect(logVisibleTo(e, ana.pid)).toBe(true);
    expect(logVisibleTo(e, bia.pid)).toBe(false);
    expect(logVisibleTo({ ...e, to: undefined }, bia.pid)).toBe(true);
  });

  it('valida intenções do jogador', () => {
    expect(parsePlayerIntent({ k: 'chat', text: 'oi' })).toEqual({ k: 'chat', text: 'oi' });
    expect(parsePlayerIntent({ k: 'chat', text: 'x'.repeat(5000) })).toBeNull();
    expect(parsePlayerIntent({ k: 'transform', id: 'abcd1234', patch: { x: 'a' } })).toBeNull();
    expect(parsePlayerIntent({ k: 'transform', id: 'abcd1234', patch: { x: 5, perm: 'all' } })).toEqual({
      k: 'transform', id: 'abcd1234', patch: { x: 5 }, final: false,
    });
    expect(parsePlayerIntent({ k: 'edit', id: 'abcd1234', patch: { back: 'hack', revealed: true } })).toEqual({
      k: 'edit', id: 'abcd1234', patch: {},
    });
    expect(parsePlayerIntent({ k: 'nope' })).toBeNull();
  });
});
