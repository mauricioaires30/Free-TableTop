// Filtro de palavras pesadas (português, inglês e espanhol).
// Pega variações com acento, leetspeak (p0rr4), letras repetidas (porrrraaa)
// e letras separadas (p.o.r.r.a / p o r r a), sem pegar palavras inocentes
// que só contêm o termo no meio (computador, disputa, rola o dado...).

export interface FilterConfig {
  enabled: boolean;
  /**
   * user: cada pessoa escolhe na própria tela se esconde os palavrões (padrão);
   * censor: troca por **** para todos; block: a mensagem não é enviada.
   */
  mode: 'user' | 'censor' | 'block';
  words: string[];
  /** Versão da lista padrão já incluída (para somar palavras novas em campanhas antigas). */
  listVersion?: number;
}

export const PT_BAD_WORDS: string[] = [
  'porra', 'caralho', 'krl', 'crl', 'puta', 'puto', 'putaria', 'pqp', 'merda', 'bosta',
  'buceta', 'boceta', 'xoxota', 'xereca', 'piroca', 'punheta', 'cu', 'cuzao', 'cuzinho',
  'foder', 'fode', 'fodeu', 'fodido', 'fodida', 'fodendo', 'foda', 'fodase', 'foda se',
  'fdp', 'filho da puta', 'filha da puta', 'vsf', 'vai se foder', 'vtnc', 'tnc',
  'vai tomar no cu', 'tomar no cu', 'arrombado', 'arrombada', 'vagabunda', 'vagabundo',
  'vadia', 'viado', 'traveco', 'retardado', 'retardada', 'escroto', 'escrota', 'cacete',
  'kct', 'corno', 'babaca', 'desgracado', 'desgracada', 'otario', 'otaria', 'piranha',
];

/** Inglês ("ass" e "dick" sozinhos ficam de fora: pegariam "as" e nomes). */
export const EN_BAD_WORDS: string[] = [
  'fuck', 'fck', 'fuk', 'motherfucker', 'shit', 'bullshit', 'bitch', 'asshole', 'dumbass', 'jackass', 'cunt',
  'bastard', 'whore', 'slut', 'faggot', 'fag', 'nigger', 'nigga', 'retard', 'dickhead', 'pussy', 'twat',
  'wanker', 'bollocks', 'cocksucker', 'wtf', 'stfu', 'gtfo', 'son of a bitch',
];

/** Espanhol. */
export const ES_BAD_WORDS: string[] = [
  'mierda', 'joder', 'jodido', 'jodida', 'cono', 'pendejo', 'pendeja', 'cabron', 'cabrona', 'gilipollas',
  'hijo de puta', 'hija de puta', 'carajo', 'chingada', 'chingar', 'pinche', 'culero', 'maricon', 'verga',
  'puta madre', 'hdp', 'ctm', 'malparido', 'malparida',
];

export const DEFAULT_BAD_WORDS: string[] = [...PT_BAD_WORDS, ...EN_BAD_WORDS, ...ES_BAD_WORDS];
/** Sobe quando a lista padrão ganha palavras novas. */
export const BAD_WORDS_VERSION = 2;

export const DEFAULT_FILTER: FilterConfig = { enabled: true, mode: 'user', words: DEFAULT_BAD_WORDS, listVersion: BAD_WORDS_VERSION };

/** Campanhas antigas: soma as palavras novas da lista padrão (sem tirar as do mestre). */
export function upgradeFilter(cfg: FilterConfig): FilterConfig | null {
  if ((cfg.listVersion ?? 1) >= BAD_WORDS_VERSION) return null;
  const have = new Set(cfg.words.map(normalizeWord));
  const add = [...EN_BAD_WORDS, ...ES_BAD_WORDS].filter((w) => !have.has(normalizeWord(w)));
  // O antigo padrão "censurar para todos" vira "cada um escolhe".
  return { ...cfg, mode: cfg.mode === 'censor' ? 'user' : cfg.mode, words: [...cfg.words, ...add], listVersion: BAD_WORDS_VERSION };
}

/** Sufixos tolerados depois da palavra (plural, gênero, diminutivo...). */
const SUFFIXES = ['', 's', 'a', 'o', 'as', 'os', 'e', 'es', 'ao', 'oes', 'inho', 'inha', 'zinho', 'zinha', 'zao', 'ada', 'ado', 'udo', 'uda'];
/** Sufixos do inglês (fucking, fucker, fucked, shitty...): só valem sobre a palavra exata. */
const EN_SUFFIXES = ['ing', 'in', 'er', 'ers', 'ed', 'y', 'ty', 'head', 'face'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Junta letras repetidas: porrrraaa → pora. */
function collapse(s: string): string {
  return s.replace(/(.)\1+/g, '$1');
}

/** Normaliza uma palavra da lista (sem leet, só minúsculas/acentos/repetições). */
export function normalizeWord(w: string): string {
  return stripAccents(w.toLowerCase())
    .replace(/[^a-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(collapse)
    .join(' ');
}

interface Token {
  norm: string;
  start: number;
  end: number; // exclusivo
}

function isAlnum(c: string | undefined): boolean {
  return !!c && /[a-z0-9]/i.test(stripAccents(c));
}

/** Converte um caractere do texto original para letra normalizada (ou null se for separador). */
function normChar(text: string, i: number): string | null {
  const c = text[i];
  const base = stripAccents(c.toLowerCase());
  if (/[a-z]/.test(base)) return base;
  if (/[0-9]/.test(base)) return LEET[base] ?? null;
  if (c === '@') return isAlnum(text[i - 1]) || isAlnum(text[i + 1]) ? 'a' : null;
  if (c === '$') return isAlnum(text[i + 1]) ? 's' : null;
  if (c === '!') return isAlnum(text[i - 1]) && isAlnum(text[i + 1]) ? 'i' : null;
  return null;
}

function tokenize(text: string): Token[] {
  const raw: Token[] = [];
  let cur: Token | null = null;
  for (let i = 0; i < text.length; i++) {
    const n = normChar(text, i);
    if (n) {
      if (!cur) cur = { norm: '', start: i, end: i };
      cur.norm += n;
      cur.end = i + 1;
    } else if (cur) {
      raw.push(cur);
      cur = null;
    }
  }
  if (cur) raw.push(cur);

  // Junta sequências de letras soltas: "p o r r a" → "porra".
  const out: Token[] = [];
  for (let i = 0; i < raw.length; ) {
    if (raw[i].norm.length === 1) {
      let j = i;
      let norm = '';
      while (j < raw.length && raw[j].norm.length === 1) norm += raw[j++].norm;
      if (j - i >= 3) {
        out.push({ norm, start: raw[i].start, end: raw[j - 1].end });
        i = j;
        continue;
      }
    }
    out.push(raw[i++]);
  }
  for (const t of out) t.norm = collapse(t.norm);
  return out;
}

export class WordFilter {
  private single = new Set<string>();
  private phrases: string[][] = [];

  constructor(words: string[]) {
    for (const w of words) {
      const n = normalizeWord(w);
      if (!n) continue;
      if (n.includes(' ')) this.phrases.push(n.split(' '));
      else this.single.add(n);
    }
  }

  private matchesWord(token: string): boolean {
    if (this.single.has(token)) return true;
    for (const suf of SUFFIXES) {
      if (!suf || !token.endsWith(suf)) continue;
      const stem = token.slice(0, -suf.length);
      // Evita que palavras de 1-2 letras ("cu") casem por sufixo ("cus" ok, mas não "cuo").
      if (stem.length >= 3 && this.single.has(stem)) return true;
      // Diminutivo/aumentativo troca a vogal final: puta → putinha, caralho → caralhão.
      if (stem.length >= 3 && suf.length >= 2 && ['a', 'o', 'e'].some((v) => this.single.has(stem + v))) return true;
      if (stem.length < 3 && suf === 's' && this.single.has(stem)) return true;
    }
    for (const suf of EN_SUFFIXES) {
      if (!token.endsWith(suf)) continue;
      const stem = token.slice(0, -suf.length);
      if (stem.length >= 3 && this.single.has(stem)) return true;
    }
    return false;
  }

  /** Retorna os trechos [start, end) do texto original que são palavrões. */
  find(text: string): Array<[number, number]> {
    const tokens = tokenize(text);
    const hits: Array<[number, number]> = [];
    const used = new Set<number>();
    for (const phrase of this.phrases) {
      for (let i = 0; i + phrase.length <= tokens.length; i++) {
        let ok = true;
        for (let k = 0; k < phrase.length && ok; k++) {
          const t = tokens[i + k].norm;
          ok = k === phrase.length - 1 ? t === phrase[k] || t === phrase[k] + 's' : t === phrase[k];
        }
        if (ok) {
          hits.push([tokens[i].start, tokens[i + phrase.length - 1].end]);
          for (let k = 0; k < phrase.length; k++) used.add(i + k);
        }
      }
    }
    tokens.forEach((t, i) => {
      if (!used.has(i) && this.matchesWord(t.norm)) hits.push([t.start, t.end]);
    });
    return hits.sort((a, b) => a[0] - b[0]);
  }

  check(text: string): boolean {
    return this.find(text).length > 0;
  }

  censor(text: string): string {
    const hits = this.find(text);
    if (!hits.length) return text;
    let out = '';
    let pos = 0;
    for (const [s, e] of hits) {
      if (s < pos) continue;
      out += text.slice(pos, s) + text.slice(s, e).replace(/\S/g, '*');
      pos = e;
    }
    return out + text.slice(pos);
  }
}

export type FilterOutcome = { ok: true; text: string; censored: boolean } | { ok: false; reason: string };

export function applyFilter(config: FilterConfig, text: string, filter = new WordFilter(config.words)): FilterOutcome {
  // No modo "user" o texto vai como está; cada tela esconde (ou não) do seu lado.
  if (!config.enabled || config.mode === 'user') return { ok: true, text, censored: false };
  if (!filter.check(text)) return { ok: true, text, censored: false };
  if (config.mode === 'block') return { ok: false, reason: 'Mensagem bloqueada pelo filtro de palavras da mesa.' };
  return { ok: true, text: filter.censor(text), censored: true };
}
