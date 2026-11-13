import { describe, expect, it } from 'vitest';
import { DEFAULT_TABLES, parseRows, pickRow, rollTable, rowsToText } from '../src/tables';
import { logToJournal, renderNote, wikiLinks } from '../src/notes';
import { parsePlayerIntent, type LogEntry } from '../src/protocol';

const byName = (n: string) => DEFAULT_TABLES.find((t) => t.name === n);

describe('tabelas aleatórias', () => {
  it('respeita pesos', () => {
    const rows = [{ w: 3, text: 'a' }, { w: 1, text: 'b' }];
    expect(pickRow(rows, () => 0)?.text).toBe('a');
    expect(pickRow(rows, () => 2)?.text).toBe('a');
    expect(pickRow(rows, () => 3)?.text).toBe('b');
    expect(pickRow([], () => 0)).toBeNull();
  });

  it('resolve tabelas aninhadas e dados no texto', () => {
    const name = rollTable(byName('Nome completo')!, byName);
    expect(name).toMatch(/^\S+ \S+$/);
    expect(name).not.toContain('[');
    const t = { name: 'x', rows: [{ w: 1, text: '{2+1} moedas e [Inexistente]' }] };
    expect(rollTable(t, byName)).toBe('3 moedas e [Inexistente]');
  });

  it('não entra em laço infinito', () => {
    const loop = { name: 'Loop', rows: [{ w: 1, text: 'a[Loop]' }] };
    expect(rollTable(loop, () => loop)).toBe('aaaaa[Loop]');
  });

  it('todos os geradores prontos rolam sem sobrar referência', () => {
    for (const t of DEFAULT_TABLES) {
      for (let i = 0; i < 20; i++) expect(rollTable(t, byName)).not.toMatch(/\[[^\]]+\]|\{[^}]+\}/);
    }
  });

  it('texto ↔ linhas com peso', () => {
    const rows = parseRows('3: Goblin\nLobo\n\n 2 | Urso ');
    expect(rows).toEqual([{ w: 3, text: 'Goblin' }, { w: 1, text: 'Lobo' }, { w: 2, text: 'Urso' }]);
    expect(rowsToText(rows)).toBe('3: Goblin\nLobo\n2: Urso');
  });
});

describe('diário e wiki', () => {
  it('rascunho do diário ignora mensagens privadas', () => {
    const log: LogEntry[] = [
      { id: '1', ts: 0, from: 'a', name: 'Ana', kind: 'chat', text: 'Vamos!' },
      { id: '2', ts: 0, from: 'a', name: 'Ana', kind: 'chat', text: 'segredo', to: [] },
      { id: '3', ts: 0, from: 'gm', name: 'Mestre', kind: 'roll', label: 'Força', roll: { expr: '1d20', total: 12, parts: [] } },
    ];
    const txt = logToJournal(log);
    expect(txt).toContain('Ana: Vamos!');
    expect(txt).toContain('Mestre (Força): 🎲');
    expect(txt).not.toContain('segredo');
  });

  it('links e formatação sem injetar HTML', () => {
    expect(wikiLinks('Fale com [[Bento]] na [[Taverna do Vau]].')).toEqual(['Bento', 'Taverna do Vau']);
    const html = renderNote('# Título\n**forte** <script>x</script> [[Bento]] [[Nada]]', (t) => t === 'Bento');
    expect(html).toContain('<h3>Título</h3>');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('class="wl" data-page="Bento"');
    expect(html).toContain('class="wl missing" data-page="Nada"');
  });

  it('intenções de notas, tabelas e relógio', () => {
    expect(parsePlayerIntent({ k: 'docEdit', col: 'wiki', id: 'abcd1234', patch: { text: 'oi', hack: 1 } })).toEqual({
      k: 'docEdit', col: 'wiki', id: 'abcd1234', patch: { text: 'oi' },
    });
    expect(parsePlayerIntent({ k: 'docEdit', col: 'sheets', id: 'abcd1234', patch: {} })).toBeNull();
    expect(parsePlayerIntent({ k: 'tableRoll', id: 'abcd1234' })).toEqual({ k: 'tableRoll', id: 'abcd1234', priv: false });
    expect(parsePlayerIntent({ k: 'edit', id: 'abcd1234', patch: { filled: 3 } })).toEqual({ k: 'edit', id: 'abcd1234', patch: { filled: 3 } });
    expect(parsePlayerIntent({ k: 'edit', id: 'abcd1234', patch: { filled: 99 } })).toBeNull();
  });
});
