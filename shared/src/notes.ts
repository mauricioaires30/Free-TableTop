// Diário de sessões e wiki da campanha.
import { formatRoll } from './dice';
import type { Perm } from './permissions';
import type { LogEntry } from './protocol';

export interface JournalEntry {
  id: string;
  perm: Perm;
  updatedAt: number;
  title: string;
  /** Data da sessão (AAAA-MM-DD). */
  date: string;
  text: string;
}

export interface WikiPage {
  id: string;
  perm: Perm;
  updatedAt: number;
  title: string;
  text: string;
  tags: string[];
}

export const NOTE_PERM: Perm = { view: 'gm', move: 'gm', edit: 'gm' };
export const MAX_NOTE_TEXT = 50_000;

/** Rascunho do diário a partir do chat de um dia: falas e rolagens públicas. */
export function logToJournal(entries: LogEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.to) continue; // privados ficam de fora
    const time = new Date(e.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (e.kind === 'roll' && e.roll) lines.push(`${time} ${e.name}${e.label ? ` (${e.label})` : ''}: 🎲 ${formatRoll(e.roll)}`);
    else if (e.text) lines.push(`${time} ${e.name}: ${e.text}`);
  }
  return lines.join('\n');
}

/** Títulos citados com [[Título]]. */
export function wikiLinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]]{1,80})\]\]/g)].map((m) => m[1].trim());
}

/** Escapa HTML e aplica uma formatação mínima: # títulos, **negrito**, *itálico* e [[links]]. */
export function renderNote(text: string, hasPage: (title: string) => boolean): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return esc(text)
    .split('\n')
    .map((line) => {
      let l = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/\[\[([^\]]{1,80})\]\]/g, (_m, t: string) => {
          const title = t.trim();
          const cls = hasPage(title) ? 'wl' : 'wl missing';
          return `<a href="#" class="${cls}" data-page="${title}">${title}</a>`;
        });
      const h = /^(#{1,3})\s+(.*)$/.exec(l);
      if (h) l = `<h${h[1].length + 2}>${h[2]}</h${h[1].length + 2}>`;
      else if (/^[-•]\s+/.test(l)) l = `<li>${l.replace(/^[-•]\s+/, '')}</li>`;
      else l = l ? `<p>${l}</p>` : '';
      return l;
    })
    .join('');
}
