<script lang="ts">
  import { tick } from 'svelte';
  import { colorFor, type LogEntry } from '@ftt/shared';
  import type { TableSession } from '../lib/session/table.svelte';
  import RollView from './RollView.svelte';

  // Bandeja de dados sobre o quadro: monta a rolagem e mostra só o histórico de rolagens.
  let { session }: { session: TableSession } = $props();

  const SIDES = [4, 6, 8, 10, 12, 20, 100];

  let open = $state(false);
  let pool = $state<Record<number, number>>({});
  let mod = $state(0);
  let expr = $state('');
  let priv = $state(false);
  let seen = $state(0);
  let listEl = $state<HTMLDivElement | null>(null);

  const rolls = $derived(session.log.filter((e) => e.kind === 'roll' || e.kind === 'table'));
  const unseen = $derived(Math.max(0, rolls.length - seen));

  const poolExpr = $derived.by(() => {
    const parts = SIDES.filter((s) => pool[s]).map((s) => `${pool[s]}d${s}`);
    if (mod) parts.push(String(mod));
    return parts.join('+').replace(/\+-/g, '-');
  });
  const current = $derived(expr.trim() || poolExpr);

  // Na primeira vez, o que já estava no histórico não conta como novo.
  let started = false;
  $effect(() => {
    const n = rolls.length;
    if (!started) {
      started = true;
      seen = n;
    }
    if (open) {
      seen = n;
      tick().then(() => listEl && (listEl.scrollTop = listEl.scrollHeight));
    }
  });

  function add(s: number) {
    expr = '';
    pool[s] = Math.min(99, (pool[s] ?? 0) + 1);
  }

  function clear() {
    pool = {};
    mod = 0;
    expr = '';
  }

  function roll(e?: string) {
    const x = e ?? current;
    if (!x) return;
    session.roll(x, priv);
    if (!e) clear();
  }

  function color(e: LogEntry) {
    return e.from === 'gm' ? 'var(--accent-2)' : colorFor(e.from);
  }

  function privacy(e: LogEntry): string | null {
    if (!e.to) return null;
    return e.from === 'gm' ? 'oculta' : 'para o mestre';
  }

  const time = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
</script>

{#if !open}
  <button class="fab" onclick={() => (open = true)} title="Bandeja de dados" aria-label="Abrir bandeja de dados">
    🎲
    {#if unseen}<span class="badge">{unseen > 9 ? '9+' : unseen}</span>{/if}
  </button>
{:else}
  <section class="tray" aria-label="Bandeja de dados">
    <header>
      <strong>Dados</strong>
      <button class="ghost icon" onclick={() => (open = false)} aria-label="Fechar bandeja">✕</button>
    </header>

    <div class="history" bind:this={listEl}>
      {#if rolls.length === 0}
        <p class="muted empty">Nenhuma rolagem ainda.</p>
      {/if}
      {#each rolls.slice(-60) as e (e.id)}
        {@const p = privacy(e)}
        <div class="entry" class:private={!!p}>
          <div class="meta">
            <span class="name" style:color={color(e)}>{e.name}</span>
            {#if p}<span class="tag">🔒 {p}</span>{/if}
            <span class="time">{time(e.ts)}</span>
          </div>
          {#if e.label}<div class="label">{e.kind === 'table' ? '🎲 ' : ''}{e.label}</div>{/if}
          {#if e.kind === 'table'}
            <div class="table-result">{e.text}</div>
          {:else if e.roll}
            <RollView roll={e.roll} />
          {/if}
        </div>
      {/each}
    </div>

    <div class="builder">
      <div class="dice">
        {#each SIDES as s (s)}
          <button class="die" class:on={!!pool[s]} onclick={() => add(s)} title="Adicionar 1d{s}">
            d{s}{#if pool[s]}<span class="count">{pool[s]}</span>{/if}
          </button>
        {/each}
      </div>
      <div class="row">
        <button class="ghost tiny" onclick={() => (mod -= 1)} aria-label="Diminuir modificador">−</button>
        <span class="mod">{mod >= 0 ? '+' : ''}{mod}</span>
        <button class="ghost tiny" onclick={() => (mod += 1)} aria-label="Aumentar modificador">+</button>
        <button class="ghost small" onclick={() => roll('adv')} title="2d20, fica o maior">vant</button>
        <button class="ghost small" onclick={() => roll('dis')} title="2d20, fica o menor">desv</button>
        <button class="ghost small" onclick={clear} disabled={!current}>limpar</button>
      </div>
      <div class="row">
        <input
          bind:value={expr}
          placeholder={poolExpr || 'ex.: 4d6kh3, 1d20+5, 2d6!'}
          maxlength="100"
          aria-label="Expressão de dados"
          onkeydown={(e) => e.key === 'Enter' && roll()}
        />
        <button class="primary" onclick={() => roll()} disabled={!current}>Rolar</button>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={priv} />
        {session.role === 'gm' ? 'Rolagem oculta (só você vê)' : 'Só o mestre vê'}
      </label>
    </div>
  </section>
{/if}

<style>
  .fab {
    position: absolute;
    right: 14px;
    bottom: 14px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    font-size: 24px;
    padding: 0;
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 4;
  }
  .fab:hover {
    background: #d24434 !important;
  }
  .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent-2);
    color: #111;
    font-size: 11px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
  .tray {
    position: absolute;
    right: 12px;
    bottom: 12px;
    width: min(340px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    display: flex;
    flex-direction: column;
    background: rgba(22, 25, 32, 0.97);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.55);
    z-index: 4;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 8px 8px 14px;
    border-bottom: 1px solid var(--border);
  }
  header strong {
    font-family: var(--font-title);
    font-weight: 400;
    font-size: 17px;
    color: var(--accent-2);
  }
  .icon {
    padding: 3px 8px;
  }
  .history {
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 80px;
    max-height: 300px;
  }
  .empty {
    text-align: center;
    margin: 16px 0;
  }
  .entry {
    font-size: 13px;
  }
  .entry.private {
    border-left: 2px solid #6b4fa0;
    padding-left: 8px;
  }
  .meta {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .name {
    font-weight: 600;
  }
  .tag {
    font-size: 11px;
    color: #b39ddb;
  }
  .time {
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
  }
  .label {
    font-size: 12px;
    color: var(--accent-2);
    margin-top: 2px;
  }
  .table-result {
    background: var(--bg);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-2);
    border-radius: 8px;
    padding: 6px 10px;
    margin-top: 3px;
    white-space: pre-wrap;
  }
  .builder {
    border-top: 1px solid var(--border);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dice {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .die {
    position: relative;
    padding: 7px 0;
    font-size: 12px;
    font-weight: 700;
  }
  .die.on {
    border-color: var(--accent-2);
    color: var(--accent-2);
  }
  .count {
    position: absolute;
    top: -6px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    border-radius: 99px;
    background: var(--accent-2);
    color: #111;
    font-size: 10px;
    display: grid;
    place-items: center;
  }
  .tiny {
    padding: 2px 9px;
  }
  .small {
    padding: 4px 8px;
    font-size: 12px;
  }
  .mod {
    min-width: 28px;
    text-align: center;
    font-weight: 700;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--text);
  }
</style>
