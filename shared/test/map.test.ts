import { describe, expect, it } from 'vitest';
import { compactFog, DEFAULT_MAP, fogCovers, formatDistance, gridDistance, hexCenter, isFogShape, simplifyStroke, snapToGrid } from '../src/map';
import { drawOrder, type BoardItem } from '../src/board';
import { parsePlayerIntent } from '../src/protocol';

const sq = { ...DEFAULT_MAP.grid, enabled: true, size: 50 };
const hex = { ...sq, type: 'hex' as const };

describe('mapa', () => {
  it('grid quadrado: encaixe e distancia com diagonal 1', () => {
    expect(snapToGrid(73, 26, 50, 50, sq)).toEqual({ x: 50, y: 50 });
    expect(gridDistance(0, 0, 150, 100, sq)).toBe(3);
    expect(formatDistance(3, sq)).toBe('3 quadrados · 4,5 m');
    expect(formatDistance(1, sq)).toBe('1 quadrado · 1,5 m');
  });

  it('grid hexagonal: centraliza no hex e conta hexes', () => {
    const c = hexCenter(2, 1, 50);
    const p = snapToGrid(c.x - 20 + 3, c.y - 20 - 4, 40, 40, hex);
    expect(p.x).toBeCloseTo(c.x - 20);
    expect(p.y).toBeCloseTo(c.y - 20);
    const a = hexCenter(0, 0, 50);
    const b = hexCenter(3, 0, 50);
    expect(gridDistance(a.x, a.y, b.x, b.y, hex)).toBe(3);
  });

  it('nevoa: compacta e valida', () => {
    const r = { op: 'reveal' as const, kind: 'rect' as const, pts: [0, 0, 10, 10] };
    const all = { op: 'hide' as const, kind: 'all' as const, pts: [] };
    expect(compactFog([r, r, all, r])).toEqual([all, r]);
    expect(isFogShape(r)).toBe(true);
    expect(isFogShape({ ...r, pts: [1, 2] })).toBe(false);
    expect(isFogShape({ op: 'x', kind: 'rect', pts: [0, 0, 1, 1] })).toBe(false);
    expect(simplifyStroke([0, 0, 1, 0, 2, 0, 30, 0, 31, 0], 10)).toEqual([0, 0, 30, 0, 31, 0]);
  });

  it('camadas: mapa embaixo, tokens em cima', () => {
    const base = { x: 0, y: 0, w: 1, h: 1, rotation: 0, perm: { view: 'all', move: 'gm', edit: 'gm' } } as const;
    const items: BoardItem[] = [
      { ...base, id: 'tok', type: 'token', z: 1 },
      { ...base, id: 'map', type: 'image', z: 9, layer: 'map' },
      { ...base, id: 'note', type: 'note', z: 5 },
    ];
    expect(items.sort(drawOrder).map((i) => i.id)).toEqual(['map', 'note', 'tok']);
  });

  it('intencoes de regua, ping e condicoes', () => {
    expect(parsePlayerIntent({ k: 'ruler', pts: [0, 0, 10, 10] })).toEqual({ k: 'ruler', pts: [0, 0, 10, 10] });
    expect(parsePlayerIntent({ k: 'ruler', pts: [0, 0, 10] })).toBeNull();
    expect(parsePlayerIntent({ k: 'ping', x: 1, y: 2 })).toEqual({ k: 'ping', x: 1, y: 2 });
    expect(parsePlayerIntent({ k: 'edit', id: 'abcd1234', patch: { conditions: ['Caído'] } })).toEqual({
      k: 'edit', id: 'abcd1234', patch: { conditions: ['Caído'] },
    });
    expect(parsePlayerIntent({ k: 'edit', id: 'abcd1234', patch: { conditions: 'Caído' } })).toBeNull();
  });
});

describe('névoa bloqueia clique', () => {
  const base = { enabled: true, shapes: [] as import('../src/map').FogShape[] };
  it('sem névoa ligada nunca cobre', () => {
    expect(fogCovers({ ...base, enabled: false }, 5, 5)).toBe(false);
  });
  it('tudo coberto por padrão quando ligada', () => {
    expect(fogCovers(base, 5, 5)).toBe(true);
  });
  it('retângulo revelado deixa clicar só dentro dele', () => {
    const fog = { ...base, shapes: [{ op: 'reveal' as const, kind: 'rect' as const, pts: [0, 0, 100, 100] }] };
    expect(fogCovers(fog, 50, 50)).toBe(false);
    expect(fogCovers(fog, 200, 200)).toBe(true);
  });
  it('um esconder depois de revelar volta a cobrir (ordem importa)', () => {
    const fog = {
      ...base,
      shapes: [
        { op: 'reveal' as const, kind: 'rect' as const, pts: [0, 0, 100, 100] },
        { op: 'hide' as const, kind: 'rect' as const, pts: [20, 20, 30, 30] },
      ],
    };
    expect(fogCovers(fog, 35, 35)).toBe(true);
    expect(fogCovers(fog, 80, 80)).toBe(false);
  });
  it('pincel revela dentro do raio do traço', () => {
    const fog = { ...base, shapes: [{ op: 'reveal' as const, kind: 'brush' as const, pts: [0, 0, 100, 0], r: 20 }] };
    expect(fogCovers(fog, 50, 5)).toBe(false);
    expect(fogCovers(fog, 50, 50)).toBe(true);
  });
});
