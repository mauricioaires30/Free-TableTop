// Tabelas aleatórias e geradores. Uma linha pode citar outra tabela com [Nome]
// e rolar dados no meio do texto com {2d6}.
import { rollDice } from './dice';
import type { Perm } from './permissions';

export interface TableRow {
  /** Peso: linhas com peso maior saem mais vezes. */
  w: number;
  text: string;
}

export interface RandomTable {
  id: string;
  perm: Perm;
  updatedAt: number;
  name: string;
  /** Agrupa na lista (ex.: "Nomes", "Tesouros"). */
  category?: string;
  rows: TableRow[];
}

export const MAX_TABLE_DEPTH = 4;

/** Inteiro em [0, n) com crypto. */
function pick(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

export function pickRow(rows: TableRow[], rand: (n: number) => number = pick): TableRow | null {
  const valid = rows.filter((r) => r.w > 0 && r.text.trim());
  const total = valid.reduce((s, r) => s + r.w, 0);
  if (!total) return null;
  let x = rand(total);
  for (const r of valid) {
    if (x < r.w) return r;
    x -= r.w;
  }
  return valid[valid.length - 1];
}

/**
 * Rola uma tabela e resolve referências: [Outra tabela] vira o resultado dela,
 * {1d6} vira o total da rolagem. Referências desconhecidas ficam como estão.
 */
export function rollTable(
  table: Pick<RandomTable, 'name' | 'rows'>,
  byName: (name: string) => Pick<RandomTable, 'name' | 'rows'> | undefined,
  rand: (n: number) => number = pick,
  depth = 0,
): string {
  const row = pickRow(table.rows, rand);
  if (!row) return '(tabela vazia)';
  let text = row.text;
  if (depth < MAX_TABLE_DEPTH) {
    text = text.replace(/\[([^\]]{1,60})\]/g, (m, name: string) => {
      const t = byName(name.trim());
      return t ? rollTable(t, byName, rand, depth + 1) : m;
    });
  }
  return text.replace(/\{([^}]{1,40})\}/g, (m, expr: string) => {
    try {
      return String(rollDice(expr).total);
    } catch {
      return m;
    }
  });
}

/** Converte texto com uma linha por resultado ("3: texto" define peso 3). */
export function parseRows(text: string): TableRow[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((l) => {
      const m = /^(\d{1,3})\s*[:|]\s*(.+)$/.exec(l);
      return m ? { w: Math.max(1, parseInt(m[1], 10)), text: m[2].slice(0, 300) } : { w: 1, text: l.slice(0, 300) };
    });
}

export function rowsToText(rows: TableRow[]): string {
  return rows.map((r) => (r.w !== 1 ? `${r.w}: ${r.text}` : r.text)).join('\n');
}

const rows = (list: string): TableRow[] => list.split('|').map((text) => ({ w: 1, text: text.trim() }));

type Preset = Omit<RandomTable, 'id' | 'perm' | 'updatedAt'>;

/** Geradores prontos (o mestre pode editar ou apagar). */
export const DEFAULT_TABLES: Preset[] = [
  {
    name: 'Nome masculino',
    category: 'Nomes',
    rows: rows('Aldo|Bento|Caio|Davi|Elias|Fausto|Gaspar|Heitor|Ícaro|Jonas|Lauro|Mateus|Nuno|Otávio|Pedro|Quirino|Rui|Silvano|Tobias|Valter|Artur|Breno|Cícero|Dário|Estevão'),
  },
  {
    name: 'Nome feminino',
    category: 'Nomes',
    rows: rows('Alice|Beatriz|Cecília|Dalva|Elisa|Flora|Glória|Helena|Inês|Joana|Lívia|Marta|Nair|Olga|Paula|Rita|Sara|Teresa|Úrsula|Vera|Aurora|Clara|Diana|Iara|Luna'),
  },
  {
    name: 'Sobrenome',
    category: 'Nomes',
    rows: rows('Almeida|Barros|Cardoso|Duarte|Esteves|Faria|Guedes|Lacerda|Macedo|Nogueira|Pacheco|Queiroz|Rezende|Siqueira|Teixeira|Vasconcelos|Moura|Prado|Tavares|Valença'),
  },
  {
    name: 'Nome completo',
    category: 'Nomes',
    rows: [{ w: 1, text: '[Nome masculino] [Sobrenome]' }, { w: 1, text: '[Nome feminino] [Sobrenome]' }],
  },
  {
    name: 'Taverna',
    category: 'Lugares',
    rows: rows(
      'O Javali Dourado|A Caneca Rachada|O Corvo Bêbado|A Lanterna Torta|O Barril sem Fundo|A Sereia Cansada|O Dragão Sonolento|A Última Vela|O Cavalo Manco|A Estalagem do Vau|O Pote de Cobre|A Raposa Risonha',
    ),
  },
  {
    name: 'Clima',
    category: 'Viagem',
    rows: [
      { w: 4, text: 'Céu limpo e calor moderado.' },
      { w: 3, text: 'Nublado, vento frio.' },
      { w: 2, text: 'Chuva fina o dia todo.' },
      { w: 1, text: 'Tempestade forte: viagem pela metade.' },
      { w: 1, text: 'Neblina densa: visão reduzida a {2d6} metros.' },
    ],
  },
  {
    name: 'Encontro na estrada',
    category: 'Viagem',
    rows: rows(
      'Um mercador com a carroça quebrada pede ajuda.|{1d4+1} bandidos bloqueiam a estrada.|Um peregrino ferido conta sobre [Gancho de aventura]|Pegadas enormes cruzam o caminho.|Uma patrulha desconfiada pede documentos.|Uma criança perdida procura a família.|Um corpo caído com uma carta lacrada.|Nada acontece, mas alguém os observa de longe.',
    ),
  },
  {
    name: 'Gancho de aventura',
    category: 'Histórias',
    rows: rows(
      'um poço que sussurra à noite.|uma herdeira desaparecida.|um mapa rasgado em três partes.|um sino que toca sozinho.|uma vila onde ninguém dorme.|um contrato assinado com sangue.|uma estátua que muda de lugar.|um navio que voltou sem tripulação.',
    ),
  },
  {
    name: 'Traço de NPC',
    category: 'Histórias',
    rows: rows(
      'Fala alto demais.|Desconfia de todos.|Coleciona coisas estranhas.|Nunca olha nos olhos.|Ri de nervoso.|Mente sem motivo.|Generoso até demais.|Tem uma cicatriz que esconde.|Cita ditados o tempo todo.|Está sempre com fome.',
    ),
  },
  {
    name: 'Tesouro',
    category: 'Tesouros',
    rows: [
      { w: 5, text: '{2d10} moedas de prata.' },
      { w: 3, text: '{1d6} moedas de ouro e uma bolsa de couro gasta.' },
      { w: 2, text: 'Um anel com um brasão desconhecido.' },
      { w: 2, text: 'Uma poção de cor estranha.' },
      { w: 1, text: 'Um mapa para [Gancho de aventura]' },
      { w: 1, text: 'Uma arma de boa qualidade com uma runa gravada.' },
    ],
  },
];

export const TABLE_PERM: Perm = { view: 'gm', move: 'gm', edit: 'gm' };
